import * as mediasoup from 'mediasoup-client';
import MediasoupTypes = mediasoup.types;
export { MediasoupTypes };

// Класс, получающий медиапотоки пользователя
export class Mediasoup
{
    private device?: MediasoupTypes.Device;

    private async loadDevice(routerRtpCapabilities: MediasoupTypes.RtpCapabilities)
    {
        try
        {
            this.device = new mediasoup.Device();
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