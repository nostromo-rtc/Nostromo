import { Mediasoup, MediasoupTypes } from "./Mediasoup";
import { SocketHandler, SocketWrapper, SocketId } from "./SocketHandler";
import
{
    RoomId,
    NewUserInfo,
    NewConsumerInfo,
    AfterConnectInfo,
    NewWebRtcTransportInfo,
    ConnectWebRtcTransportInfo
} from "shared/RoomTypes";

export { RoomId };

// пользователь комнаты
export class User
{
    public userId: SocketId;
    public rtpCapabilities?: MediasoupTypes.RtpCapabilities;

    public transports = new Map<string, MediasoupTypes.Transport>();
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
        name: string, password: string,
        mediasoup: Mediasoup,
        socketHandler: SocketHandler
    )
    {
        const router = await mediasoup.createRouter();

        return new Room(
            roomId,
            name, password,
            mediasoup, router,
            socketHandler
        );
    }

    private constructor(
        roomId: RoomId,
        name: string, password: string,
        mediasoup: Mediasoup, mediasoupRouter: MediasoupTypes.Router,
        socketHandler: SocketHandler
    )
    {
        console.log(`creating a new Room [${roomId}, ${name}]`);

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

    // вход в комнату
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

        socket.once('afterConnect', async (
            { name, rtpCapabilities }: AfterConnectInfo
        ) =>
        {
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
        });

        socket.on('newConsumer', async (consumerId: string) =>
        {
            await this.users.get(socket.id)
                ?.consumers.get(consumerId)
                ?.resume();
        });

        socket.on('createWebRtcTransport', async (consuming: boolean) =>
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

                socket.emit('createWebRtcTransport', info);
            }
            catch (error)
            {
                console.error('> createWebRtcTransport error: ', error);
            }
        });

        socket.on('connectWebRtcTransport', async (
            { transportId, dtlsParameters }: ConnectWebRtcTransportInfo
        ) =>
        {
            if (!user.transports.has(transportId))
                throw new Error(`transport with id "${transportId}" not found`);

            const transport = user.transports.get(transportId)!;
            await transport.connect({ dtlsParameters });
        });

        socket.on('newUsername', (username: string) =>
        {
            session.username = username;

            const userInfo: NewUserInfo = {
                id: socket.id,
                name: username
            };

            socket.to(this.id).emit('newUsername', userInfo);
        });

        socket.on('disconnect', (reason: string) =>
        {
            session.joined = false;
            session.save();

            this.leave(socket.id, reason);

            this.socketHandler.emitTo(this.id, 'userDisconnected', socket.id);
        });
    }

    private async createConsumer(
        user: User,
        anotherUserId: SocketId,
        producer: MediasoupTypes.Producer,
        socket: SocketWrapper
    )
    {
        try
        {
            let consumer = await this.mediasoup.createConsumer(
                user,
                producer,
                this.mediasoupRouter
            );

            // обрабатываем события у Consumer
            this.handleConsumerEvents(consumer, user, socket);

            const newConsumer: NewConsumerInfo = {
                userId: anotherUserId,
                producerId: producer.id,
                id: consumer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
                type: consumer.type,
                appData: producer.appData,
                producerPaused: consumer.producerPaused
            };

            socket.emit('newConsumer', newConsumer);
        }
        catch (error)
        {
            console.error('> createConsumer() error | ', error);
        }
    }

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

        consumer.on('score', (score: MediasoupTypes.ConsumerScore) =>
        {
            socket.emit('consumerScore', { consumerId: consumer.id, score });
        });

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

    public close(): void
    {
        console.log(`closing Room [${this._id}]`);
        this.mediasoupRouter.close();
    }
}