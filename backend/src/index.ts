import path = require('path');
import fs = require('fs');
import http = require('http');
import https = require('https');
require('dotenv').config();

// Express
import { ExpressApp } from './ExpressApp';

// сокеты
import { SocketHandler } from './SocketHandler';

// mediasoup
import { Mediasoup } from './Mediasoup';

// комната
import { RoomId, Room } from './Room';

// для ввода в консоль
import readline = require('readline');

// инициализация тестовой комнаты
async function initTestRoom(rooms : Map<RoomId, Room>) : Promise<void>
{
    rooms.set('0',
        new Room('0',
            process.env.DEV_TESTROOM_NAME || 'Тестовая',
            process.env.DEV_TESTROOM_PASS || 'testik1',
            await Mediasoup.createRouter()
        )
    );
}

// добавление временных в меток в лог
function addTimestampsToLog() : void
{
    let origlog = console.log;

    console.log = function (obj, ...placeholders)
    {
        const timestamp = (new Date).toLocaleString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: '2-digit',
            minute: "2-digit",
            second: "numeric"
        }) + '.' + ((new Date).getUTCMilliseconds() / 1000).toFixed(3).slice(2, 5);

        if (typeof obj === 'string')
            placeholders.unshift(`[${timestamp}] ${obj}`);

        else
        {
            // This handles console.log( object )
            placeholders.unshift(obj);
            placeholders.unshift(`[${timestamp} %j`);
        }

        origlog.apply(this, placeholders);
    };
}

// вызов главной функции
main();

// главная функция
async function main()
{
    // добавление временных меток в лог
    addTimestampsToLog();

    // -- инициализация приложения -- //
    process.title = `WebRTC Server ${process.env.npm_package_version}`;
    console.debug(`Version: ${process.env.npm_package_version}`);

    // создание mediasoup Workers
    await Mediasoup.createMediasoupWorkers();

    // комнаты
    let rooms = new Map<RoomId, Room>();
    await initTestRoom(rooms);

    const Express = new ExpressApp(rooms);

    const httpServer: http.Server = http.createServer(Express.app);
    const httpPort = process.env.HTTP_PORT;

    httpServer.listen(httpPort, () =>
    {
        console.log(`Http server running on port: ${httpPort}`);
    });

    // настройки https-сервера (сертификаты)
    const httpsOptions: https.ServerOptions = {
        key: fs.readFileSync(path.join(__dirname, '../ssl', process.env.SSL_PRIVATE_KEY!), 'utf8'),
        cert: fs.readFileSync(path.join(__dirname, '../ssl', process.env.SSL_PUBLIC_CERT!), 'utf8')
    };

    const server: https.Server = https.createServer(httpsOptions, Express.app);
    const port = process.env.HTTPS_PORT;

    server.listen(port, () =>
    {
        console.log(`Https server running on port: ${port}`);
    });

    const SocketHandlerInstance = new SocketHandler(server, Express.sessionMiddleware, rooms);
    const mediasoup = new Mediasoup();

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