import {  IMediasoupService, ConsumerAppData, MediasoupTypes } from "./MediasoupService";
import { SocketManager, HandshakeSession } from "./SocketService/SocketManager";
import { IFileService } from "./FileService/FileService";
import
{
    UserInfo,
    NewConsumerInfo,
    JoinInfo,
    NewWebRtcTransportInfo,
    ConnectWebRtcTransportInfo,
    NewProducerInfo,
    VideoCodec,
    CloseConsumerInfo,
    ChatMsgInfo,
    ChatFileInfo
} from "nostromo-shared/types/RoomTypes";
import { Socket } from "socket.io";

/** Пользователь комнаты. */
export class User
{
    public userId: string;
    public username = "Гость";
    public rtpCapabilities?: MediasoupTypes.RtpCapabilities;
    public consumerTransport?: MediasoupTypes.WebRtcTransport;
    public producerTransport?: MediasoupTypes.WebRtcTransport;
    public producers = new Map<string, MediasoupTypes.Producer>();
    public consumers = new Map<string, MediasoupTypes.Consumer>();

    public getTransportById(transportId: string)
        : MediasoupTypes.WebRtcTransport | undefined
    {
        if (this.consumerTransport?.id == transportId)
        {
            return this.consumerTransport;
        }

        if (this.producerTransport?.id == transportId)
        {
            return this.producerTransport;
        }

        return undefined;
    }


    constructor(id: string)
    {
        this.userId = id;
    }
}

/** Комната. */
export class Room
{
    /** Идентификатор комнаты. */
    public readonly id: string;

    /** Название комнаты. */
    public readonly name: string;

    /** Пароль комнаты. */
    private _password: string;
    public get password(): string { return this._password; }
    public set password(value: string) { this._password = value; }

    /** Сервис для работы с медиапотоками Mediasoup. */
    private mediasoup: IMediasoupService;
    /** Массив роутеров (каждый роутер на своём ядре процессора). */
    private mediasoupRouters: MediasoupTypes.Router[];
    /** Индекс последнего задействованного роутера. */
    private latestRouterIdx = 1;

    /** Для работы с файлами. */
    private fileService: IFileService;

    /** Пользователи в комнате. */
    public readonly users = new Map<string, User>();

    /** Максимальный битрейт (Кбит) для аудио в этой комнате. */
    private maxAudioBitrate = 64 * 1024;

    /** Создать комнату. */
    public static async create(
        roomId: string,
        name: string, password: string, videoCodec: VideoCodec,
        mediasoup: IMediasoupService,
        fileService: IFileService
    ): Promise<Room>
    {
        // для каждой комнаты свои роутеры
        const routers = await mediasoup.createRouters(videoCodec);

        return new Room(
            roomId,
            name, password,
            mediasoup, routers, videoCodec,
            fileService
        );
    }

    private constructor(
        roomId: string,
        name: string, password: string,
        mediasoup: IMediasoupService, mediasoupRouters: MediasoupTypes.Router[], videoCodec: VideoCodec,
        fileService: IFileService
    )
    {
        console.log(`[Room] creating a new Room [#${roomId}, ${name}, ${videoCodec}]`);

        this.id = roomId;
        this.name = name;
        this._password = password;

        this.mediasoup = mediasoup;
        this.mediasoupRouters = mediasoupRouters;

        this.fileService = fileService;
    }

    /** Получить RTP возможности (кодеки) роутера. */
    public get routerRtpCapabilities(): MediasoupTypes.RtpCapabilities
    {
        // поскольку кодеки всех роутеров этой комнаты одинаковые,
        // то вернем кодеки первого роутера
        return this.mediasoupRouters[0].rtpCapabilities;
    }

    /** Получить очередной роутер для создания транспортного канала. */
    private getRouter(consuming: boolean): MediasoupTypes.Router
    {
        // Если нужен роутер для приема потоков от клиента
        // или роутер всего один.
        if (!consuming || this.mediasoupRouters.length == 1)
        {
            return this.mediasoupRouters[0];
        }
        else
        {
            ++this.latestRouterIdx;

            if (this.latestRouterIdx == this.mediasoupRouters.length)
            {
                this.latestRouterIdx = 1;
            }

            return this.mediasoupRouters[this.latestRouterIdx];
        }
    }

    /** Рассчитываем новый максимальный видео битрейт. */
    private calculateAndEmitNewMaxVideoBitrate(): void
    {
        const MEGA = 1024 * 1024;

        // макс. аудиобитрейт в мегабитах
        const maxAudioBitrateMbs = this.maxAudioBitrate / MEGA;

        const networkIncomingCapability = this.mediasoup.networkIncomingCapability - (maxAudioBitrateMbs * this.mediasoup.audioProducersCount);
        const networkOutcomingCapability = this.mediasoup.networkOutcomingCapability - (maxAudioBitrateMbs * this.mediasoup.audioConsumersCount);

        const consumersCount: number = (this.mediasoup.videoConsumersCount != 0) ? this.mediasoup.videoConsumersCount : 1;
        const producersCount: number = this.mediasoup.videoProducersCount;

        if (producersCount > 0)
        {
            const maxVideoBitrate: number = Math.min(
                networkIncomingCapability / producersCount,
                networkOutcomingCapability / consumersCount
            ) * MEGA;

            if (maxVideoBitrate > 0)
            {
                this.socketHandler.emitToAll('maxVideoBitrate', maxVideoBitrate);
            }
        }
    }

    /** Пользователь заходит в комнату. */
    public join(socket: Socket): void
    {
        const session = socket.handshake.session;
        if (!session)
        {
            throw `[Room] Error: session is missing for (${socket.id})`;
        }

        console.log(`[Room] [#${this._id}, ${this._name}]: ${socket.id} (${session.username ?? "Гость"}) user connected`);
        this._users.set(socket.id, new User(socket.id));

        const user: User = this.users.get(socket.id)!;

        // Сообщаем заинтересованным новый список пользователей в комнате.
        this.sendUserList();

        // сообщаем пользователю название комнаты
        socket.emit('roomName', this.name);

        // сообщаем пользователю макс. битрейт аудио в комнате
        socket.emit('maxAudioBitrate', this.maxAudioBitrate);

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
            await this.joinEvJoin(user, socket, session, joinInfo);
        });

        // клиент ставит consumer на паузу
        socket.on('pauseConsumer', async (consumerId: string) =>
        {
            const consumer = user.consumers.get(consumerId);

            if (!consumer)
                throw new Error(`[Room] consumer with id "${consumerId}" not found`);

            // запоминаем, что клиент поставил на паузу вручную
            (consumer.appData as ConsumerAppData).clientPaused = true;

            await this.pauseConsumer(consumer);
        });

        // клиент снимает consumer с паузы
        socket.on('resumeConsumer', async (consumerId: string) =>
        {
            const consumer = user.consumers.get(consumerId);

            if (!consumer)
                throw new Error(`[Room] consumer with id "${consumerId}" not found`);

            // клиент хотел снять с паузы consumer, поэтому выключаем флаг ручной паузы
            (consumer.appData as ConsumerAppData).clientPaused = false;

            await this.resumeConsumer(consumer);
        });
        // создание нового producer
        socket.on('newProducer', async (newProducerInfo: NewProducerInfo) =>
        {
            await this.createProducer(user, socket, newProducerInfo);
        });

        // клиент закрывает producer
        socket.on('closeProducer', (producerId: string) =>
        {
            const producer = user.producers.get(producerId);

            if (!producer)
                throw new Error(`[Room] producer with id "${producerId}" not found`);

            producer.close();

            this.closeProducer(user, producer);
        });

        // клиент ставит producer на паузу (например, временно выключает микрофон)
        socket.on('pauseProducer', async (producerId: string) =>
        {
            const producer = user.producers.get(producerId);

            if (!producer)
                throw new Error(`[Room] producer with id "${producerId}" not found`);

            await this.pauseProducer(producer);
        });

        // клиент снимает producer с паузы (например, включает микрофон обратно)
        socket.on('resumeProducer', async (producerId: string) =>
        {
            const producer = user.producers.get(producerId);

            if (!producer)
                throw new Error(`[Room] producer with id "${producerId}" not found`);

            await this.resumeProducer(producer);
        });

        // новый ник пользователя
        socket.on('newUsername', (username: string) =>
        {
            this.joinEvNewUsername(socket, session, username);
        });

        socket.on('chatMsg', (msg: string) =>
        {
            const chatMsgInfo: ChatMsgInfo = {
                name: socket.handshake.session!.username!,
                msg: msg.trim()
            };
            socket.to(this.id).emit('chatMsg', chatMsgInfo);
        });

        socket.on('chatFile', (fileId: string) =>
        {
            const fileInfo = this.fileService.getFileInfo(fileId);
            if (!fileInfo) return;

            const username = socket.handshake.session!.username!;

            const chatFileInfo: ChatFileInfo = { fileId, filename: fileInfo.name, size: fileInfo.size, username };

            socket.to(this.id).emit('chatFile', chatFileInfo);
        });

        // пользователь отсоединился
        socket.on('disconnect', (reason: string) =>
        {
            this.joinEvDisconnect(socket, session, reason);
        });
    }

    /** Поставить consumer на паузу. */
    private async pauseConsumer(consumer: MediasoupTypes.Consumer, socket?: Socket)
    {
        // если уже не на паузе
        if (!consumer.paused)
        {
            await consumer.pause();

            // поскольку consumer поставлен на паузу,
            // то уменьшаем счетчик и перерасчитываем битрейт
            this.mediasoup.decreaseConsumersCount(consumer.kind);
            this.calculateAndEmitNewMaxVideoBitrate();
        }
        // Сообщаем клиенту, чтобы он тоже поставил на паузу, если только это не он попросил.
        // То есть сообщаем клиенту, что сервер поставил или хотел поставить на паузу. Хотел в том случае,
        // если до этого клиент уже поставил на паузу, а после соответствующий producer был поставлен на паузу.
        // Это необходимо, чтобы клиент знал при попытке снять с паузы, что сервер НЕ ГОТОВ снимать с паузы consumer.
        if (socket)
        {
            socket.emit('pauseConsumer', consumer.id);
        }
    }

    /** Снять consumer с паузы. */
    private async resumeConsumer(consumer: MediasoupTypes.Consumer, socket?: Socket)
    {
        // проверяем чтобы:
        // 1) consumer был на паузе,
        // 2) соответствующий producer был не на паузе
        // 3) клиент ГОТОВ к снятию паузы у этого consumer
        if (consumer.paused
            && !consumer.producerPaused
            && !(consumer.appData as ConsumerAppData).clientPaused)
        {
            await consumer.resume();

            // поскольку consumer снят с паузы,
            // то увеличиваем счетчик и перерасчитываем битрейт
            this.mediasoup.increaseConsumersCount(consumer.kind);
            this.calculateAndEmitNewMaxVideoBitrate();
        }
        // Сообщаем клиенту, чтобы он тоже снял с паузы, если только это не он попросил.
        // То есть сообщаем клиенту, что сервер снял или хотел снять паузу.
        // Это необходимо, чтобы клиент знал при попытке снять с паузы, что сервер ГОТОВ снимать с паузы consumer.
        if (socket)
        {
            socket.emit('resumeConsumer', consumer.id);
        }
    }

    // обработка события 'createWebRtcTransport' в методе join
    private async joinEvCreateWebRtcTransport(
        user: User,
        socket: Socket,
        consuming: boolean
    )
    {
        try
        {
            const router = this.getRouter(consuming);

            const transport = await this.mediasoup.createWebRtcTransport(
                user,
                consuming,
                router
            );

            transport.on('routerclose', () =>
            {
                if (consuming)
                {
                    user.consumerTransport = undefined;
                }
                else
                {
                    user.producerTransport = undefined;
                }

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

        const transport = user.getTransportById(transportId);

        if (!transport)
        {
            throw new Error(`[Room] transport with id "${transportId}" not found`);
        }

        await transport.connect({ dtlsParameters });
    }

    // обработка события 'join' в методе join
    private async joinEvJoin(
        user: User,
        socket: Socket,
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

                const anotherUserInfo: UserInfo = {
                    id: anotherUser[0],
                    name: this.socketHandler
                        .getSocketById(anotherUser[0])
                        .handshake.session!.username!
                };

                // сообщаем новому пользователю о пользователе anotherUser
                socket.emit('newUser', anotherUserInfo);

                const thisUserInfo: UserInfo = {
                    id: socket.id,
                    name: name
                };

                // сообщаем пользователю anotherUser о новом пользователе
                this.socketHandler.emitTo('room', anotherUser[0], 'newUser', thisUserInfo);
            }
        }
    }

    // создание потребителя для пользователя user
    // из изготовителя пользователя producerUserId
    private async createConsumer(
        user: User,
        producerUserId: SocketId,
        producer: MediasoupTypes.Producer,
        socket: Socket
    )
    {
        try
        {
            // создаем потребителя на сервере в режиме паузы
            // (транспорт на сервере уже должен быть создан у этого клиента)
            const consumer = await this.mediasoup.createConsumer(
                user,
                producer,
                this.mediasoupRouters[0]
            );

            user.consumers.set(consumer.id, consumer);

            // так как изначально consumer создается на паузе
            // не будем пока увеличивать счетчик consumersCount в классе mediasoup

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
        socket: Socket
    ): void
    {
        const closeConsumer = () =>
        {
            user.consumers.delete(consumer.id);

            // если он и так был на паузе, то не учитывать его удаление
            // в расчете битрейта
            if (!consumer.paused)
            {
                this.mediasoup.decreaseConsumersCount(consumer.kind);
                this.calculateAndEmitNewMaxVideoBitrate();
            }

            const closeConsumerInfo: CloseConsumerInfo = {
                consumerId: consumer.id,
                producerUserId
            };

            socket.emit('closeConsumer', closeConsumerInfo);
        };

        consumer.on('transportclose', closeConsumer);
        consumer.on('producerclose', closeConsumer);
        consumer.on('producerpause', async () => { await this.pauseConsumer(consumer, socket); });
        consumer.on('producerresume', async () => { await this.resumeConsumer(consumer, socket); });
    }

    private async createProducer(
        user: User,
        socket: Socket,
        newProducerInfo: NewProducerInfo
    )
    {
        try
        {
            const producer = await this.mediasoup.createProducer(user, newProducerInfo, this.mediasoupRouters);

            user.producers.set(producer.id, producer);

            this.mediasoup.increaseProducersCount(producer.kind);
            this.calculateAndEmitNewMaxVideoBitrate();

            producer.on('transportclose', () =>
            {
                this.closeProducer(user, producer);
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

    private closeProducer(user: User, producer: MediasoupTypes.Producer)
    {
        user.producers.delete(producer.id);

        if (!producer.paused)
        {
            this.mediasoup.decreaseProducersCount(producer.kind);
            this.calculateAndEmitNewMaxVideoBitrate();
        }
    }

    private async pauseProducer(producer: MediasoupTypes.Producer)
    {
        if (!producer.paused)
        {
            await producer.pause();

            this.mediasoup.decreaseProducersCount(producer.kind);
            this.calculateAndEmitNewMaxVideoBitrate();
        }
    }

    private async resumeProducer(producer: MediasoupTypes.Producer)
    {
        if (producer.paused)
        {
            await producer.resume();

            this.mediasoup.increaseProducersCount(producer.kind);
            this.calculateAndEmitNewMaxVideoBitrate();
        }
    }

    // обработка события 'disconnect' в методе join
    private joinEvDisconnect(
        socket: Socket,
        session: HandshakeSession,
        reason: string
    )
    {
        session.joined = false;
        session.save();

        this.userLeft(socket, session, reason);

        // Сообщаем заинтересованным новый список пользователей в комнате.
        this.sendUserList();

        this.socketHandler.emitTo('room', this.id, 'userDisconnected', socket.id);
    }

    // обработка события 'newUsername' в методе join
    private joinEvNewUsername(
        socket: Socket,
        session: HandshakeSession,
        username: string
    ): void
    {
        session.username = username;

        const userInfo: UserInfo = {
            id: socket.id,
            name: username
        };

        socket.to(this.id).emit('newUsername', userInfo);

        // Сообщаем заинтересованным новый список пользователей в комнате.
        this.sendUserList();
    }

    /** Пользователь покинул комнату. */
    public userLeft(
        socket: Socket,
        session: HandshakeSession,
        reason: string
    ): void
    {
        const username = session.username ?? "Гость";

        const user = this.users.get(socket.id);

        if (!user)
        {
            return;
        }

        console.log(`[Room] [#${this.id}, ${this.name}]: ${socket.id} (${username}) user disconnected > ${reason}`);

        user.consumerTransport?.close();
        user.producerTransport?.close();

        this.users.delete(socket.id);
    }

    /** Закрыть комнату */
    public close(): void
    {
        // TODO: функционал этого метода пока что не проверялся.
        // Надо бы проверить.
        console.log(`[Room] closing Room [${this.id}]`);

        for (const router of this.mediasoupRouters)
        {
            router.close();
        }
    }
}