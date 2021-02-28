// подключаем нужные модули (библиотеки) и настраиваем веб-сервер
import path = require('path');
import fs = require('fs');
import http = require('http');
import https = require('https');
// Express
import { ExpressApp } from './ExpressApp';
// сокеты
import { SocketHandler } from './SocketHandler';
// для ввода в консоль
import readline = require('readline');

// типы для комнат
export type RoomId = string;
export type RoomInfo = {
    name: string,
    password: string;
};

/** Комнаты (с названиями и паролями)
 * @argument string - номер комнаты (которое идентично названию комнаты в socket.io)
 * @argument roomInfo - название и пароль комнаты
 */
let rooms = new Map<RoomId, RoomInfo>();
let roomsIdCount: number = 1;
rooms.set(String(roomsIdCount), { name: "Главная", password: "testik1" });

const Express = new ExpressApp(rooms);

const httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, '../ssl', 'private.key'), 'utf8'),
    cert: fs.readFileSync(path.join(__dirname, '../ssl', 'public.crt'), 'utf8')
};

const httpServer : http.Server = http.createServer(Express.app);
const httpPort = 80;

httpServer.listen(httpPort, () => {
    console.log(`Http server running on port: ${httpPort}`);
});

const server: https.Server = https.createServer(httpsOptions, Express.app);
const port = 443;

server.listen(port, () => {
    console.log(`Https server running on port: ${port}`);
});


const SocketHandlerInstance = new SocketHandler(server, Express.sessionMiddleware, rooms, roomsIdCount);

// для ввода в консоль сервера
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.on('line', (input_str) => {
    console.log(input_str);
});
rl.on('SIGINT', () => {
    process.exit();
});