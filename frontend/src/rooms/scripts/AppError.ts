// браузер не поддерживается
import { UnsupportedError } from "mediasoup-client/lib/errors";

// ICE состояние транспортного канала стало failed
export class TransportFailedError extends Error
{
    constructor(message: string)
    {
        super(message);
        this.name = this.constructor.name;
    }
}

type ErrorMsg = { consoleMsg: string, alertMsg: string; }

function getErrorMsg(error: Error): ErrorMsg
{
    switch (error.name)
    {
        case UnsupportedError.name: {
            const consoleMsg = "[Mediasoup] > Browser not supported |";
            const alertMsg = "Браузер или версия браузера не поддерживается!";
            return { consoleMsg, alertMsg };
        }
        case TransportFailedError.name: {
            const consoleMsg = "[Mediasoup] > Transport failed. Check your proxy settings |";
            const alertMsg = "Не удалось соединиться с медиасервером! Проверьте свои настройки прокси.";
            return { consoleMsg, alertMsg };
        }
        default: {
            const consoleMsg = "> Unexpected error |";
            const alertMsg = `Непредвиденная ошибка!\n${error.name}: ${error.message}`;
            return { consoleMsg, alertMsg };
        }
    }
}

export function HandleCriticalError(error: Error) : void
{
    const { consoleMsg, alertMsg } = getErrorMsg(error);
    console.error(consoleMsg, error);
    alert(alertMsg);
    document.location.replace("/");
}