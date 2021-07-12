import * as mediasoup from 'mediasoup-client';
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
    public set sendTransport(value: MediasoupTypes.Transport | undefined) { this._sendTransport = value; }

    // транспортный канал для приема потоков
    private _recvTransport?: MediasoupTypes.Transport | undefined;
    public get recvTransport(): MediasoupTypes.Transport | undefined { return this._recvTransport; }
    public set recvTransport(value: MediasoupTypes.Transport | undefined) { this._recvTransport = value; }

    constructor()
    {
        this._device = new mediasoup.Device();
    }

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
                console.error('Browser not supported', error);
            }
        }
    }
}