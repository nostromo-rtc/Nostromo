import mediasoup = require('mediasoup');
import { NewProducerInfo, PrefixConstants, VideoCodec } from "nostromo-shared/types/RoomTypes";
import { ActiveUser } from './Room/Room';
import MediasoupTypes = mediasoup.types;

export { MediasoupTypes };

export type ServerProducerAppData = {
    streamId: string;
};

export type ServerConsumerAppData = {
    /**
     * Consumer был поставлен на паузу со стороны клиента
     * (клиент поставил плеер на паузу)
     */
    clientPaused: boolean;
};

export interface IMediasoupService
{
    /** Входящая скорость сервера (в мегабитах Mbit). */
    readonly networkIncomingCapability: number;

    /** Исходящая скорость сервера (в мегабитах Mbit). */
    readonly networkOutcomingCapability: number;

    /** Максимальный битрейт (бит) для видеопотока с демонстрацией экрана на сервере. */
    readonly maxDisplayVideoBitrate: number;

    /** Максимальный битрейт (бит) для видеопотока с изображением веб-камеры на сервере. */
    readonly maxCamVideoBitrate: number;

    /** Максимальный битрейт (Кбит) для аудиопотоков на сервере. */
    readonly maxAudioBitrate: number;

    /** Максимальный доступный битрейт (Кбит) для видеопотоков на сервере. */
    maxAvailableVideoBitrate: number;

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

    /** Создать поток-потребитель для пользователя.
     * @throws Error, если пользователь не может потреблять данный Producer.
     * @throws Error, если у пользователя нет Transport для потребления.
    */
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

    /** Создать поток-производитель для пользователя.
     * @throws Error, если не удалось найти Transport с указанным Id.
     */
    createProducer(
        user: ActiveUser,
        newProducerInfo: NewProducerInfo,
        routers: MediasoupTypes.Router[]
    ): Promise<MediasoupTypes.Producer>;

    /** Рассчитываем новый максимальный доступный битрейт для видеопотоков. */
    calculateNewAvailableMaxVideoBitrate(): void;
}

export class MediasoupService implements IMediasoupService
{
    private mediasoupWorkers = new Array<MediasoupTypes.Worker>();

    public readonly networkIncomingCapability: number =
        (process.env.NETWORK_INCOMING_CAPABILITY !== undefined)
            ? Number(process.env.NETWORK_INCOMING_CAPABILITY) : 100;
    public readonly networkOutcomingCapability: number =
        (process.env.NETWORK_OUTCOMING_CAPABILITY !== undefined)
            ? Number(process.env.NETWORK_OUTCOMING_CAPABILITY) : 100;

    public readonly enableUdp: boolean = (process.env.MEDIASERVER_RTC_ENABLE_UDP === "false") ? false : true;
    public readonly enableTcp: boolean = (process.env.MEDIASERVER_RTC_ENABLE_TCP === "false") ? false : true;
    public readonly preferUdp: boolean = (process.env.MEDIASERVER_RTC_PREFER_UDP === "false") ? false : true;
    public readonly preferTcp: boolean = (process.env.MEDIASERVER_RTC_PREFER_TCP === "true") ? true : false;

    public readonly localIp: string = (
        process.env.MEDIASERVER_LOCAL_IP !== undefined
        && process.env.MEDIASERVER_LOCAL_IP !== ""
    ) ? process.env.MEDIASERVER_LOCAL_IP : "0.0.0.0";

    public readonly announcedIp: string = (
        process.env.MEDIASERVER_ANNOUNCED_IP !== undefined
        && process.env.MEDIASERVER_ANNOUNCED_IP !== ""
    ) ? process.env.MEDIASERVER_ANNOUNCED_IP : "none";

    public maxAudioBitrate = (
        (process.env.MAX_AUDIO_BITRATE !== undefined)
            ? Number(process.env.MAX_AUDIO_BITRATE) : 64
    ) * PrefixConstants.KILO;

    /** Максимальное суммарное значение битрейта (Кбит) видеопотоков от клиента.
        Применимо только для клиентов с браузерами на основе libwebrtc (Chromium и т.д). */
    private readonly maxTotalGoogleVideoBitrate: number = (
        (process.env.MAX_TOTAL_GOOGLE_VIDEO_BITRATE !== undefined)
            ? Number(process.env.MAX_TOTAL_GOOGLE_VIDEO_BITRATE) : 20
    ) * PrefixConstants.KILO;

    public readonly maxDisplayVideoBitrate = (
        (process.env.MAX_DISPLAY_VIDEO_BITRATE !== undefined)
            ? Number(process.env.MAX_DISPLAY_VIDEO_BITRATE) : 10
    ) * PrefixConstants.MEGA;

    public readonly maxCamVideoBitrate = (
        (process.env.MAX_CAM_VIDEO_BITRATE !== undefined)
            ? Number(process.env.MAX_CAM_VIDEO_BITRATE) : 2.5
    ) * PrefixConstants.MEGA;

    /** Enable WebRTC extension: Transport-Wide Congestion Control? */
    public readonly enableGoogleVideoTWCC: boolean = (process.env.ENABLE_GOOGLE_VIDEO_TWCC === "true") ? true : false;

    /** Enable WebRTC extension: Transport-Wide Congestion Control? */
    public readonly enableGoogleAudioTWCC: boolean = (process.env.ENABLE_GOOGLE_AUDIO_TWCC === "true") ? true : false;

    public maxAvailableVideoBitrate = -1;

    private _videoConsumersCount = 0;
    public get videoConsumersCount(): number { return this._videoConsumersCount; }

    private _audioConsumersCount = 0;
    public get audioConsumersCount(): number { return this._audioConsumersCount; }

    private _videoProducersCount = 0;
    public get videoProducersCount(): number { return this._videoProducersCount; }

    private _audioProducersCount = 0;
    public get audioProducersCount(): number { return this._audioProducersCount; }

    // аудио кодек
    private readonly audioCodecConf: MediasoupTypes.RtpCodecCapability = {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
    };

    // VP9
    private readonly videoCodecVp9Conf: MediasoupTypes.RtpCodecCapability = {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters:
        {
            'x-google-min-bitrate': this.maxTotalGoogleVideoBitrate,
            'x-google-max-bitrate': this.maxTotalGoogleVideoBitrate
        }
    };

    // VP8
    private readonly videoCodecVp8Conf: MediasoupTypes.RtpCodecCapability = {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters:
        {
            'x-google-min-bitrate': this.maxTotalGoogleVideoBitrate,
            'x-google-max-bitrate': this.maxTotalGoogleVideoBitrate
        }
    };

    // H264
    private readonly videoCodecH264Conf: MediasoupTypes.RtpCodecCapability = {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters:
        {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-min-bitrate': this.maxTotalGoogleVideoBitrate,
            'x-google-max-bitrate': this.maxTotalGoogleVideoBitrate
        }
    };

    // Создаем экземпляр класса (внутри которого создаются Workers).
    public static async create(numWorkers: number): Promise<MediasoupService>
    {
        console.log(`[MediasoupService] Running ${numWorkers} mediasoup Workers.`);

        const workers = new Array<MediasoupTypes.Worker>();

        for (let i = 0; i < numWorkers; ++i)
        {
            const worker: MediasoupTypes.Worker = await mediasoup.createWorker(
                {
                    rtcMinPort: Number(process.env.MEDIASERVER_RTC_MIN_PORT ?? 40000),
                    rtcMaxPort: Number(process.env.MEDIASERVER_RTC_MAX_PORT ?? 50000)
                });

            worker.on('died', (error) =>
            {
                console.error(
                    `[ERROR] [MediasoupService] Mediasoup Worker died [pid: ${worker.pid}]`, error.message
                );
            });

            workers.push(worker);
        }

        const service = new MediasoupService(workers);
        console.log(`[MediasoupService] Info about TCP and UDP support:\n> enableUdp: ${String(service.enableUdp)} | enableTcp: ${String(service.enableTcp)} | preferUdp: ${String(service.preferUdp)} | preferTcp: ${String(service.preferTcp)}.`);
        console.log(`[MediasoupService] Info about server IPs:\n> localIp: ${String(service.localIp)} | announcedIp: ${String(service.announcedIp)}.`);
        console.log(`[MediasoupService] Max total google video bitrate ('x-google-min-bitrate'): ${service.maxTotalGoogleVideoBitrate / PrefixConstants.KILO} Mbit/s.`);
        console.log(`[MediasoupService] Max display video bitrate: ${service.maxDisplayVideoBitrate / PrefixConstants.MEGA} Mbit/s.`);
        console.log(`[MediasoupService] Max cam video bitrate: ${service.maxCamVideoBitrate / PrefixConstants.MEGA} Mbit/s.`);
        console.log(`[MediasoupService] Max audio bitrate: ${service.maxAudioBitrate} bit/s.`);

        return service;
    }

    private constructor(workers: MediasoupTypes.Worker[])
    {
        this.mediasoupWorkers = workers;
        this.calculateNewAvailableMaxVideoBitrate();
    }

    public async createRouters(codecChoice: VideoCodec): Promise<MediasoupTypes.Router[]>
    {
        // сначала звуковой кодек opus
        const mediaCodecs = new Array<MediasoupTypes.RtpCodecCapability>(this.audioCodecConf);

        // теперь определяемся с кодеками для видео
        if (codecChoice == VideoCodec.VP9)
        {
            mediaCodecs.push(this.videoCodecVp9Conf);
        }
        else if (codecChoice == VideoCodec.VP8)
        {
            mediaCodecs.push(this.videoCodecVp8Conf);
        }
        else if (codecChoice == VideoCodec.H264)
        {
            mediaCodecs.push(this.videoCodecH264Conf);
        }

        const routerOptions: MediasoupTypes.RouterOptions = { mediaCodecs };

        const routers: MediasoupTypes.Router[] = [];

        for (const worker of this.mediasoupWorkers)
        {
            const router = await worker.createRouter(routerOptions);

            if (!this.enableGoogleVideoTWCC)
            {
                router.rtpCapabilities.headerExtensions = router.rtpCapabilities.headerExtensions?.
                    filter((ext) =>
                        !(ext.uri === "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01" && ext.kind === "video") &&
                        !(ext.uri === "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time" && ext.kind === "video")
                    );
            }

            if (!this.enableGoogleAudioTWCC)
            {
                router.rtpCapabilities.headerExtensions = router.rtpCapabilities.headerExtensions?.
                    filter((ext) =>
                        !(ext.uri === "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01" && ext.kind === "audio") &&
                        !(ext.uri === "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time" && ext.kind === "audio")
                    );
            }

            routers.push(router);
        }

        return routers;
    }
    public async createWebRtcTransport(
        user: ActiveUser,
        router: MediasoupTypes.Router,
        consuming: boolean
    ): Promise<MediasoupTypes.WebRtcTransport>
    {
        const listenIps: (MediasoupTypes.TransportListenIp)[] = [{ ip: this.localIp }];

        if (this.announcedIp != "none")
        {
            listenIps.push({
                ip: this.localIp,
                announcedIp: this.announcedIp
            });
        }

        const transport = await router.createWebRtcTransport({
            listenIps,
            initialAvailableOutgoingBitrate: 600000,
            enableUdp: this.enableUdp,
            enableTcp: this.enableTcp,
            preferUdp: this.preferUdp,
            preferTcp: this.preferTcp
        });

        transport.on('icestatechange', (state: MediasoupTypes.IceState) =>
        {
            const iceTuple = transport.iceSelectedTuple;

            if (!iceTuple)
            {
                return;
            }

            const logMsg = `[MediasoupService] User [${user.userId}] in Room [${user.roomId}] | ${consuming ? "consumer" : "producer"} WebRtcTransport | icestatechange event:\n> ${state}`;
            const ipInfo = `[${iceTuple.protocol}] Local: ${iceTuple.localIp}:${iceTuple.localPort}, Remote: ${iceTuple.remoteIp ?? "?"}:${iceTuple.remotePort ?? "?"}`;
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
                const logMsg = `[MediasoupService] User [${user.userId}] in Room [${user.roomId}] | ${consuming ? "consumer" : "producer"} WebRtcTransport | dtlsstatechange event:\n> ${dtlsstate}`;
                const ipInfo = `[${iceTuple.protocol}] Local: ${iceTuple.localIp}:${iceTuple.localPort}, Remote: ${iceTuple.remoteIp ?? "?"}:${iceTuple.remotePort ?? "?"}`;
                console.error(`[ERROR] ${logMsg} | ${ipInfo}.`);
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

    public async createProducer(
        user: ActiveUser,
        newProducerInfo: NewProducerInfo,
        routers: MediasoupTypes.Router[]
    ): Promise<MediasoupTypes.Producer>
    {
        const { transportId, kind, rtpParameters, streamId } = newProducerInfo;

        const transport = user.getTransportById(transportId);

        if (!transport)
        {
            throw new Error(`Transport [${transportId}] for User [${user.userId}] is not found.`);
        }

        const appData: ServerProducerAppData = { streamId };

        const producer = await transport.produce({ kind, rtpParameters, appData });

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
            throw new Error(`User [${user.userId}] can't consume.`);
        }

        // Берем Transport пользователя, предназначенный для потребления.
        const transport = user.consumerTransport;

        if (!transport)
        {
            throw new Error(`Transport for consuming of User [${user.userId}] is not found.`);
        }

        // Создаем Consumer в режиме паузы.
        const consumer = await transport.consume({
            producerId: producer.id,
            rtpCapabilities: user.rtpCapabilities,
            paused: true
        });

        // Поскольку он создан в режиме паузы, отметим, как будто это клиент поставил на паузу
        // когда клиент запросит снятие consumer с паузы, этот флаг сменится на false
        // клиент должен запросить снятие паузы как только подготовит consumer на своей стороне.
        (consumer.appData as ServerConsumerAppData).clientPaused = true;

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

    public calculateNewAvailableMaxVideoBitrate(): void
    {
        // Максимальный битрейт для аудио в мегабитах.
        const maxAudioBitrateMbs = this.maxAudioBitrate / PrefixConstants.MEGA;

        // Количество видеопотоков-производителей.
        const producersCount: number = (this.videoProducersCount != 0) ? this.videoProducersCount : 1;

        // Количество видеопотоков-потребителей.
        const consumersCount: number = (this.videoConsumersCount != 0) ? this.videoConsumersCount : 1;

        // Входящая и исходящая скорость сервера за вычетом затрат на аудиопотоки.
        const availableIncomingCapability = this.networkIncomingCapability - (maxAudioBitrateMbs * this.audioProducersCount);
        const availableOutcomingCapability = this.networkOutcomingCapability - (maxAudioBitrateMbs * this.audioConsumersCount);

        const availableVideoBitrate: number = Math.min(
            availableIncomingCapability / producersCount,
            availableOutcomingCapability / consumersCount
        ) * PrefixConstants.MEGA;

        if (availableVideoBitrate > 0)
        {
            this.maxAvailableVideoBitrate = availableVideoBitrate;
        }
        else
        {
            this.maxAvailableVideoBitrate = -1;
        }
    }
}