import https = require('https');
import session = require('express-session');

import SocketIO = require('socket.io');
type Socket = SocketIO.Socket;
import { Handshake } from 'socket.io/dist/socket';
import { ExtendedError } from 'socket.io/dist/namespace';

import { RequestHandler } from 'express';

import { RoomId, Room } from './Room';

import { Mediasoup } from './Mediasoup';

export type SocketId = string;
type RoomForUser = { id: RoomId, name: Room["name"]; };

// расширяю класс Handshake у сокетов, добавляя в него Express сессии
declare module "socket.io/dist/socket" {
    interface Handshake
    {
        session?: session.Session & Partial<session.SessionData>;
        sessionId?: string;
    }
}

// перегружаю функцию RequestHandler у Express, чтобы он понимал handshake от SocketIO как реквест
// это нужно для совместимости SocketIO с Express Middleware (express-session)
declare module "express"
{
    interface RequestHandler
    {
        (
            req: Handshake,
            res: {},
            next: (err?: ExtendedError) => void,
        ): void;
    }
}

// класс - обработчик сокетов
export class SocketHandler
{
    private io: SocketIO.Server;

    private rooms: Map<RoomId, Room>;

    private createSocketServer(server: https.Server): SocketIO.Server
    {
        return new SocketIO.Server(server, {
            transports: ['websocket'],
            pingInterval: 2000,
            pingTimeout: 15000,
            serveClient: false
        });
    }

    constructor(server: https.Server, sessionMiddleware: RequestHandler, _rooms: Map<RoomId, Room>)
    {
        this.io = this.createSocketServer(server);
        this.rooms = _rooms;

        // [Главная страница]
        this.io.of('/').on('connection', (socket: Socket) =>
        {
            let roomList: Array<RoomForUser> = [];
            for (const room of this.rooms)
            {
                roomList.push({ id: room[0], name: room[1].name });
            }
            socket.emit('roomList', roomList);
        });

        // [Админка]
        this.handleAdmin(sessionMiddleware);

        // [Авторизация в комнату]
        this.handleRoomAuth(sessionMiddleware);

        // [Комната]
        this.handleRoom(sessionMiddleware);
    }

    private handleAdmin(sessionMiddleware: RequestHandler)
    {
        this.io.of('/admin').use((socket: Socket, next) =>
        {
            sessionMiddleware(socket.handshake, {}, next);
        });

        this.io.of('/admin').use((socket: Socket, next) =>
        {
            // если с недоверенного ip, то не открываем вебсокет-соединение
            if (socket.handshake.address == process.env.ALLOW_ADMIN_IP)
            {
                return next();
            }
            return next(new Error("unauthorized"));
        });

        this.io.of('/admin').on('connection', (socket: Socket) =>
        {
            if (!socket.handshake.session!.admin)
            {
                socket.on('joinAdmin', (pass: string) =>
                {
                    if (pass == process.env.ADMIN_PASS)
                    {
                        socket.handshake.session!.admin = true;
                        socket.handshake.session!.save();
                        socket.emit('result', true);
                    }
                    else
                        socket.emit('result', false);
                });
            }

            else
            {
                let roomList: Array<RoomForUser> = [];
                for (const room of this.rooms)
                {
                    roomList.push({ id: room[0], name: room[1].name });
                }
                socket.emit('roomList', roomList, this.rooms.size);

                socket.on('deleteRoom', (id: RoomId) =>
                {
                    this.removeRoom(id);
                });

                socket.on('createRoom', async (name: string, pass: string) =>
                {
                    const roomId: RoomId = String(this.rooms.size);
                    await this.createRoom(roomId, name, pass);
                });
            }
        });
    }

    private removeRoom(id: string)
    {
        if (this.rooms.has(id))
        {
            this.rooms.get(id)!.close();
            this.rooms.delete(id);
        }
    }

    private async createRoom(roomId: RoomId, name: string, pass: string)
    {
        this.rooms.set(roomId, new Room(roomId, name, pass, await Mediasoup.createRouter()));
    }

    private handleRoomAuth(sessionMiddleware: RequestHandler)
    {
        this.io.of('/auth').use((socket: Socket, next) =>
        {
            sessionMiddleware(socket.handshake, {}, next);
        });

        this.io.of('/auth').on('connection', (socket: Socket) =>
        {
            if (socket.handshake.session!.joinedRoomId)
            {
                const roomId: string = socket.handshake.session!.joinedRoomId;

                if (this.rooms.has(roomId))
                {
                    socket.emit('roomName', this.rooms.get(roomId)!.name);

                    socket.on('joinRoom', (pass: string) =>
                    {
                        if (pass == this.rooms.get(roomId)!.password)
                        {
                            // если у пользователя не было сессии
                            if (!socket.handshake.session!.auth)
                            {
                                socket.handshake.session!.auth = true;
                                socket.handshake.session!.authRoomsId = new Array<string>();
                            }
                            // запоминаем для этого пользователя авторизованную комнату
                            socket.handshake.session!.authRoomsId!.push(roomId);
                            socket.handshake.session!.save();
                            socket.emit('result', true);
                        }
                        else
                            socket.emit('result', false);
                    });
                }
            }
        });
    }

    private handleRoom(sessionMiddleware: RequestHandler)
    {
        this.io.of('/room').use((socket: SocketIO.Socket, next) =>
        {
            sessionMiddleware(socket.handshake, {}, next);
        });

        this.io.of('/room').use((socket: Socket, next) =>
        {
            // у пользователя есть сессия
            if (socket.handshake.session!.auth)
            {
                const activeRoomId: string | undefined = socket.handshake.session!.joinedRoomId;
                // если он авторизован в запрашиваемой комнате
                if (activeRoomId
                    && socket.handshake.session!.authRoomsId?.includes(activeRoomId)
                    && socket.handshake.session!.joined == false)
                {
                    socket.handshake.session!.joined = true;
                    socket.handshake.session!.save();
                    return next();
                }
            }
            return next(new Error("unauthorized"));
        });

        // [Комната] обрабатываем подключение нового юзера
        this.io.of('/room').on('connection', (socket: Socket) =>
        {
            const roomId: string = socket.handshake.session!.joinedRoomId!;

            if (!this.rooms.has(roomId)) { return; }

            this.joinRoom(roomId, socket);

            /** Id всех сокетов в комнате roomId */
            const roomUsersId: Set<SocketId> = this.rooms.get(roomId)!.users;

            socket.emit('roomName', this.rooms.get(roomId)?.name);

            socket.once('afterConnect', (username: string) =>
            {
                // запоминаем имя в сессии
                socket.handshake.session!.username = username;
                // перебираем всех пользователей, кроме нового
                for (const anotherUserId of roomUsersId.values())
                {
                    if (anotherUserId != socket.id)
                    {
                        const offering: boolean = true;
                        const anotherUserName: string = this.io.of('/room').sockets.get(anotherUserId)!.handshake.session!.username!;
                        // сообщаем новому пользователю и пользователю anotherUser,
                        // что им необходимо создать пустое p2p подключение (PeerConnection)
                        socket.emit('newUser', anotherUserId, anotherUserName, offering);
                        this.io.of('/room').to(anotherUserId).emit('newUser', socket.id, username, !offering);
                        // сообщаем новому пользователю, что он должен создать приглашение для юзера anotherUser
                        console.log(`запросили приглашение от ${socket.id} для ${anotherUserId}`);
                        socket.emit('newOffer', anotherUserId);
                    }
                }
            });

            socket.on('newUsername', (username: string) =>
            {
                socket.handshake.session!.username = username;
                socket.to(roomId).emit('newUsername', socket.id, username);
            });

            // если получили приглашение от юзера socket для юзера anotherUserId
            socket.on('newOffer', (offer: RTCSessionDescription, anotherUserId: SocketId) =>
            {
                console.log(`получили приглашение от ${socket.id} для ${anotherUserId}`);
                // отправляем его другому пользователю
                if (roomUsersId.has(anotherUserId))
                {
                    console.log(`отправили приглашение от ${socket.id} для ${anotherUserId}`);
                    this.io.of('/room').to(anotherUserId).emit('receiveOffer', offer, socket.id);
                }
            });

            // если получили ответ от юзера socket для юзера anotherUserId
            socket.on('newAnswer', (answer: RTCSessionDescription, anotherUserId: SocketId) =>
            {
                console.log(`получили ответ от ${socket.id} для ${anotherUserId}`);
                if (roomUsersId.has(anotherUserId))
                {
                    console.log(`отправили ответ от ${socket.id} для ${anotherUserId}`);
                    this.io.of('/room').to(anotherUserId).emit('receiveAnswer', answer, socket.id);
                }
            });

            socket.on('disconnect', (reason) =>
            {
                console.log(`${socket.id}: user disconnected`, reason);
                socket.handshake.session!.joined = false;
                socket.handshake.session!.save();
                this.leaveRoom(roomId, socket.id);
                this.io.of('/room').in(roomId).emit('userDisconnected', socket.id);
            });
        });
    }

    private joinRoom(roomId: string, socket: Socket)
    {
        socket.join(roomId);
        this.rooms.get(roomId)!.join(socket.id);
    }

    private leaveRoom(roomId: string, socketId: SocketId)
    {
        this.rooms.get(roomId)?.leave(socketId);
    }
}