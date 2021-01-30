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
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true
    }
});
app.use(sessionMiddleware);
// главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/pages', 'index.html'));
});
app.get('/rooms/:roomId', (req, res) => {
    let roomID = req.params.roomId;
    let pass = req.query.p;
    if (roomID == "1" || roomID == "2") {
        if (req.session.auth && req.session.roomID.includes(Number(roomID))) {
            req.session.isInRoom = false;
            return res.sendFile(path.join(__dirname, '../frontend/pages', 'room.html'));
        }
        if (pass) {
            if (pass == "testik1") {
                if (!req.session.auth) {
                    req.session.auth = true;
                    req.session.roomID = new Array();
                }
                req.session.roomID.push(Number(roomID));
                req.session.isInRoom = false;
                return res.sendFile(path.join(__dirname, '../frontend/pages', 'room.html'));
            }
            return res.send("неправильный пароль");
        }
        return res.send("нужен пароль");
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
    allowUpgrades: false,
    pingInterval: 2000,
    pingTimeout: 15000
});
let Users = new Map();
io.use((socket, next) => {
    sessionMiddleware(socket.handshake, {}, next);
});
io.use((socket, next) => {
    if (socket.handshake.session.auth) {
        socket.handshake.session.isInRoom = true;
        socket.handshake.session.save();
        next();
    }
    else {
        next(new Error("unauthorized"));
    }
});
// обрабатываем подключение нового юзера
io.on('connection', (socket) => {
    console.log(socket.handshake.session.roomID);
    console.log(`${Users.size + 1}: ${socket.id} user connected`);
    socket.on('afterConnect', (username) => {
        // перебираем всех пользователей, кроме нового
        for (const anotherUserID of Users.keys()) {
            const offering = true;
            // сообщаем новому пользователю и пользователю anotherUser,
            // что им необходимо создать пустое p2p подключение (PeerConnection)
            socket.emit('newUser', { ID: anotherUserID, name: Users.get(anotherUserID) }, offering);
            io.to(anotherUserID).emit('newUser', { ID: socket.id, name: username }, !offering);
            // сообщаем новому пользователю, что он должен создать приглашение для юзера anotherUser
            console.log(`запросили приглашение от ${socket.id} для ${anotherUserID}`);
            socket.emit('newOffer', anotherUserID);
        }
        // добавляем в Users нашего нового пользователя
        Users.set(socket.id, username);
    });
    socket.on('newUsername', (username) => {
        Users.set(socket.id, username);
        for (const anotherUserID of Users.keys()) {
            if (anotherUserID != socket.id) {
                io.to(anotherUserID).emit('newUsername', { ID: socket.id, name: username });
            }
        }
    });
    // если получили приглашение от юзера socket для юзера anotherUserID
    socket.on('newOffer', (offer, anotherUserID) => {
        console.log(`получили приглашение от ${socket.id} для ${anotherUserID}`);
        // отправляем его другому пользователю
        if (Users.has(anotherUserID)) {
            console.log(`отправили приглашение от ${socket.id} для ${anotherUserID}`);
            io.to(anotherUserID).emit('receiveOffer', offer, socket.id);
        }
    });
    // если получили ответ от юзера socket для юзера anotherUserID
    socket.on('newAnswer', (answer, anotherUserID) => {
        console.log(`получили ответ от ${socket.id} для ${anotherUserID}`);
        if (Users.has(anotherUserID)) {
            console.log(`отправили ответ от ${socket.id} для ${anotherUserID}`);
            io.to(anotherUserID).emit('receiveAnswer', answer, socket.id);
        }
    });
    socket.on('disconnect', (reason) => {
        console.log(`${socket.id}: user disconnected`, reason);
        Users.delete(socket.id);
        socket.handshake.session.isInRoom = false;
        socket.handshake.session.save();
        io.emit('userDisconnected', socket.id);
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
