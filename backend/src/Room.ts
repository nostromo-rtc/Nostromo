import { Mediasoup, MediasoupTypes } from "./Mediasoup";
import { SocketHandler, SocketWrapper, SocketId, HandshakeSession } from "./SocketHandler";
import
{
    RoomId,
    NewUserInfo,
    NewConsumerInfo,
    JoinInfo,
    NewWebRtcTransportInfo,
    ConnectWebRtcTransportInfo,
    NewProducerInfo,
    VideoCodec,
    CloseConsumerInfo,
    ChatMsgInfo
} from "shared/RoomTypes";

export { RoomId };

// пользователь комнаты
export class User
{
    public userId: SocketId;
    public rtpCapabilities?: MediasoupTypes.RtpCapabilities;

    public transports = new Map<string, MediasoupTypes.WebRtcTransport>();
    public producers = new Map<string, MediasoupTypes.Producer>();
    public consumers = new Map<string, MediasoupTypes.Consumer>();

    constructor(_userId: SocketId)
    {
        this.userId = _userId;
    }
}

// комнаты
export class Room
{
    // номер комнаты
    private _id: RoomId;
    public get id(): RoomId { return this._id; }

    // название комнаты
    private _name: string;
    public get name(): string { return this._name; }

    // пароль комнаты
    private _password: string;
    public get password(): string { return this._password; }
    public set password(value: string) { this._password = value; }

    // mediasoup
    private mediasoup: Mediasoup;
    private mediasoupRouter: MediasoupTypes.Router;

    // SocketHandler
    private socketHandler: SocketHandler;

    // пользователи в комнате
    private _users = new Map<SocketId, User>();
    public get users() { return this._users; }

    public static async create(
        roomId: RoomId,
        name: string, password: string, videoCodec: VideoCodec,
        mediasoup: Mediasoup,
        socketHandler: SocketHandler
    )
    {
        // для каждой комнаты свой mediasoup router
        const router = await mediasoup.createRouter(videoCodec);

        return new Room(
            roomId,
            name, password,
            mediasoup, router, videoCodec,
            socketHandler
        );
    }

    private constructor(
        roomId: RoomId,
        name: string, password: string,
        mediasoup: Mediasoup, mediasoupRouter: MediasoupTypes.Router, videoCodec: VideoCodec,
        socketHandler: SocketHandler
    )
    {
        console.log(`[Room] creating a new Room [#${roomId}, ${name}, ${videoCodec}]`);

        this._id = roomId;
        this._name = name;
        this._password = password;

        this.mediasoup = mediasoup;
        this.mediasoupRouter = mediasoupRouter;

        this.socketHandler = socketHandler;
    }

    // получить RTP возможности (кодеки) роутера
    public get routerRtpCapabilities(): MediasoupTypes.RtpCapabilities
    {
        return this.mediasoupRouter.rtpCapabilities;
    }

    // рассчитываем новый максимальный видео битрейт
    private calculateAndEmitNewMaxVideoBitrate()
    {
        const MEGA: number = 1024 * 1024;
        const consumersCount: number = (this.mediasoup.consumersCount != 0) ? this.mediasoup.consumersCount : 1;
        const producersCount: number = this.mediasoup.producersCount;
        if (producersCount > 0)
        {
            let maxVideoBitrate: number = Math.min(
                this.mediasoup.networkIncomingCapability / producersCount,
                this.mediasoup.networkOutcomingCapability / consumersCount
            ) * MEGA;

            this.socketHandler.emitToAll('maxVideoBitrate', maxVideoBitrate);
        }
    }

    // пользователь заходит в комнату
    public join(socket: SocketWrapper): void
    {
        let session = socket.handshake.session;
        if (!session) throw `[Room] Error: session is missing (${socket.id})`;

        console.log(`[Room] [#${this._id}, ${this._name}]: ${socket.id} (${session.username}) user connected`);
        this._users.set(socket.id, new User(socket.id));

        let user: User = this.users.get(socket.id)!;

        // сообщаем пользователю название комнаты
        socket.emit('roomName', this.name);

        // сообщаем пользователю RTP возможности (кодеки) сервера
        socket.emit('routerRtpCapabilities', this.routerRtpCapabilities);

        // создание транспортного канала на сервере (с последующей отдачей информации о канале клиенту)
        socket.on('createWebRtcTransport', async (consuming: boolean) =>
        {
            await this.joinEvCreateWebRtcTransport(user, socket, consuming);
        });

        // подключение к транспортному каналу со стороны сервера
        socket.on('connectWebRtcTransport', async (
            connectWebRtcTransportInfo: ConnectWebRtcTransportInfo
        ) =>
        {
            await this.joinEvConnectWebRtcTransport(user, connectWebRtcTransportInfo);
        });

        // пользователь заходит в комнату (т.е уже создал транспортные каналы)
        // и готов к получению потоков (готов к получению consumers)
        socket.once('join', async (joinInfo: JoinInfo) =>
        {
            await this.joinEvJoin(user, socket, session!, joinInfo);
        });

        // потребитель (Consumer) готов к работе у клиента
        // и его необходимо снять с паузы на сервере
        socket.on('resumeConsumer', async (consumerId: string) =>
        {
            const consumer = user.consumers.get(consumerId);

            if (!consumer)
                throw new Error(`[Room] producer with id "${consumerId}" not found`);

            await consumer.resume();
        });


        // создание нового producer
        socket.on('newProducer', async (newProducerInfo: NewProducerInfo) =>
        {
            await this.createProducer(user, socket, newProducerInfo);
        });

        // клиент закрывает producer
        socket.on('closeProducer', async (producerId: string) =>
        {
            const producer = user.producers.get(producerId);

            if (!producer)
                throw new Error(`[Room] producer with id "${producerId}" not found`);

            producer.close();

            this.removeProducer(user, producer.id);
        });

        // клиент ставит producer на паузу (например, временно выключает микрофон)
        socket.on('pauseProducer', async (producerId: string) =>
        {
            const producer = user.producers.get(producerId);

            if (!producer)
                throw new Error(`[Room] producer with id "${producerId}" not found`);

            await producer.pause();
        });

        // клиент снимает producer с паузы (например, включает микрофон обратно)
        socket.on('resumeProducer', async (producerId: string) =>
        {
            const producer = user.producers.get(producerId);

            if (!producer)
                throw new Error(`[Room] producer with id "${producerId}" not found`);

            await producer.resume();
        });

        // перезапуск ICE слоя (генерирование новых локальных ICE параметров и отдача их клиенту)
        socket.on('restartIce', async (transportId) =>
        {
            await this.joinEvRestartIce(user, socket, transportId);
        });

        // новый ник пользователя
        socket.on('newUsername', (username: string) =>
        {
            this.joinEvNewUsername(socket, session!, username);
        });

        socket.on('chatMsg', (msg: string) =>
        {
            const chatMsgInfo: ChatMsgInfo = {
                name: socket.handshake.session!.username!,
                msg: msg.trim()
            };
            socket.to(this.id).emit('chatMsg', chatMsgInfo);
        });

        // пользователь отсоединился
        socket.on('disconnect', (reason: string) =>
        {
            this.joinEvDisconnect(socket, session!, reason);
        });
    }

    // обработка события 'createWebRtcTransport' в методе join
    private async joinEvCreateWebRtcTransport(
        user: User,
        socket: SocketWrapper,
        consuming: boolean
    )
    {
        try
        {
            const transport = await this.mediasoup.createWebRtcTransport(
                user,
                consuming,
                this.mediasoupRouter
            );

            transport.on('routerclose', () =>
            {
                user.transports.delete(transport.id);

                socket.emit('closeTransport', transport.id);
            });

            const info: NewWebRtcTransportInfo = {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates as NewWebRtcTransportInfo['iceCandidates'],
                dtlsParameters: transport.dtlsParameters
            };

            socket.emit(consuming ? 'createRecvTransport' : 'createSendTransport', info);
        }
        catch (error)
        {
            console.error(`[Room] createWebRtcTransport for User ${user.userId} error: `, (error as Error).message);
        }
    }

    // обработка события 'connectWebRtcTransport' в методе join
    private async joinEvConnectWebRtcTransport(
        user: User,
        connectWebRtcTransportInfo: ConnectWebRtcTransportInfo
    )
    {
        const { transportId, dtlsParameters } = connectWebRtcTransportInfo;

        if (!user.transports.has(transportId))
            throw new Error(`[Room] transport with id "${transportId}" not found`);

        const transport = user.transports.get(transportId)!;
        await transport.connect({ dtlsParameters });
    }

    // обработка события 'join' в методе join
    private async joinEvJoin(
        user: User,
        socket: SocketWrapper,
        session: HandshakeSession,
        joinInfo: JoinInfo
    )
    {
        const { name, rtpCapabilities } = joinInfo;

        // запоминаем имя в сессии
        session.username = name;
        user.rtpCapabilities = rtpCapabilities;

        // перебираем всех пользователей, кроме нового
        for (const anotherUser of this.users)
        {
            if (anotherUser[0] != socket.id)
            {
                for (const producer of anotherUser[1].producers.values())
                {
                    await this.createConsumer(user, anotherUser[0], producer, socket);
                }

                const anotherUserInfo: NewUserInfo = {
                    id: anotherUser[0],
                    name: this.socketHandler
                        .getSocketById(anotherUser[0])
                        .handshake.session!.username!
                };

                // сообщаем новому пользователю о пользователе anotherUser
                socket.emit('newUser', anotherUserInfo);

                const thisUserInfo: NewUserInfo = {
                    id: socket.id,
                    name: name
                };

                // сообщаем пользователю anotherUser о новом пользователе
                this.socketHandler.emitTo(anotherUser[0], 'newUser', thisUserInfo);
            }
        }
    }

    // создание потребителя для пользователя user
    // из изготовителя пользователя producerUserId
    private async createConsumer(
        user: User,
        producerUserId: SocketId,
        producer: MediasoupTypes.Producer,
        socket: SocketWrapper
    )
    {
        try
        {
            // создаем потребителя на сервере в режиме паузы
            // (транспорт на сервере уже должен быть создан у этого клиента)
            const consumer = await this.mediasoup.createConsumer(
                user,
                producer,
                this.mediasoupRouter
            );

            user.consumers.set(consumer.id, consumer);
            ++this.mediasoup.consumersCount;
            this.calculateAndEmitNewMaxVideoBitrate();

            // обрабатываем события у Consumer
            this.handleConsumerEvents(consumer, user, producerUserId, socket);

            // сообщаем клиенту всю информацию об этом потребителе
            const newConsumer: NewConsumerInfo = {
                producerUserId,
                id: consumer.id,
                producerId: producer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters
            };

            socket.emit('newConsumer', newConsumer);
        }
        catch (error)
        {
            console.error(`[Room] createConsumer error for User ${user.userId} | `, (error as Error).message);
        }
    }

    // обработка событий у потребителя Consumer
    private handleConsumerEvents(
        consumer: MediasoupTypes.Consumer,
        user: User,
        producerUserId: SocketId,
        socket: SocketWrapper
    ): void
    {
        let closeConsumer = () =>
        {
            user.consumers.delete(consumer.id);
            --this.mediasoup.consumersCount;
            this.calculateAndEmitNewMaxVideoBitrate();

            const closeConsumerInfo: CloseConsumerInfo = {
                consumerId: consumer.id,
                producerUserId
            };

            socket.emit('closeConsumer', closeConsumerInfo);
        };

        consumer.on('transportclose', closeConsumer);
        consumer.on('producerclose', closeConsumer);
    }

    private async createProducer(
        user: User,
        socket: SocketWrapper,
        newProducerInfo: NewProducerInfo
    )
    {
        try
        {
            const producer = await this.mediasoup.createProducer(user, newProducerInfo);

            user.producers.set(producer.id, producer);
            ++this.mediasoup.producersCount;
            this.calculateAndEmitNewMaxVideoBitrate();

            producer.on('transportclose', () =>
            {
                this.removeProducer(user, producer.id);
                socket.emit('closeProducer', producer.id);
            });

            // перебираем всех пользователей, кроме текущего
            // и создадим для них consumer
            for (const anotherUser of this.users)
            {
                if (anotherUser[0] != socket.id)
                {
                    await this.createConsumer(
                        anotherUser[1],
                        socket.id,
                        producer,
                        this.socketHandler.getSocketById(anotherUser[0])
                    );
                }
            }

            socket.emit('newProducer', producer.id);
        }
        catch (error)
        {
            console.error(`[Room] createProducer error for User ${user.userId} | `, (error as Error).message);
        }
    }

    private removeProducer(user: User, producerId: string)
    {
        user.producers.delete(producerId);
        --this.mediasoup.producersCount;
        this.calculateAndEmitNewMaxVideoBitrate();
    }

    // обработка события 'disconnect' в методе join
    private joinEvDisconnect(
        socket: SocketWrapper,
        session: HandshakeSession,
        reason: string
    )
    {
        session.joined = false;
        session.save();

        this.leave(socket, reason);

        this.socketHandler.emitTo(this.id, 'userDisconnected', socket.id);
    }

    // обработка события 'newUsername' в методе join
    private joinEvNewUsername(
        socket: SocketWrapper,
        session: HandshakeSession,
        username: string
    )
    {
        session.username = username;

        const userInfo: NewUserInfo = {
            id: socket.id,
            name: username
        };

        socket.to(this.id).emit('newUsername', userInfo);
    }

    // обработка события 'restartIce' в методе join
    private async joinEvRestartIce(
        user: User,
        socket: SocketWrapper,
        transportId: string
    )
    {
        if (!user.transports.has(transportId))
            throw new Error(`[Room] transport with id "${transportId}" not found`);

        const transport = user.transports.get(transportId)!;
        const iceParameters = await transport.restartIce();
        socket.emit('restartIce', iceParameters);
    }

    // пользователь покидает комнату
    public leave(userSocket: SocketWrapper, reason: string): void
    {
        if (this._users.has(userSocket.id))
        {
            console.log(`[Room] [#${this._id}, ${this._name}]: ${userSocket.id} (${userSocket.handshake.session!.username}) user disconnected > ${reason}`);

            const transports = this._users.get(userSocket.id)!.transports;
            for (const transport of transports.values())
            {
                transport.close();
            }

            this._users.delete(userSocket.id);
        }
    }

    // комната закрывается
    public close(): void
    {
        console.log(`[Room] closing Room [${this._id}]`);
        this.mediasoupRouter.close();
    }
}