"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// подключаем нужные модули (библиотеки) и настраиваем веб-сервер
const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const https = require("https");
const SocketIO = require("socket.io");
const app = express();
const httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, '/ssl', 'private.key'), 'utf8'),
    cert: fs.readFileSync(path.join(__dirname, '/ssl', 'public.crt'), 'utf8')
};
const server = https.createServer(httpsOptions, app);
const port = 443;
server.listen(port, () => {
    console.log(`Server running on port: ${port}`);
});
const sessionMiddleware = session({
    secret: 'developmentsecretkey',
    name: 'sessionId',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: true
    }
});
app.use(sessionMiddleware);
app.disable('x-powered-by');
// главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/pages', 'index.html'));
});
/** Комнаты (с названиями и паролями)
 * @argument string - номер комнаты (которое идентично названию комнаты в socket.io)
 * @argument roomInfo - название и пароль комнаты
 */
let rooms = new Map();
rooms.set('1', { name: "Главная", password: "testik1" });
rooms.set('2', { name: "Второстепенная", password: "123" });
app.get('/rooms/:roomID', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // лямбда-функция, которая возвращает страницу с комнатой при успешной авторизации
    const joinInRoom = () => {
        // сокет сделает данный параметр true,
        // isInRoom нужен для предотвращения создания двух сокетов от одного юзера в одной комнате на одной вкладке
        req.session.isInRoom = false;
        req.session.activeRoomID = roomID;
        return res.sendFile(path.join(__dirname, '../frontend/pages', 'room.html'));
    };
    // проверяем наличие запрашиваемой комнаты
    const roomID = req.params.roomID;
    if (rooms.has(roomID)) {
        // если пользователь авторизован в этой комнате
        if (req.session.auth && req.session.authRoomsID.includes(roomID)) {
            return joinInRoom();
        }
        // если не авторизован, но есть пароль в query
        const pass = req.query.p;
        if (pass) {
            if (pass == rooms.get(roomID).password) {
                // если у пользователя не было сессии
                if (!req.session.auth) {
                    req.session.auth = true;
                    req.session.authRoomsID = new Array();
                }
                // запоминаем для этого пользователя авторизованную комнату
                req.session.authRoomsID.push(roomID);
                return joinInRoom();
            }
            return res.send("неправильный пароль");
        }
        req.session.activeRoomID = roomID;
        return res.sendFile(path.join(__dirname, '../frontend/pages', 'roomAuth.html'));
    }
    return res.send("Error: такой комнаты нет");
});
app.get('/admin', (req, res) => {
    if (req.ip == "::ffff:127.0.0.1") {
        res.sendFile(path.join(__dirname, '../frontend/pages', 'admin.html'));
    }
    else {
        res.status(404).end('404 Error: page not found');
    }
});
// открываем доступ к статике, т.е к папке public (css, js, картинки)
app.use(express.static("../frontend/public/"));
app.use((req, res) => {
    res.status(404).end('404 error: page not found');
});
// сокеты
const io = new SocketIO.Server(server, {
    transports: ['websocket'],
    pingInterval: 2000,
    pingTimeout: 15000
});
io.of('/auth').use((socket, next) => {
    sessionMiddleware(socket.handshake, {}, next);
});
// [Авторизация в комнату]
io.of('/auth').on('connection', (socket) => {
    if (socket.handshake.session.activeRoomID != undefined) {
        const roomID = socket.handshake.session.activeRoomID;
        if (rooms.has(roomID)) {
            socket.emit('roomName', rooms.get(roomID).name);
            socket.on('joinRoom', (pass) => {
                if (pass == rooms.get(roomID).password) {
                    // если у пользователя не было сессии
                    if (!socket.handshake.session.auth) {
                        socket.handshake.session.auth = true;
                        socket.handshake.session.authRoomsID = new Array();
                    }
                    // запоминаем для этого пользователя авторизованную комнату
                    socket.handshake.session.authRoomsID.push(roomID);
                    socket.handshake.session.save();
                    socket.emit('result', true);
                }
                else
                    socket.emit('result', false);
            });
        }
    }
});
io.of('/room').use((socket, next) => {
    sessionMiddleware(socket.handshake, {}, next);
});
io.of('/room').use((socket, next) => {
    // у пользователя есть сессия
    if (socket.handshake.session.auth) {
        const activeRoomID = socket.handshake.session.activeRoomID;
        // если он авторизован в запрашиваемой комнате
        if (socket.handshake.session.authRoomsID.includes(activeRoomID)) {
            socket.handshake.session.isInRoom = true;
            socket.handshake.session.save();
            return next();
        }
    }
    return next(new Error("unauthorized"));
});
// [Комната] обрабатываем подключение нового юзера
io.of('/room').on('connection', (socket) => {
    console.log(`${io.of('/room').sockets.size}: ${socket.id} user connected`);
    const roomID = socket.handshake.session.activeRoomID;
    socket.join(roomID);
    /** ID всех сокетов в комнате roomID */
    const roomUsersID = io.of('/room').adapter.rooms.get(roomID);
    socket.emit('roomName', rooms.get(roomID).name);
    socket.once('afterConnect', (username) => {
        // запоминаем имя в сессии
        socket.handshake.session.username = username;
        // перебираем всех пользователей, кроме нового
        for (const anotherUser_ID of roomUsersID.values()) {
            if (anotherUser_ID != socket.id) {
                const offering = true;
                const anotherUser_name = io.of('/room').sockets.get(anotherUser_ID).handshake.session.username;
                // сообщаем новому пользователю и пользователю anotherUser,
                // что им необходимо создать пустое p2p подключение (PeerConnection)
                socket.emit('newUser', { ID: anotherUser_ID, name: anotherUser_name }, offering);
                io.of('/room').to(anotherUser_ID).emit('newUser', { ID: socket.id, name: username }, !offering);
                // сообщаем новому пользователю, что он должен создать приглашение для юзера anotherUser
                console.log(`запросили приглашение от ${socket.id} для ${anotherUser_ID}`);
                socket.emit('newOffer', anotherUser_ID);
            }
        }
    });
    socket.on('newUsername', (username) => {
        socket.handshake.session.username = username;
        socket.to(roomID).emit('newUsername', { ID: socket.id, name: username });
    });
    // если получили приглашение от юзера socket для юзера anotherUserID
    socket.on('newOffer', (offer, anotherUserID) => {
        console.log(`получили приглашение от ${socket.id} для ${anotherUserID}`);
        // отправляем его другому пользователю
        if (roomUsersID.has(anotherUserID)) {
            console.log(`отправили приглашение от ${socket.id} для ${anotherUserID}`);
            io.of('/room').to(anotherUserID).emit('receiveOffer', offer, socket.id);
        }
    });
    // если получили ответ от юзера socket для юзера anotherUserID
    socket.on('newAnswer', (answer, anotherUserID) => {
        console.log(`получили ответ от ${socket.id} для ${anotherUserID}`);
        if (roomUsersID.has(anotherUserID)) {
            console.log(`отправили ответ от ${socket.id} для ${anotherUserID}`);
            io.of('/room').to(anotherUserID).emit('receiveAnswer', answer, socket.id);
        }
    });
    socket.on('disconnect', (reason) => {
        console.log(`${socket.id}: user disconnected`, reason);
        socket.handshake.session.isInRoom = false;
        socket.handshake.session.save();
        io.of('/room').in(roomID).emit('userDisconnected', socket.id);
    });
});
// для ввода в консоль сервера
const readline = require("readline");
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
