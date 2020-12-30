// подключаем нужные модули (библиотеки) и настраиваем веб-сервер
const express = require('express');
const app = express();
const path = require('path');
const fs = require('fs');

const httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, '/ssl', 'private.key'), 'utf8'),
    cert: fs.readFileSync(path.join(__dirname, '/ssl', 'public.crt'), 'utf8')
};
const https = require('https').createServer(httpsOptions, app);
const port = 443;

https.listen(port, () => {
    console.log(`Server running on port: ${port}`);
});

// открываем доступ к статике, т.е к папке public (css, js, картинки)
app.use(express.static("../frontend/public/"));

// главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/pages', 'demo.html'));
});
app.get('/theory', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/pages', 'teoria.html'));
});

// пользователи, у каждого пользователя уникальный ID, начиная с 0
/** @type {Map<Socket,number>} */
let usersBySocket = new Map();
/** @type {Map<number,Socket>} */
let usersByID = new Map();
let usersID = 0;
// сокеты
const io = require('socket.io')(https, {
    'pingInterval': 10000,
    'pingTimeout': 1000
});
// обрабатываем подключение нового юзера
io.on('connection', (socket) => {
    // запоминаем нового пользователя
    usersBySocket.set(socket, usersID);
    usersByID.set(usersID, socket);
    // сообщим пользователю его ID
    socket.mediaReady = false;
    socket.emit('userConnected', usersID);
    console.log(`${usersID++}: ${socket.id} user connected`);
    if (usersBySocket.size > 1) {
        // перебираем всех пользователей, кроме нового
        for (const anotherUserSocket of usersBySocket.keys()) {
            if (anotherUserSocket != socket) {
                // сообщаем новому пользователю и пользователю anotherUser,
                // что им необходимо создать p2p подключение (PeerConnection)
                const socketID = usersBySocket.get(socket);
                const anotherUserSocketID = usersBySocket.get(anotherUserSocket);
                socket.emit('newUser', anotherUserSocketID, true);
                anotherUserSocket.emit('newUser', socketID, false);
                // сообщаем новому пользователю, что он должен создать приглашение
                // для юзера userSocket, (но нет смысла кидать приглашение пользователю,
                // который не делится никакими медиапотоками)
                if (anotherUserSocket.mediaReady) {
                    console.log(`запросили приглашение от ${socketID} для ${anotherUserSocketID}`);
                    socket.emit('newOffer', anotherUserSocketID);
                }
            }
        }
    }
    // если получили приглашение от юзера socket для юзера remoteUserID
    socket.on('newOffer', (offer, remoteUserID) => {
        const socketID = usersBySocket.get(socket);
        console.log(`получили приглашение от ${socketID} для ${remoteUserID}`);
        // отправляем его другому пользователю
        if (usersByID.has(remoteUserID)) {
            const anotherUserSocket = usersByID.get(remoteUserID);
            console.log(`отправили приглашение от ${socketID} для ${remoteUserID}`);
            anotherUserSocket.emit('receiveOffer', offer, socketID);
        }
    });
    // если получили ответ от юзера socket для юзера remoteUserID
    socket.on('newAnswer', (answer, remoteUserID) => {
        const socketID = usersBySocket.get(socket);
        console.log(`получили ответ от ${socketID} для ${remoteUserID}`);
        // отправляем его другому пользователю
        if (usersByID.has(remoteUserID)) {
            const anotherUserSocket = usersByID.get(remoteUserID);
            console.log(`отправили ответ от ${socketID} для ${remoteUserID}`);
            anotherUserSocket.emit('receiveAnswer', answer, socketID);
        }
    });
    socket.on('mediaReady', () => {
        socket.mediaReady = true;
    });
    socket.on('disconnect', () => {
        const userID = usersBySocket.get(socket);
        console.log(`${userID}: user disconnected`);
        usersBySocket.delete(socket);
        usersByID.delete(userID);
        io.emit('userDisconnected', userID);
    });
});

// для ввода в консоль сервера
const readline = require('readline');
const {
    Socket
} = require('socket.io');

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