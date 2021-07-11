import mediasoup = require('mediasoup');
import { User } from './Room';
import MediasoupTypes = mediasoup.types;
export { MediasoupTypes };

export class Mediasoup
{
    private mediasoupWorkers = new Array<MediasoupTypes.Worker>();

    // настройки кодеков на сервере
    private mediaCodecsConf: MediasoupTypes.RtpCodecCapability[] =
        [
            {
                kind: 'audio',
                mimeType: 'audio/opus',
                clockRate: 48000,
                channels: 2
            },
            {
                kind: 'video',
                mimeType: 'video/VP8',
                clockRate: 90000,
                parameters:
                {
                    'x-google-start-bitrate': 1000
                }
            },
            {
                kind: 'video',
                mimeType: 'video/VP9',
                clockRate: 90000,
                parameters:
                {
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

    public static async create(numWorkers: number): Promise<Mediasoup>
    {
        console.log('running %d mediasoup Workers...', numWorkers);

        let workers = new Array<MediasoupTypes.Worker>();

        for (let i: number = 0; i < numWorkers; ++i)
        {
            const worker: MediasoupTypes.Worker = await mediasoup.createWorker(
                {
                    logLevel: 'debug',
                    rtcMinPort: 10000,
                    rtcMaxPort: 59999
                });

            worker.on('died', () =>
            {
                console.error(
                    'mediasoup Worker died, exiting in 3 seconds... [pid:%d]', worker.pid);

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

    public async createRouter(): Promise<MediasoupTypes.Router>
    {
        const routerOptions: MediasoupTypes.RouterOptions =
        {
            mediaCodecs: this.mediaCodecsConf
        };

        const router = await this.getWorker().createRouter(routerOptions);

        return router;
    }

    private async createWebRtcTransport(router: MediasoupTypes.Router): Promise<MediasoupTypes.WebRtcTransport>
    {
        const transport = await router.createWebRtcTransport({
            listenIps: ['127.0.0.1'],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true
        });
        return transport;
    }

    public async createConsumer(
        consumerUser: User,
        producer: MediasoupTypes.Producer,
        router: MediasoupTypes.Router): Promise<mediasoup.types.Consumer>
    {
        // не создаем Consumer, если пользователь не может потреблять медиапоток
        if (!consumerUser.rtpCapabilities ||
            !router.canConsume(
                {
                    producerId: producer.id,
                    rtpCapabilities: consumerUser.rtpCapabilities
                })
        )
        {
            throw new Error(`User ${consumerUser} can't consume`);
        }

        // берем Transport пользователя, предназначенный для потребления
        const transport = Array.from(consumerUser.transports.values())
            .find((tr) => tr.appData.consuming);

        if (!transport)
        {
            throw new Error('Transport for consuming not found');
        }

        // создаем Consumer в режиме паузы
        let consumer: MediasoupTypes.Consumer;

        try
        {
            consumer = await transport.consume(
                {
                    producerId: producer.id,
                    rtpCapabilities: consumerUser.rtpCapabilities,
                    paused: true
                });
        }
        catch (error)
        {
            throw new Error(`transport.consume(): ${error}`);
        }

        // сохраняем Consumer у пользователя
        consumerUser.consumers.set(consumer.id, consumer);

        return consumer;
    }
}