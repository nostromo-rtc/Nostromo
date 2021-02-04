"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketHandler = void 0;
const SocketIO = require("socket.io");
// класс - обработчик сокетов
class SocketHandler {
    constructor(server, sessionMiddleware, rooms, roomsIdCount) {
        console.debug("SocketHandler ctor");
        this.init_io_Server(server);
        // [Главная страница]
        this.io.of('/').on('connection', (socket) => {
            let roomList = [];
            for (const room of rooms) {
                roomList.push({ id: room[0], name: room[1].name });
            }
            socket.emit('roomList', roomList);
        });
        // [Авторизация в админку]
        this.io.of('/admin').use((socket, next) => {
            sessionMiddleware(socket.handshake, {}, next);
        });
        this.io.of('/admin').use((socket, next) => {
            // если с недоверенного ip, то не открываем вебсокет-соединение
            if (socket.handshake.address == "::ffff:127.0.0.1") {
                return next();
            }
            return next(new Error("unauthorized"));
        });
        this.io.of('/admin').on('connection', (socket) => {
            if (!socket.handshake.session.admin) {
                socket.on('joinAdmin', (pass) => {
                    if (pass == "admin123") {
                        socket.handshake.session.admin = true;
                        socket.handshake.session.save();
                        socket.emit('result', true);
                    }
                    else
                        socket.emit('result', false);
                });
            }
            else {
                let roomList = [];
                for (const room of rooms) {
                    roomList.push({ id: room[0], name: room[1].name });
                }
                socket.emit('roomList', roomList, roomsIdCount);
                socket.on('deleteRoom', (id) => rooms.delete(id));
                socket.on('createRoom', (name, pass) => {
                    rooms.set(String(++roomsIdCount), { name: name, password: pass });
                });
            }
        });
        // [Авторизация в комнату]
        this.io.of('/auth').use((socket, next) => {
            sessionMiddleware(socket.handshake, {}, next);
        });
        this.io.of('/auth').on('connection', (socket) => {
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
        // [Комната]
        this.io.of('/room').use((socket, next) => {
            sessionMiddleware(socket.handshake, {}, next);
        });
        this.io.of('/room').use((socket, next) => {
            // у пользователя есть сессия
            if (socket.handshake.session.auth) {
                const activeRoomID = socket.handshake.session.activeRoomID;
                // если он авторизован в запрашиваемой комнате
                if (socket.handshake.session.authRoomsID.includes(activeRoomID)
                    && socket.handshake.session.isInRoom == false) {
                    socket.handshake.session.isInRoom = true;
                    socket.handshake.session.save();
                    return next();
                }
            }
            return next(new Error("unauthorized"));
        });
        // [Комната] обрабатываем подключение нового юзера
        this.io.of('/room').on('connection', (socket) => {
            console.log(`${this.io.of('/room').sockets.size}: ${socket.id} user connected`);
            const roomID = socket.handshake.session.activeRoomID;
            socket.join(roomID);
            /** ID всех сокетов в комнате roomID */
            const roomUsersID = this.io.of('/room').adapter.rooms.get(roomID);
            socket.emit('roomName', rooms.get(roomID).name);
            socket.once('afterConnect', (username) => {
                // запоминаем имя в сессии
                socket.handshake.session.username = username;
                // перебираем всех пользователей, кроме нового
                for (const anotherUser_ID of roomUsersID.values()) {
                    if (anotherUser_ID != socket.id) {
                        const offering = true;
                        const anotherUser_name = this.io.of('/room').sockets.get(anotherUser_ID).handshake.session.username;
                        // сообщаем новому пользователю и пользователю anotherUser,
                        // что им необходимо создать пустое p2p подключение (PeerConnection)
                        socket.emit('newUser', { ID: anotherUser_ID, name: anotherUser_name }, offering);
                        this.io.of('/room').to(anotherUser_ID).emit('newUser', { ID: socket.id, name: username }, !offering);
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
                    this.io.of('/room').to(anotherUserID).emit('receiveOffer', offer, socket.id);
                }
            });
            // если получили ответ от юзера socket для юзера anotherUserID
            socket.on('newAnswer', (answer, anotherUserID) => {
                console.log(`получили ответ от ${socket.id} для ${anotherUserID}`);
                if (roomUsersID.has(anotherUserID)) {
                    console.log(`отправили ответ от ${socket.id} для ${anotherUserID}`);
                    this.io.of('/room').to(anotherUserID).emit('receiveAnswer', answer, socket.id);
                }
            });
            socket.on('disconnect', (reason) => {
                console.log(`${socket.id}: user disconnected`, reason);
                socket.handshake.session.isInRoom = false;
                socket.handshake.session.save();
                this.io.of('/room').in(roomID).emit('userDisconnected', socket.id);
            });
        });
    }
    init_io_Server(server) {
        this.io = new SocketIO.Server(server, {
            transports: ['websocket'],
            pingInterval: 2000,
            pingTimeout: 15000
        });
    }
}
exports.SocketHandler = SocketHandler;
