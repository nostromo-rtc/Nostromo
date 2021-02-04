"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// подключаем нужные модули (библиотеки) и настраиваем веб-сервер
const path = require("path");
const fs = require("fs");
const https = require("https");
// Express
const ExpressApp_1 = require("./ExpressApp");
// сокеты
const SocketHandler_1 = require("./SocketHandler");
// для ввода в консоль
const readline = require("readline");
/** Комнаты (с названиями и паролями)
 * @argument string - номер комнаты (которое идентично названию комнаты в socket.io)
 * @argument roomInfo - название и пароль комнаты
 */
let rooms = new Map();
let roomsIdCount = 1;
rooms.set(String(roomsIdCount), { name: "Главная", password: "testik1" });
const Express = new ExpressApp_1.ExpressApp(rooms);
const httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, '/ssl', 'private.key'), 'utf8'),
    cert: fs.readFileSync(path.join(__dirname, '/ssl', 'public.crt'), 'utf8')
};
const server = https.createServer(httpsOptions, Express.app);
const port = 443;
server.listen(port, () => {
    console.log(`Server running on port: ${port}`);
});
const SocketHandlerInstance = new SocketHandler_1.SocketHandler(server, Express.sessionMiddleware, rooms, roomsIdCount);
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
