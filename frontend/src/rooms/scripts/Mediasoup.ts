import * as mediasoup from 'mediasoup-client';
import { NewConsumerInfo, NewWebRtcTransportInfo } from 'shared/RoomTypes';
import { HandleCriticalError } from "./AppError";
import MediasoupTypes = mediasoup.types;
export { MediasoupTypes };

export type TransportProduceParameters = {
    kind: MediasoupTypes.MediaKind,
    rtpParameters: MediasoupTypes.RtpParameters,
    appData: unknown;
};

// Класс, получающий медиапотоки пользователя
export class Mediasoup
{
    private _device!: MediasoupTypes.Device;
    public get device(): MediasoupTypes.Device { return this._device; }

    // транспортный канал для отправки потоков
    private _sendTransport?: MediasoupTypes.Transport;
    public get sendTransport(): MediasoupTypes.Transport | undefined { return this._sendTransport; }

    // транспортный канал для приема потоков
    private _recvTransport?: MediasoupTypes.Transport;
    public get recvTransport(): MediasoupTypes.Transport | undefined { return this._recvTransport; }

    private _consumers = new Map<string, MediasoupTypes.Consumer>();
    private _producers = new Map<string, MediasoupTypes.Producer>();

    /** @key trackId @value consumerId */
    private _linkMapTrackConsumer = new Map<string, string>();

    constructor()
    {
        try
        {
            this._device = new mediasoup.Device();
        }
        catch (error)
        {
            HandleCriticalError(error as Error);
        }
    }

    // загружаем mediasoup device от rtpCapabilities с сервера
    public async loadDevice(routerRtpCapabilities: MediasoupTypes.RtpCapabilities): Promise<void>
    {
        await this.device.load({ routerRtpCapabilities });
    }
    public createRecvTransport(transport: NewWebRtcTransportInfo): void
    {
        const { id, iceParameters, iceCandidates, dtlsParameters } = transport;

        this._recvTransport = this.device.createRecvTransport({
            id,
            iceParameters,
            iceCandidates,
            dtlsParameters
        });
    }
    public createSendTransport(transport: NewWebRtcTransportInfo): void
    {
        const { id, iceParameters, iceCandidates, dtlsParameters } = transport;

        this._sendTransport = this.device.createSendTransport({
            id,
            iceParameters,
            iceCandidates,
            dtlsParameters
        });
    }
    public async createConsumer(newConsumerInfo: NewConsumerInfo): Promise<MediasoupTypes.Consumer>
    {
        const { id, producerId, kind, rtpParameters } = newConsumerInfo;

        const consumer = await this.recvTransport!.consume({
            id,
            producerId,
            kind,
            rtpParameters
        });

        this._consumers.set(consumer.id, consumer);
        this._linkMapTrackConsumer.set(consumer.track.id, consumer.id);

        return consumer;
    }

    public async createProducer(track: MediaStreamTrack, maxBitrate: number): Promise<MediasoupTypes.Producer>
    {
        const producer = await this.sendTransport!.produce({
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

        return producer;
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
    public getProducers(): IterableIterator<MediasoupTypes.Producer>
    {
        return this._producers.values();
    }
    // удалить producer
    public deleteProducer(producer: MediasoupTypes.Producer): boolean
    {
        return this._producers.delete(producer.id);
    }
}