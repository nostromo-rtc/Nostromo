import mediasoup = require('mediasoup');
import { NewProducerInfo, VideoCodec } from "nostromo-shared/types/RoomTypes";
import { User } from './Room';
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

export class MediasoupService
{
    // массив workers, задел под многопоточность
    private mediasoupWorkers = new Array<MediasoupTypes.Worker>();

    // сетевые возможности сервера (в мегабитах Mbit)
    // для расчета максимального битрейта видеопотока клиента
    public readonly networkIncomingCapability: number = Number(process.env.NETWORK_INCOMING_CAPABILITY) ?? 100;
    public readonly networkOutcomingCapability: number = Number(process.env.NETWORK_OUTCOMING_CAPABILITY) ?? 100;

    // количество потребителей на сервере
    private _videoConsumersCount = 0;
    public get videoConsumersCount(): number { return this._videoConsumersCount; }

    private _audioConsumersCount = 0;
    public get audioConsumersCount(): number { return this._audioConsumersCount; }

    // количество производителей на сервере
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

    // создать роутеры для комнаты
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

    // создать транспортный канал для user
    // если consuming = true,   то канал для приема потоков
    // если consuming = false,  то канал для отдачи потоков
    public async createWebRtcTransport(
        user: User,
        consuming: boolean,
        router: MediasoupTypes.Router
    ): Promise<MediasoupTypes.WebRtcTransport>
    {
        const transport = await router.createWebRtcTransport({
            listenIps: [
                { ip: process.env.MEDIASOUP_LOCAL_IP! },
                { ip: process.env.MEDIASOUP_LOCAL_IP!, announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP! }
            ],
            initialAvailableOutgoingBitrate: 600000,
            enableUdp: true
        });

        transport.on('icestatechange', (state: MediasoupTypes.IceState) =>
        {
            const remoteIp = transport.iceSelectedTuple?.remoteIp;
            if (!remoteIp) return;

            console.log(`[Mediasoup] User: ${user.userId} > WebRtcTransport > icestatechange event: ${remoteIp} ${state}`);

        });

        transport.on('dtlsstatechange', (dtlsstate: MediasoupTypes.DtlsState) =>
        {
            const remoteIp = transport.iceSelectedTuple?.remoteIp;
            if (!remoteIp) return;

            if (dtlsstate === 'failed' || dtlsstate === 'closed')
                console.error(`[Mediasoup] User: ${user.userId} > WebRtcTransport > dtlsstatechange event: ${remoteIp} ${dtlsstate}`);
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
        user: User,
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

    // создаем потребителя (consumer) для user
    public async createConsumer(
        user: User,
        producer: MediasoupTypes.Producer,
        router: MediasoupTypes.Router
    ): Promise<MediasoupTypes.Consumer>
    {
        // не создаем consumer, если пользователь не может потреблять медиапоток
        if (!user.rtpCapabilities ||
            !router.canConsume({
                producerId: producer.id,
                rtpCapabilities: user.rtpCapabilities
            })
        )
        {
            throw new Error(`[Mediasoup] User can't consume`);
        }

        // берем Transport пользователя, предназначенный для потребления
        const transport = user.consumerTransport;

        if (!transport)
        {
            throw new Error(`[Mediasoup] Transport for consuming not found`);
        }

        // создаем Consumer в режиме паузы
        let consumer: MediasoupTypes.Consumer;

        try
        {
            consumer = await transport.consume({
                producerId: producer.id,
                rtpCapabilities: user.rtpCapabilities,
                paused: true
            });
            // поскольку он создан в режиме паузы, отметим, как будто это клиент поставил на паузу
            // когда клиент запросит снятие consumer с паузы, этот флаг сменится на false
            // клиент должен запросить снятие паузы как только подготовит consumer на своей стороне
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
            ++this._videoConsumersCount;
        else
            ++this._audioConsumersCount;
    }
    public decreaseConsumersCount(kind: MediasoupTypes.MediaKind): void
    {
        if (kind == 'video')
            --this._videoConsumersCount;
        else
            --this._audioConsumersCount;
    }

    public increaseProducersCount(kind: MediasoupTypes.MediaKind): void
    {
        if (kind == 'video')
            ++this._videoProducersCount;
        else
            ++this._audioProducersCount;
    }
    public decreaseProducersCount(kind: MediasoupTypes.MediaKind): void
    {
        if (kind == 'video')
            --this._videoProducersCount;
        else
            --this._audioProducersCount;
    }
}