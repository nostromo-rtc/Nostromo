import * as mediasoup from 'mediasoup-client';
import { NewConsumerInfo, NewWebRtcTransportInfo } from 'shared/RoomTypes';
import MediasoupTypes = mediasoup.types;
export { MediasoupTypes };

export type TransportProduceParameters = {
    kind: MediasoupTypes.MediaKind,
    rtpParameters: MediasoupTypes.RtpParameters,
    appData: Object;
};

// Класс, получающий медиапотоки пользователя
export class Mediasoup
{
    private _device: MediasoupTypes.Device;
    public get device(): MediasoupTypes.Device { return this._device; }

    // транспортный канал для отправки потоков
    private _sendTransport?: MediasoupTypes.Transport | undefined;
    public get sendTransport(): MediasoupTypes.Transport | undefined { return this._sendTransport; }

    // транспортный канал для приема потоков
    private _recvTransport?: MediasoupTypes.Transport | undefined;
    public get recvTransport(): MediasoupTypes.Transport | undefined { return this._recvTransport; }

    private _consumers = new Map<string, MediasoupTypes.Consumer>();
    private _producers = new Map<string, MediasoupTypes.Producer>();

    /** @key trackId @value consumerId */
    private _linkMapTrackConsumer = new Map<string, string>();

    constructor()
    {
        this._device = new mediasoup.Device();
    }

    // загружаем mediasoup device от rtpCapabilities с сервера
    public async loadDevice(routerRtpCapabilities: MediasoupTypes.RtpCapabilities): Promise<void>
    {
        try
        {
            await this.device.load({ routerRtpCapabilities });
        }
        catch (error)
        {
            if (error.name === 'UnsupportedError')
            {
                console.error('[Mediasoup] > Browser not supported', error);
                alert("Browser not supported");
            }
        }
    }

    public createRecvTransport(transport: NewWebRtcTransportInfo): void
    {
        try
        {
            this._recvTransport = this.device.createRecvTransport({
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters
            });
        }
        catch (error)
        {
            console.error('[Mediasoup] > createRecvTransport | error', error);
        }
    }

    public createSendTransport(transport: NewWebRtcTransportInfo): void
    {
        try
        {
            this._sendTransport = this.device.createSendTransport({
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters
            });
        }
        catch (error)
        {
            console.error('[Mediasoup] > createSendTransport | error', error);
        }
    }

    public async createConsumer(newConsumerInfo: NewConsumerInfo)
    {
        const { id, producerId, kind, rtpParameters } = newConsumerInfo;

        let consumer;

        try
        {
            consumer = await this.recvTransport!.consume({
                id,
                producerId,
                kind,
                rtpParameters
            });

            this._consumers.set(consumer.id, consumer);
            this._linkMapTrackConsumer.set(consumer.track.id, consumer.id);
        }
        catch (error)
        {
            console.error('[Mediasoup] > consume | error', error);
            alert("consume error");
        }

        return consumer;
    }

    public async createProducer(track: MediaStreamTrack, maxBitrate: number)
    {
        let producer;

        try
        {
            producer = await this.sendTransport!.produce({
                track,
                zeroRtpOnPause: true,
                codecOptions:
                {
                    videoGoogleStartBitrate: 1000
                },
                encodings: [
                    {
                        maxBitrate
                    }
                ]
            });

            this._producers.set(producer.id, producer);
        }
        catch (error)
        {
            console.error('[Mediasoup] > produce | error', error);
            alert("produce error");
        }

        return producer;
    }

    public closeAll(): void
    {
        // удаляем producers
        for (const producer of this._producers.values())
        {
            producer.close();
        }
        this._producers.clear();

        // удаляем consumers
        for (const consumer of this._consumers.values())
        {
            consumer.close();
        }
        this._consumers.clear();

        // закрываем транспортные каналы
        this._sendTransport?.close();
        this._recvTransport?.close();
    }

    // получить consumer по id
    public getConsumer(consumerId: string): MediasoupTypes.Consumer | undefined
    {
        return this._consumers.get(consumerId);
    }

    // получить consumer по id его track'а
    public getConsumerByTrackId(trackId: string): string | undefined
    {
        return this._linkMapTrackConsumer.get(trackId);
    }

    // удалить consumer
    public deleteConsumer(consumer: MediasoupTypes.Consumer): boolean
    {
        const res1 = this._consumers.delete(consumer.id);
        const res2 = this._linkMapTrackConsumer.delete(consumer.track.id);
        return (res1 && res2);
    }

    // получить producer по id
    public getProducer(producerId: string): MediasoupTypes.Producer | undefined
    {
        return this._producers.get(producerId);
    }

    // получить всех producers (итератор)
    public getProducers()
    {
        return this._producers.values();
    }
    // удалить producer
    public deleteProducer(producer: MediasoupTypes.Producer): boolean
    {
        return this._producers.delete(producer.id);
    }
}