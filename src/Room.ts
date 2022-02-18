import { IMediasoupService, ConsumerAppData, MediasoupTypes } from "./MediasoupService";
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
    public id: string;
    public name = "Гость";
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
        this.id = id;
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
    public maxAudioBitrate = 64 * 1024;

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

    /**
     * Создать транспортный канал по запросу клиента.
     * @param consuming Канал для отдачи потоков от сервера клиенту?
     */
    public async createWebRtcTransport(
        user: User,
        consuming: boolean
    ): Promise<MediasoupTypes.WebRtcTransport>
    {
        const router = this.getRouter(consuming);

        const transport = await this.mediasoup.createWebRtcTransport(
            user,
            consuming,
            router
        );

        return transport;
    }

    /** Транспортный канал был закрыт, поэтому необходимо обработать это событие. */
    public transportClosed(
        user: User,
        consuming: boolean
    ): void
    {
        if (consuming)
        {
            user.consumerTransport = undefined;
        }
        else
        {
            user.producerTransport = undefined;
        }
    }

    /** Подключиться к транспортному каналу по запросу клиента. */
    public async connectWebRtcTransport(
        user: User,
        info: ConnectWebRtcTransportInfo
    ): Promise<void>
    {
        const { transportId, dtlsParameters } = info;

        const transport = user.getTransportById(transportId);

        if (!transport)
        {
            console.error(`[Room] connectWebRtcTransport for User ${user.id} error: transport with id "${transportId}" not found.`);
            return;
        }

        await transport.connect({ dtlsParameters });
    }

    /**
     * Создание потока-потребителя для пользователя consumerUser
     * из потока-производителя пользователя producerUserId.
     */
    public async createConsumer(
        consumerUser: User,
        producer: MediasoupTypes.Producer
    ): Promise<MediasoupTypes.Consumer>
    {
        // Создаем потребителя на сервере в режиме паузы
        // (транспорт на сервере уже должен быть создан у этого клиента).
        const consumer = await this.mediasoup.createConsumer(
            consumerUser,
            producer,
            this.mediasoupRouters[0]
        );

        consumerUser.consumers.set(consumer.id, consumer);

        // Так как изначально consumer создается на паузе
        // не будем пока увеличивать счетчик consumersCount в классе mediasoup.

        return consumer;
    }

    /** Поток-потребитель был завершен, поэтому необходимо обработать это событие. */
    public consumerClosed(
        consumer: MediasoupTypes.Consumer,
        consumerUser: User
    ): void
    {
        consumerUser.consumers.delete(consumer.id);

        // Если он и так был на паузе, то не учитывать его удаление в расчете битрейта.
        if (!consumer.paused)
        {
            this.mediasoup.decreaseConsumersCount(consumer.kind);
            this.calculateAndEmitNewMaxVideoBitrate();
        }
    }

    /** Пользователь user запросил поставить на паузу поток-потребитель с идентификатором consumerId. */
    public async userRequestedPauseConsumer(
        user: User,
        consumerId: string
    )
    {
        const consumer = user.consumers.get(consumerId);

        if (!consumer)
        {
            console.error(`[Room] pauseConsumer for User ${user.id} error | consumer with id "${consumerId}" not found.`);
            return;
        }

        // Запоминаем, что клиент поставил на паузу вручную.
        (consumer.appData as ConsumerAppData).clientPaused = true;

        await this.pauseConsumer(consumer);
    }

    /** Поставить consumer на паузу. */
    public async pauseConsumer(consumer: MediasoupTypes.Consumer)
    {
        // Если уже не на паузе.
        if (!consumer.paused)
        {
            await consumer.pause();

            // Поскольку consumer поставлен на паузу,
            // то уменьшаем счетчик и перерасчитываем битрейт.
            this.mediasoup.decreaseConsumersCount(consumer.kind);
            this.calculateAndEmitNewMaxVideoBitrate();
        }
    }

    /** Пользователь user запросил снять с паузы поток-потребитель с идентификатором consumerId. */
    public async userRequestedResumeConsumer(
        user: User,
        consumerId: string
    )
    {
        const consumer = user.consumers.get(consumerId);

        if (!consumer)
        {
            console.error(`[Room] resumeConsumer for User ${user.id} error | consumer with id "${consumerId}" not found.`);
            return;
        }

        // Клиент хотел снять с паузы consumer, поэтому выключаем флаг ручной паузы.
        (consumer.appData as ConsumerAppData).clientPaused = false;

        await this.resumeConsumer(consumer);
    }


    /** Снять consumer с паузы. */
    public async resumeConsumer(consumer: MediasoupTypes.Consumer)
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

            // Поскольку consumer снят с паузы,
            // то увеличиваем счетчик и перерасчитываем битрейт.
            this.mediasoup.increaseConsumersCount(consumer.kind);
            this.calculateAndEmitNewMaxVideoBitrate();
        }
    }

    /** Создать поток-производитель, который описан с помощью newProducerInfo, для пользователя user. */
    public async createProducer(
        user: User,
        newProducerInfo: NewProducerInfo
    )
    {
        const producer = await this.mediasoup.createProducer(
            user,
            newProducerInfo,
            this.mediasoupRouters
        );

        user.producers.set(producer.id, producer);

        this.mediasoup.increaseProducersCount(producer.kind);
        this.calculateAndEmitNewMaxVideoBitrate();

        return producer;
    }

    /** Поток-потребитель был завершен, поэтому необходимо обработать это событие. */
    public producerClosed(
        producer: MediasoupTypes.Producer,
        user: User
    ): void
    {
        user.producers.delete(producer.id);

        // Если он и так был на паузе, то не учитывать его удаление в расчете битрейта.
        if (!producer.paused)
        {
            this.mediasoup.decreaseProducersCount(producer.kind);
            this.calculateAndEmitNewMaxVideoBitrate();
        }
    }

    /** Пользователь user запросил закрыть поток-производитель с идентификатором producerId. */
    public userRequestedCloseProducer(
        user: User,
        producerId: string
    ): void
    {
        const producer = user.producers.get(producerId);

        if (!producer)
        {
            console.error(`[Room] closeProducer for User ${user.id} error | producer with id "${producerId}" not found.`);
            return;
        }

        // Завершаем поток.
        producer.close();

        // Обрабатываем это событие.
        this.producerClosed(producer, user);
    }

    /** Пользователь user запросил поставить на паузу поток-производитель с идентификатором producerId. */
    public async userRequestedPauseProducer(
        user: User,
        producerId: string
    )
    {
        const producer = user.producers.get(producerId);

        if (!producer)
        {
            console.error(`[Room] pauseProducer for User ${user.id} error | producer with id "${producerId}" not found.`);
            return;
        }

        await this.pauseProducer(producer);
    }

    /** Поставить на паузу поток-производитель producer. */
    private async pauseProducer(producer: MediasoupTypes.Producer)
    {
        if (!producer.paused)
        {
            await producer.pause();

            this.mediasoup.decreaseProducersCount(producer.kind);
            this.calculateAndEmitNewMaxVideoBitrate();
        }
    }

    /** Пользователь user запросил снять с паузы поток-производитель с идентификатором producerId. */
    public async userRequestedResumeProducer(
        user: User,
        producerId: string
    )
    {
        const producer = user.producers.get(producerId);

        if (!producer)
        {
            console.error(`[Room] resumeProducer for User ${user.id} error | producer with id "${producerId}" not found.`);
            return;
        }

        await this.resumeProducer(producer);
    }

    /** Снять с паузы поток-производитель producer. */
    private async resumeProducer(producer: MediasoupTypes.Producer)
    {
        if (producer.paused)
        {
            await producer.resume();

            this.mediasoup.increaseProducersCount(producer.kind);
            this.calculateAndEmitNewMaxVideoBitrate();
        }
    }

    /** Пользователь отключился из комнаты. */
    public userDisconnected(userId: string): void
    {
        const user = this.users.get(userId);

        if (!user)
        {
            return;
        }

        user.consumerTransport?.close();
        user.producerTransport?.close();

        this.users.delete(userId);
    };

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