import mediasoup = require('mediasoup');
import { NewProducerInfo, PrefixConstants, VideoCodec } from "nostromo-shared/types/RoomTypes";
import { ActiveUser } from './Room';
import MediasoupTypes = mediasoup.types;

export { MediasoupTypes };

export interface ConsumerAppData
{
    /**
     * Consumer был поставлен на паузу со стороны клиента
     * (клиент поставил плеер на паузу)
     */
    clientPaused: boolean;
}

export interface IMediasoupService
{
    /** Входящая скорость сервера (в мегабитах Mbit). */
    readonly networkIncomingCapability: number;

    /** Исходящая скорость сервера (в мегабитах Mbit). */
    readonly networkOutcomingCapability: number;

    /** Максимальный битрейт (Кбит) для видеопотоков на сервере. */
    maxVideoBitrate: number;

    /** Максимальный битрейт (Кбит) для аудиопотоков на сервере. */
    maxAudioBitrate: number;

    /** Количество видеопотоков-потребителей. */
    get videoConsumersCount(): number;

    /** Количество аудиопотоков-потребителей. */
    get audioConsumersCount(): number;

    /** Количество видеопотоков-производителей. */
    get videoProducersCount(): number;

    /** Количество аудиопотоков-производителей. */
    get audioProducersCount(): number;

    /** Создать роутеры. */
    createRouters(codecChoice: VideoCodec): Promise<MediasoupTypes.Router[]>;

    /**
     * Создать транспортный канал для user.
     * @param consuming Канал для отдачи потоков от сервера клиенту?
     */
    createWebRtcTransport(
        user: ActiveUser,
        router: MediasoupTypes.Router,
        consuming: boolean
    ): Promise<MediasoupTypes.WebRtcTransport>;

    /** Создать поток-потребитель для пользователя. */
    createConsumer(
        user: ActiveUser,
        producer: MediasoupTypes.Producer,
        router: MediasoupTypes.Router
    ): Promise<MediasoupTypes.Consumer>;

    /** Увеличить счётчик потоков-потребителей на сервере. */
    increaseConsumersCount(kind: MediasoupTypes.MediaKind): void;

    /** Уменьшить счётчик потоков-потребителей на сервере. */
    decreaseConsumersCount(kind: MediasoupTypes.MediaKind): void;

    /** Увеличить счётчик потоков-производителей на сервере. */
    increaseProducersCount(kind: MediasoupTypes.MediaKind): void;

    /** Уменьшить счётчик потоков-производителей на сервере. */
    decreaseProducersCount(kind: MediasoupTypes.MediaKind): void;

    /** Создать поток-производитель для пользователя. */
    createProducer(
        user: ActiveUser,
        newProducerInfo: NewProducerInfo,
        routers: MediasoupTypes.Router[]
    ): Promise<MediasoupTypes.Producer>;

    /** Рассчитываем новый максимальный битрейт для видеопотоков. */
    calculateNewMaxVideoBitrate(): void;
}

export class MediasoupService implements IMediasoupService
{
    private mediasoupWorkers = new Array<MediasoupTypes.Worker>();

    public readonly networkIncomingCapability: number = Number(process.env.NETWORK_INCOMING_CAPABILITY) ?? 100;
    public readonly networkOutcomingCapability: number = Number(process.env.NETWORK_OUTCOMING_CAPABILITY) ?? 100;

    /** Максимальный битрейт (Кбит) для аудиопотоков на сервере. */
    public maxAudioBitrate = 64 * PrefixConstants.KILO;

    public maxVideoBitrate = -1;

    private _videoConsumersCount = 0;
    public get videoConsumersCount(): number { return this._videoConsumersCount; }

    private _audioConsumersCount = 0;
    public get audioConsumersCount(): number { return this._audioConsumersCount; }

    private _videoProducersCount = 0;
    public get videoProducersCount(): number { return this._videoProducersCount; }

    private _audioProducersCount = 0;
    public get audioProducersCount(): number { return this._audioProducersCount; }

    // аудио кодек
    private audioCodecConf: MediasoupTypes.RtpCodecCapability = {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
    };
    // VP9
    private videoCodecVp9Conf: MediasoupTypes.RtpCodecCapability = {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters:
        {
            'x-google-start-bitrate': 1000
        }
    };
    // VP8
    private videoCodecVp8Conf: MediasoupTypes.RtpCodecCapability = {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters:
        {
            'x-google-start-bitrate': 1000
        }
    };
    // H264
    private videoCodecH264Conf: MediasoupTypes.RtpCodecCapability = {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters:
        {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000
        }
    };

    // создаем экземпляр класса (внутри которого создаются Workers)
    public static async create(numWorkers: number): Promise<MediasoupService>
    {
        console.log(`[Mediasoup] running ${numWorkers} mediasoup Workers...`);

        const workers = new Array<MediasoupTypes.Worker>();

        for (let i = 0; i < numWorkers; ++i)
        {
            const worker: MediasoupTypes.Worker = await mediasoup.createWorker(
                {
                    rtcMinPort: Number(process.env.MEDIASOUP_RTC_MIN_PORT ?? 40000),
                    rtcMaxPort: Number(process.env.MEDIASOUP_RTC_MAX_PORT ?? 50000)
                });

            worker.on('died', (error) =>
            {
                console.error(
                    `[Mediasoup] mediasoup Worker died [pid: ${worker.pid}]`, (error as Error).message
                );
            });

            workers.push(worker);
        }

        return new MediasoupService(workers);
    }

    private constructor(workers: MediasoupTypes.Worker[])
    {
        this.mediasoupWorkers = workers;
    }

    public async createRouters(codecChoice: VideoCodec): Promise<MediasoupTypes.Router[]>
    {
        // сначала звуковой кодек opus
        const mediaCodecs = new Array<MediasoupTypes.RtpCodecCapability>(this.audioCodecConf);

        // теперь определяемся с кодеками для видео
        if (codecChoice == VideoCodec.VP9) mediaCodecs.push(this.videoCodecVp9Conf);
        else if (codecChoice == VideoCodec.VP8) mediaCodecs.push(this.videoCodecVp8Conf);
        else if (codecChoice == VideoCodec.H264) mediaCodecs.push(this.videoCodecH264Conf);

        const routerOptions: MediasoupTypes.RouterOptions = { mediaCodecs };

        const routers: MediasoupTypes.Router[] = [];

        for (const worker of this.mediasoupWorkers)
        {
            routers.push(await worker.createRouter(routerOptions));
        }

        return routers;
    }
    public async createWebRtcTransport(
        user: ActiveUser,
        router: MediasoupTypes.Router,
        consuming: boolean
    ): Promise<MediasoupTypes.WebRtcTransport>
    {
        const transport = await router.createWebRtcTransport({
            listenIps: [
                { ip: process.env.MEDIASOUP_LOCAL_IP! },
                {
                    ip: process.env.MEDIASOUP_LOCAL_IP!,
                    announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP!
                }
            ],
            initialAvailableOutgoingBitrate: 600000,
            enableUdp: true
        });

        transport.on('icestatechange', (state: MediasoupTypes.IceState) =>
        {
            const iceTuple = transport.iceSelectedTuple;

            if (!iceTuple)
            {
                return;
            }

            const logMsg = `[Mediasoup] User: ${user.userId} > WebRtcTransport icestatechange event: ${state}`;
            const ipInfo = `Local: ${iceTuple.localIp}:${iceTuple.localPort}, Remote: ${iceTuple.remoteIp ?? "?"}:${iceTuple.remotePort ?? "?"}`;
            console.log(`${logMsg} | ${ipInfo}.`);
        });

        transport.on('dtlsstatechange', (dtlsstate: MediasoupTypes.DtlsState) =>
        {
            const iceTuple = transport.iceSelectedTuple;

            if (!iceTuple)
            {
                return;
            }

            if (dtlsstate === 'failed' || dtlsstate === 'closed')
            {
                const logMsg = `[Mediasoup] User: ${user.userId} > WebRtcTransport > dtlsstatechange event: ${dtlsstate}`;
                const ipInfo = `Local: ${iceTuple.localIp}:${iceTuple.localPort}, Remote: ${iceTuple.remoteIp ?? "?"}:${iceTuple.remotePort ?? "?"}`;
                console.error(`${logMsg} | ${ipInfo}.`);
            }
        });

        if (consuming)
        {
            user.consumerTransport = transport;
        }
        else
        {
            user.producerTransport = transport;
        }

        return transport;
    }

    // создаем производителя (producer) для user
    public async createProducer(
        user: ActiveUser,
        newProducerInfo: NewProducerInfo,
        routers: MediasoupTypes.Router[]
    ): Promise<MediasoupTypes.Producer>
    {
        const { transportId, kind, rtpParameters } = newProducerInfo;

        const transport = user.getTransportById(transportId);

        if (!transport)
        {
            throw new Error(`[Mediasoup] transport with id "${transportId}" not found`);
        }

        const producer = await transport.produce({ kind, rtpParameters });

        // TODO: возможно pipe не стоит делать сразу на все роутеры
        // и делать его при востребовании producer при попытке создания consumer от одного из роутеров
        // но я какого-то повышенного потребления ОЗУ/ЦП от этого (когда всё за раз) не заметил

        const producerRouter = routers[0];

        for (const router of routers)
        {
            if (producerRouter.id != router.id)
            {
                await producerRouter.pipeToRouter({ producerId: producer.id, router });
            }
        }

        return producer;
    }

    public async createConsumer(
        user: ActiveUser,
        producer: MediasoupTypes.Producer,
        router: MediasoupTypes.Router
    ): Promise<MediasoupTypes.Consumer>
    {
        // Не создаем consumer, если пользователь не может потреблять медиапоток.
        if (!user.rtpCapabilities ||
            !router.canConsume({
                producerId: producer.id,
                rtpCapabilities: user.rtpCapabilities
            })
        )
        {
            throw new Error(`[Mediasoup] User can't consume`);
        }

        // Берем Transport пользователя, предназначенный для потребленияю
        const transport = user.consumerTransport;

        if (!transport)
        {
            throw new Error(`[Mediasoup] Transport for consuming not found`);
        }

        // Создаем Consumer в режиме паузы.
        let consumer: MediasoupTypes.Consumer;

        try
        {
            consumer = await transport.consume({
                producerId: producer.id,
                rtpCapabilities: user.rtpCapabilities,
                paused: true
            });
            // Поскольку он создан в режиме паузы, отметим, как будто это клиент поставил на паузу
            // когда клиент запросит снятие consumer с паузы, этот флаг сменится на false
            // клиент должен запросить снятие паузы как только подготовит consumer на своей стороне.
            (consumer.appData as ConsumerAppData).clientPaused = true;
        }
        catch (error)
        {
            const err = error as Error;
            throw new Error(`[Mediasoup] transport.consume() | ${err.name}: ${err.message}`);
        }

        return consumer;
    }

    public increaseConsumersCount(kind: MediasoupTypes.MediaKind): void
    {
        if (kind == 'video')
        {
            ++this._videoConsumersCount;
        }
        else
        {
            ++this._audioConsumersCount;
        }
    }
    public decreaseConsumersCount(kind: MediasoupTypes.MediaKind): void
    {
        if (kind == 'video')
        {
            --this._videoConsumersCount;
        }
        else
        {
            --this._audioConsumersCount;
        }
    }

    public increaseProducersCount(kind: MediasoupTypes.MediaKind): void
    {
        if (kind == 'video')
        {
            ++this._videoProducersCount;
        }
        else
        {
            ++this._audioProducersCount;
        }
    }
    public decreaseProducersCount(kind: MediasoupTypes.MediaKind): void
    {
        if (kind == 'video')
        {
            --this._videoProducersCount;
        }
        else
        {
            --this._audioProducersCount;
        }
    }

    public calculateNewMaxVideoBitrate(): void
    {
        // Максимальный битрейт для аудио в мегабитах.
        const maxAudioBitrateMbs = this.maxAudioBitrate / PrefixConstants.MEGA;

        // Количество видеопотоков-производителей.
        const producersCount: number = this.videoProducersCount;

        if (producersCount > 0)
        {
            // Количество видеопотоков-потребителей.
            const consumersCount: number = (this.videoConsumersCount != 0) ? this.videoConsumersCount : 1;

            // Входящая и исходящая скорость сервера за вычетом затрат на аудиопотоки.
            const availableIncomingCapability = this.networkIncomingCapability - (maxAudioBitrateMbs * this.audioProducersCount);
            const availableOutcomingCapability = this.networkOutcomingCapability - (maxAudioBitrateMbs * this.audioConsumersCount);

            const maxVideoBitrate: number = Math.min(
                availableIncomingCapability / producersCount,
                availableOutcomingCapability / consumersCount
            ) * PrefixConstants.MEGA;

            if (maxVideoBitrate > 0)
            {
                this.maxVideoBitrate = maxVideoBitrate;
                return;
            }
        }

        this.maxVideoBitrate = -1;
    }
}