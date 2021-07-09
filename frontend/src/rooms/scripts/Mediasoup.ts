import * as mediasoup from 'mediasoup-client';
import mediasoupTypes = mediasoup.types;

// Класс, получающий медиапотоки пользователя
export class Mediasoup
{
    private device?: mediasoupTypes.Device;

    private async loadDevice(routerRtpCapabilities: mediasoupTypes.RtpCapabilities)
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