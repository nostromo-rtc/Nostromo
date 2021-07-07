import path = require('path');
import fs = require('fs');
import http = require('http');
import https = require('https');
require('dotenv').config();

// Express
import { ExpressApp } from './ExpressApp';

// сокеты
import { SocketHandler } from './SocketHandler';

// для ввода в консоль
import readline = require('readline');

// -- типы для комнат -- //
// номер комнаты
export type RoomId = string;
// информация о комнате
export type RoomInfo = {
    name: string,       // название комнаты
    password: string;   // пароль комнаты
};

// -- инициализация приложения -- //
process.title = `WebRTC Server ${process.env.npm_package_version}`;
console.debug(`Version: ${process.env.npm_package_version}`);

// комнаты
let rooms = new Map<RoomId, RoomInfo>();
rooms.set(String(rooms.size),
    {
        name: process.env.DEV_TESTROOM_NAME || 'Тестовая',
        password: process.env.DEV_TESTROOM_PASS || 'testik1'
    });

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