import path = require('path');
import fs = require('fs');
import http = require('http');
import https = require('https');
import dotenv = require('dotenv');
import util = require('util');

// Express
import { ExpressApp } from './ExpressApp';

// сокеты
import { SocketHandler } from './SocketHandler';

// mediasoup
import { Mediasoup } from './Mediasoup';

// комната
import { RoomId, Room } from './Room';
import { VideoCodec } from 'shared/types/RoomTypes';

// для ввода в консоль
import readline = require('readline');

// инициализация тестовой комнаты
async function initTestRoom(mediasoup: Mediasoup, socketHandler: SocketHandler, rooms: Map<RoomId, Room>): Promise<void>
{
    rooms.set('0',
        await Room.create(
            '0',
            process.env.DEV_TESTROOM_NAME ?? 'Тестовая',
            process.env.DEV_TESTROOM_PASS ?? 'testik1',
            VideoCodec.VP8,
            mediasoup,
            socketHandler
        )
    );
}

// добавление временных в меток в лог и сохранение логов в файл
function prepareLogs(): void
{
    // создадим файл с логом
    const outputFile = fs.createWriteStream(process.env.LOG_FILENAME ?? 'log.txt', { flags: 'a+', encoding: "utf8" });

    // оригинальные функции
    const origLog = console.log;
    const origError = console.error;

    // добавляем временные метки
    const addTimestamps = (message: unknown, ...optionalParams: unknown[]) =>
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
    };

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

// главная функция
async function main()
{
    // загрузка значений из конфигурационного файла
    dotenv.config({ path: path.resolve(process.cwd(), 'config', 'server.conf') });

    // добавление временных меток в лог
    // и сохранения лога в файл
    prepareLogs();

    // -- инициализация приложения -- //
    process.title = `nostromo-${process.env.npm_package_version!}`;
    console.log(`Version: ${process.env.npm_package_version!}`);

    // создание класса-обработчика mediasoup
    const mediasoup = await Mediasoup.create(1);

    // комнаты
    const rooms = new Map<RoomId, Room>();

    const Express = new ExpressApp(rooms);

    const httpServer: http.Server = http.createServer(Express.app);
    const httpPort = process.env.HTTP_PORT;

    httpServer.listen(httpPort, () =>
    {
        console.log(`Http server running on port: ${httpPort!}`);
    });

    // настройки https-сервера (сертификаты)
    const httpsOptions: https.ServerOptions = {
        key: fs.readFileSync(path.resolve(process.cwd(), 'config', 'ssl', process.env.SSL_PRIVATE_KEY!), 'utf8'),
        cert: fs.readFileSync(path.resolve(process.cwd(), 'config', 'ssl', process.env.SSL_PUBLIC_CERT!), 'utf8')
    };

    const server: https.Server = https.createServer(httpsOptions, Express.app);
    const port = process.env.HTTPS_PORT;

    server.listen(port, () =>
    {
        console.log(`Https server running on port: ${port!}`);
    });

    const socketHandlerInstance = new SocketHandler(
        server,
        Express.sessionMiddleware,
        mediasoup, rooms, 0
    );

    // создаем тестовую комнату
    await initTestRoom(mediasoup, socketHandlerInstance, rooms);

    // для ввода в консоль сервера
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on('line', (input_str) =>
    {
        console.log(input_str);
    });
    rl.on('SIGINT', () =>
    {
        process.exit();
    });
}

// вызов главной функции
main().catch((reason) => console.error(reason));
