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

    private _producers = new Map<string, MediasoupTypes.Producer>();
    public get producers() { return this._producers; }

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
                console.error('> [Mediasoup] Browser not supported', error);
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
            console.error('> [Mediasoup] createRecvTransport | error', error);
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
            console.error('> [Mediasoup] createSendTransport | error', error);
        }
    }

    public async newConsumer(newConsumerInfo: NewConsumerInfo)
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
        }
        catch (error)
        {
            console.error('> [Mediasoup] consume | error', error);
        }

        return consumer;
    }

}