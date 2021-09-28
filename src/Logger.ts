import fs = require("fs");
import util = require('util');
// добавление временных в меток в лог и сохранение логов в файл
function addTimestamps(message: unknown, ...optionalParams: unknown[]): unknown[]
{
    const timestamp = (new Date).toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: '2-digit',
        minute: "2-digit",
        second: "numeric"
    }) + '.' + ((new Date).getUTCMilliseconds() / 1000).toFixed(3).slice(2, 5);

    if (typeof message === 'string')
    {
        // вставляем первым параметром строку с временной меткой
        optionalParams.unshift(`[${timestamp}] ${message}`);
    }
    else
    {
        // вставляем вторым параметром объект
        optionalParams.unshift(message);
        // а первым временную метку и placeholder,
        // который отобразит второй параметр как объект
        optionalParams.unshift(`[${timestamp}] %o`);
    }
    return optionalParams;
}

export function prepareLogs(): void
{
    // создадим файл с логом
    const outputFile = fs.createWriteStream(process.env.LOG_FILENAME ?? 'log.txt', { flags: 'a+', encoding: "utf8" });

    // оригинальные функции
    const origLog = console.log;
    const origError = console.error;

    // добавляем временные метки

    console.log = function (message: unknown, ...optionalParams: unknown[])
    {
        const data: unknown[] = addTimestamps(message, ...optionalParams);
        origLog.apply(this, data);
        // конец строки в стиле CRLF (знак переноса каретки и новой строки)
        outputFile.write((util.format.apply(this, data) + "\r\n"));
    };

    console.error = function (message: unknown, ...optionalParams: unknown[])
    {
        const data: unknown[] = addTimestamps(message, ...optionalParams);
        origError.apply(this, data);
        outputFile.write((util.format.apply(this, data) + "\r\n"));
    };
}