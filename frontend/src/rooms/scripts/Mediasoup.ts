import * as mediasoup from 'mediasoup-client';
import MediasoupTypes = mediasoup.types;
export { MediasoupTypes };

// Класс, получающий медиапотоки пользователя
export class Mediasoup
{
    private _device: MediasoupTypes.Device;
    public get device(): MediasoupTypes.Device { return this._device; }

    constructor()
    {
        this._device = new mediasoup.Device();
    }

    public async loadDevice(routerRtpCapabilities: MediasoupTypes.RtpCapabilities): Promise<MediasoupTypes.RtpCapabilities>
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
        return this.device.rtpCapabilities;
    }
}