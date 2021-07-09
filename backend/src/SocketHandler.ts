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
            socket.emit('roomList', this.getRoomList());
        });

        // [Админка]
        this.handleAdmin(sessionMiddleware);

        // [Авторизация в комнату]
        this.handleRoomAuth(sessionMiddleware);

        // [Комната]
        this.handleRoom(sessionMiddleware);
    }

    private getRoomList()
    {
        let roomList: Array<RoomForUser> = [];
        for (const room of this.rooms)
        {
            roomList.push({ id: room[0], name: room[1].name });
        }
        return roomList;
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
            let session = socket.handshake.session!;
            if (!session.admin)
            {
                socket.on('joinAdmin', (pass: string) =>
                {
                    if (pass == process.env.ADMIN_PASS)
                    {
                        session.admin = true;
                        session.save();
                        socket.emit('result', true);
                    }
                    else
                    {
                        socket.emit('result', false);
                    }
                });
            }
            else
            {
                socket.emit('roomList', this.getRoomList(), this.rooms.size);

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
            let session = socket.handshake.session!;
            const roomId: string | undefined = session.joinedRoomId;

            // если в сессии нет номера комнаты, или такой комнаты не существует
            if (!roomId || !this.rooms.has(roomId))
                return;

            const room: Room = this.rooms.get(roomId)!;

            socket.emit('roomName', room.name);

            socket.on('joinRoom', (pass: string) =>
            {
                let result: boolean = false;
                if (pass == room.password)
                {
                    // если у пользователя не было сессии
                    if (!session.auth)
                    {
                        session.auth = true;
                        session.authRoomsId = new Array<string>();
                    }
                    // запоминаем для этого пользователя авторизованную комнату
                    session.authRoomsId!.push(roomId);
                    session.save();

                    result = true;
                }
                socket.emit('result', result);
            });
        });
    }

    private joinRoom(room: Room, socket: Socket): void
    {
        socket.join(room.id);
        room.join(socket.id);
    }

    private leaveRoom(room: Room, socketId: SocketId, reason: string): void
    {
        room.leave(socketId, reason);
    }

    private handleRoom(sessionMiddleware: RequestHandler): void
    {
        this.io.of('/room').use((socket: SocketIO.Socket, next) =>
        {
            sessionMiddleware(socket.handshake, {}, next);
        });

        this.io.of('/room').use((socket: Socket, next) =>
        {
            let session = socket.handshake.session!;
            // у пользователя есть сессия
            if (session.auth)
            {
                // если он авторизован в запрашиваемой комнате
                if (session.joinedRoomId
                    && session.authRoomsId?.includes(session.joinedRoomId)
                    && session.joined == false)
                {
                    session.joined = true;
                    session.save();
                    return next();
                }
            }
            return next(new Error("unauthorized"));
        });

        // [Комната] обрабатываем подключение нового юзера
        this.io.of('/room').on('connection', (socket: Socket) =>
        {
            let session = socket.handshake.session!;
            const roomId: string = session.joinedRoomId!;

            if (!this.rooms.has(roomId)) { return; }

            const room: Room = this.rooms.get(roomId)!;

            this.joinRoom(room, socket);

            /** Id всех сокетов в комнате roomId */
            const roomUsersId: Set<SocketId> = room.users;

            // сообщаем пользователю название комнаты
            socket.emit('roomName', room.name);

            // сообщаем пользователю RTP возможности (кодеки) сервера
            socket.emit('routerRtpCapabilities', room.mediasoupRouter.rtpCapabilities);

            socket.once('afterConnect', (username: string) =>
            {
                // запоминаем имя в сессии
                session.username = username;

                // перебираем всех пользователей, кроме нового
                for (const anotherUserId of roomUsersId.values())
                {
                    if (anotherUserId != socket.id)
                    {
                        const anotherUserName: string = this.io.of('/room')
                            .sockets.get(anotherUserId)!
                            .handshake.session!.username!;

                    }
                }
            });

            socket.on('newUsername', (username: string) =>
            {
                session.username = username;

                socket.in(roomId).emit('newUsername', socket.id, username);
            });

            socket.on('disconnect', (reason: string) =>
            {
                session.joined = false;
                session.save();

                this.leaveRoom(room, socket.id, reason);

                this.io.of('/room').in(roomId).emit('userDisconnected', socket.id);
            });
        });
    }
}