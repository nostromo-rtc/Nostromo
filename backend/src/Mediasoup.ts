import mediasoup = require('mediasoup');
import mediasoupTypes = mediasoup.types;
export { mediasoupTypes };

export class Mediasoup
{
    static mediasoupWorkers = new Array<mediasoupTypes.Worker>();

    static async createMediasoupWorkers()
    {
        const numWorkers: number = 1;

        console.log('running %d mediasoup Workers...', numWorkers);

        for (let i: number = 0; i < numWorkers; ++i)
        {
            const worker: mediasoupTypes.Worker = await mediasoup.createWorker(
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

            Mediasoup.mediasoupWorkers.push(worker);
        }
    }

    static test(): number
    {
        return 0;
    }

    static getWorker(): mediasoupTypes.Worker
    {
        const worker: mediasoupTypes.Worker = Mediasoup.mediasoupWorkers[0];
        return worker;
    }

    static async createRouter(): Promise<mediasoupTypes.Router>
    {
        const router = await Mediasoup.getWorker().createRouter();
        return router;
    }

    static async createWebRtcTransport(router: mediasoupTypes.Router)
    {
        const transport = await router.createWebRtcTransport({
            listenIps: ['127.0.0.1'],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true
        });
        return transport;
    }

    static async createConsumer(
        producer: mediasoupTypes.Producer,
        rtpCapabilities: mediasoupTypes.RtpCapabilities,
        router: mediasoupTypes.Router)
    {
        if (!router.canConsume({ producerId: producer.id, rtpCapabilities }))
        {
            console.error("can't consume");
            return;
        }
        try {
            let consumer = await consumer
        }
    }
}