import mediasoup = require('mediasoup');
import { NewProducerInfo, VideoCodec } from 'shared/RoomTypes';
import { User } from './Room';
import MediasoupTypes = mediasoup.types;

export { MediasoupTypes };

export class Mediasoup
{
    private mediasoupWorkers = new Array<MediasoupTypes.Worker>();

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
    private videoCodecsH264Conf: MediasoupTypes.RtpCodecCapability[] =
        [
            {
                kind: 'video',
                mimeType: 'video/h264',
                clockRate: 90000,
                parameters:
                {
                    'packetization-mode': 1,
                    'profile-level-id': '4d0032',
                    'level-asymmetry-allowed': 1,
                    'x-google-start-bitrate': 1000
                }
            },
            {
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
            }
        ];

    // создаем экземпляр класса (внутри которого создаются Workers)
    public static async create(numWorkers: number): Promise<Mediasoup>
    {
        console.log('[Mediasoup] running %d mediasoup Workers...', numWorkers);

        let workers = new Array<MediasoupTypes.Worker>();

        for (let i: number = 0; i < numWorkers; ++i)
        {
            const worker: MediasoupTypes.Worker = await mediasoup.createWorker(
                {
                    logLevel: 'debug',
                    rtcMinPort: 40000,
                    rtcMaxPort: 50000
                });

            worker.on('died', () =>
            {
                console.error(
                    '[Mediasoup] mediasoup Worker died, exiting in 3 seconds... [pid:%d]', worker.pid);

                setTimeout(() => process.exit(1), 3000);
            });

            workers.push(worker);
        }

        return new Mediasoup(workers);
    }

    private constructor(workers: Array<MediasoupTypes.Worker>)
    {
        this.mediasoupWorkers = workers;
    }

    private getWorker(): MediasoupTypes.Worker
    {
        // пока временно возвращаем первый Worker из массива
        const worker: MediasoupTypes.Worker = this.mediasoupWorkers[0];
        return worker;
    }

    // создать Router
    public async createRouter(codecChoice: VideoCodec): Promise<MediasoupTypes.Router>
    {
        // сначала звуковой кодек opus
        let mediaCodecs = new Array<MediasoupTypes.RtpCodecCapability>(this.audioCodecConf);

        // теперь определяемся с кодеками для видео
        if (codecChoice == VideoCodec.VP9) mediaCodecs.push(this.videoCodecVp9Conf);
        else if (codecChoice == VideoCodec.VP8) mediaCodecs.push(this.videoCodecVp8Conf);
        else if (codecChoice == VideoCodec.H264) mediaCodecs = mediaCodecs.concat(this.videoCodecsH264Conf);

        const routerOptions: MediasoupTypes.RouterOptions = { mediaCodecs };

        const router = await this.getWorker().createRouter(routerOptions);

        return router;
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
                { ip: "192.168.1.4" },
                { ip: "192.168.1.4", announcedIp: "62.220.53.229" }
            ],
            initialAvailableOutgoingBitrate: 1000000,
            enableUdp: true,
            appData: { consuming }
        });

        transport.on('icestatechange', (state: MediasoupTypes.IceState) =>
        {
            console.debug('[Mediasoup] WebRtcTransport - icestatechange event: ', transport.iceSelectedTuple?.remoteIp, state);
        });

        transport.on('dtlsstatechange', (dtlsstate: MediasoupTypes.DtlsState) =>
        {
            if (dtlsstate === 'failed' || dtlsstate === 'closed')
                console.error('[Mediasoup] WebRtcTransport - dtlsstatechange event: ', transport.iceSelectedTuple?.remoteIp, dtlsstate);
        });

        user.transports.set(transport.id, transport);

        return transport;
    }

    // создаем производителя (producer) для user
    public async createProducer(
        user: User,
        newProducerInfo: NewProducerInfo
    ): Promise<MediasoupTypes.Producer>
    {
        const { transportId, kind, rtpParameters } = newProducerInfo;

        if (!user.transports.has(transportId))
            throw new Error(`[Mediasoup] transport with id "${transportId}" not found`);

        const transport = user.transports.get(transportId)!;

        const producer = await transport.produce({ kind, rtpParameters });

        user.producers.set(producer.id, producer);

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
            !router.canConsume(
                {
                    producerId: producer.id,
                    rtpCapabilities: user.rtpCapabilities
                })
        )
        {
            throw new Error(`[Mediasoup] User ${user} can't consume`);
        }

        // берем Transport пользователя, предназначенный для потребления
        const transport = Array.from(user.transports.values())
            .find((tr) => tr.appData.consuming);

        if (!transport)
        {
            throw new Error('[Mediasoup] Transport for consuming not found');
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
        }
        catch (error)
        {
            throw new Error(`[Mediasoup] transport.consume(): ${error}`);
        }

        // сохраняем Consumer у пользователя
        user.consumers.set(consumer.id, consumer);

        return consumer;
    }
}