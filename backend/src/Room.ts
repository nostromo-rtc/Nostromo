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
    VideoCodec
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

    // пользователь заходит в комнату
    public join(socket: SocketWrapper): void
    {
        console.log(`[${this._id}, ${this._name}]: ${socket.id} user connected`);
        this._users.set(socket.id, new User(socket.id));

        let user: User = this.users.get(socket.id)!;
        let session = socket.handshake.session!;

        // сообщаем пользователю название комнаты
        socket.emit('roomName', this.name);

        // сообщаем пользователю RTP возможности (кодеки) сервера
        socket.emit('routerRtpCapabilities', this.routerRtpCapabilities);

        // пользователь заходит в комнату (т.е уже создал транспортные каналы)
        // и готов к получению потоков (готов к получению consumers)
        socket.once('join', async (joinInfo: JoinInfo) =>
        {
            await this.joinEvJoin(user, socket, session, joinInfo);
        });

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

        // создание нового producer
        socket.on('newProducer', async (newProducerInfo: NewProducerInfo) =>
        {
            await this.createProducer(user, socket, newProducerInfo);
        });

        // потребитель (Consumer) готов к работе у клиента
        // и его необходимо снять с паузы на сервере
        socket.on('consumerReady', async (consumerId: string) =>
        {
            await this.users.get(socket.id)
                ?.consumers.get(consumerId)
                ?.resume();
        });

        // перезапуск ICE слоя (генерирование новых локальных ICE параметров и отдача их клиенту)
        socket.on('restartIce', async (transportId) =>
        {
            await this.joinEvRestartIce(user, socket, transportId);
        });

        // новый ник пользователя
        socket.on('newUsername', (username: string) =>
        {
            this.joinEvNewUsername(socket, session, username);
        });

        // пользователь отсоединился
        socket.on('disconnect', (reason: string) =>
        {
            this.joinEvDisconnect(socket, session, reason);
        });
    }

    private async createProducer(
        user: User,
        socket: SocketWrapper,
        newProducerInfo: NewProducerInfo
    )
    {
        const producer = await this.mediasoup.createProducer(user, newProducerInfo);

        // RTP stream score (от 0 до 10) означает качество передачи
        producer.on('score', (score: MediasoupTypes.ProducerScore) =>
        {
            socket.emit('producerScore', { producerId: producer.id, score });
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

    // обработка события 'disconnect' в методе join
    private joinEvDisconnect(
        socket: SocketWrapper,
        session: HandshakeSession,
        reason: string
    )
    {
        session.joined = false;
        session.save();

        this.leave(socket.id, reason);

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
            throw new Error(`transport with id "${transportId}" not found`);

        const transport = user.transports.get(transportId)!;
        const iceParameters = await transport.restartIce();
        socket.emit('restartIce', iceParameters);
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

            // обрабатываем события у Consumer
            this.handleConsumerEvents(consumer, user, socket);

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
            console.error('> createConsumer() error | ', error);
        }
    }

    // обработка событий у потребителя Consumer
    private handleConsumerEvents(
        consumer: MediasoupTypes.Consumer,
        user: User,
        socket: SocketWrapper
    ): void
    {
        consumer.on('transportclose', () =>
        {
            // удаляем у юзера Consumer
            user.consumers.delete(consumer.id);
        });

        consumer.on('producerclose', () =>
        {
            user.consumers.delete(consumer.id);

            socket.emit('consumerClosed', consumer.id);
        });

        consumer.on('producerpause', () =>
        {
            socket.emit('consumerPaused', consumer.id);
        });

        consumer.on('producerresume', () =>
        {
            socket.emit('consumerResumed', consumer.id);
        });

        // RTP stream score (от 0 до 10) означает качество передачи
        consumer.on('score', (score: MediasoupTypes.ConsumerScore) =>
        {
            socket.emit('consumerScore', { consumerId: consumer.id, score });
        });

        // для simulcast или SVC consumers
        consumer.on('layerschange', (layers: MediasoupTypes.ConsumerLayers) =>
        {
            socket.emit(
                'consumerLayersChanged',
                {
                    consumerId: consumer.id,
                    spatialLayer: layers ? layers.spatialLayer : null,
                    temporalLayer: layers ? layers.temporalLayer : null
                });
        });
    }

    // обработка события 'connectWebRtcTransport' в методе join
    private async joinEvConnectWebRtcTransport(
        user: User,
        connectWebRtcTransportInfo: ConnectWebRtcTransportInfo
    )
    {
        const { transportId, dtlsParameters } = connectWebRtcTransportInfo;

        if (!user.transports.has(transportId))
            throw new Error(`transport with id "${transportId}" not found`);

        const transport = user.transports.get(transportId)!;
        await transport.connect({ dtlsParameters });
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
            console.error('> createWebRtcTransport error: ', error);
        }
    }

    // пользователь покидает комнату
    public leave(userId: SocketId, reason: string): void
    {
        if (this._users.has(userId))
        {
            console.log(`[${this._id}, ${this._name}]: ${userId} user disconnected`, reason);

            const transports = this._users.get(userId)!.transports;
            for (const transport of transports.values())
            {
                transport.close();
            }

            this._users.delete(userId);
        }
    }

    // комната закрывается
    public close(): void
    {
        console.log(`closing Room [${this._id}]`);
        this.mediasoupRouter.close();
    }
}