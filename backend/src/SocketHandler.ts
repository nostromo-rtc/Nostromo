import https = require('https');
import session = require('express-session');
import SocketIO = require('socket.io');
import { Handshake } from 'socket.io/dist/socket';
import { ExtendedError } from 'socket.io/dist/namespace';
import { RequestHandler } from 'express';
import { RoomId, Room } from './Room';
import { NewRoomInfo } from 'shared/AdminTypes';
import { Mediasoup } from './Mediasoup';

export type SocketId = string;
type Socket = SocketIO.Socket;
type RoomForUser = { id: RoomId, name: Room["name"]; };

export type HandshakeSession = session.Session & Partial<session.SessionData>;

// расширяю класс Handshake у сокетов, добавляя в него Express сессии
declare module "socket.io/dist/socket" {
    interface Handshake
    {
        session?: HandshakeSession;
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

export class SocketWrapper
{
    private socket: Socket;

    public get id() { return this.socket.id; }
    public get handshake() { return this.socket.handshake; }

    constructor(socket: Socket)
    {
        this.socket = socket;
    }

    public emit(ev: string, ...args: any[]): boolean
    {
        return this.socket.emit(ev, ...args);
    }

    public on(event: string | symbol, listener: (...args: any[]) => void): SocketIO.Socket
    {
        return this.socket.on(event, listener);
    }

    public once(event: string | symbol, listener: (...args: any[]) => void): SocketIO.Socket
    {
        return this.socket.once(event, listener);
    }

    public to(name: string)
    {
        return this.socket.to(name);
    }
}

// класс - обработчик сокетов
export class SocketHandler
{
    private io: SocketIO.Server;

    private sessionMiddleware: RequestHandler;
    private mediasoup: Mediasoup;
    private rooms: Map<RoomId, Room>;

    private createSocketServer(server: https.Server): SocketIO.Server
    {
        return new SocketIO.Server(server, {
            transports: ['websocket'],
            pingInterval: 2000,
            pingTimeout: 14000,
            serveClient: false
        });
    }

    constructor(server: https.Server, sessionMiddleware: RequestHandler, mediasoup: Mediasoup, rooms: Map<RoomId, Room>)
    {
        this.io = this.createSocketServer(server);

        this.sessionMiddleware = sessionMiddleware;
        this.mediasoup = mediasoup;
        this.rooms = rooms;

        // [Главная страница]
        this.io.of('/').on('connection', (socket: Socket) =>
        {
            socket.emit('roomList', this.getRoomList());
        });

        // [Админка]
        this.handleAdmin();

        // [Авторизация в комнату]
        this.handleRoomAuth();

        // [Комната]
        this.handleRoom();
    }

    private getRoomList(): RoomForUser[]
    {
        let roomList: Array<RoomForUser> = [];
        for (const room of this.rooms)
        {
            roomList.push({ id: room[0], name: room[1].name });
        }
        return roomList;
    }

    private handleAdmin(): void
    {
        this.io.of('/admin').use((socket: Socket, next) =>
        {
            this.sessionMiddleware(socket.handshake, {}, next);
        });

        this.io.of('/admin').use((socket: Socket, next) =>
        {
            // если с недоверенного ip, то не открываем вебсокет-соединение
            if ((socket.handshake.address == process.env.ALLOW_ADMIN_IP)
                || (process.env.ALLOW_ADMIN_EVERYWHERE === 'true'))
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

                socket.on('createRoom', async (info: NewRoomInfo) =>
                {
                    const roomId: RoomId = String(this.rooms.size);
                    await this.createRoom(roomId, info);
                });
            }
        });
    }

    private removeRoom(id: string): void
    {
        if (this.rooms.has(id))
        {
            this.rooms.get(id)!.close();
            this.rooms.delete(id);
        }
    }

    private async createRoom(roomId: RoomId, info: NewRoomInfo): Promise<void>
    {
        const { name, pass, videoCodec } = info;

        this.rooms.set(roomId, await Room.create(
            roomId,
            name,
            pass,
            videoCodec,
            this.mediasoup,
            this
        ));
    }

    private handleRoomAuth(): void
    {
        this.io.of('/auth').use((socket: Socket, next) =>
        {
            this.sessionMiddleware(socket.handshake, {}, next);
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
        room.join(new SocketWrapper(socket));
    }

    private handleRoom(): void
    {
        this.io.of('/room').use((socket: Socket, next) =>
        {
            this.sessionMiddleware(socket.handshake, {}, next);
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
        });
    }

    public getSocketById(id: SocketId): SocketWrapper
    {
        return new SocketWrapper(this.io.of('/room').sockets.get(id)!);
    }

    public emitTo(name: string, ev: string | symbol, ...args: any[]): boolean
    {
        return this.io.of('/room').to(name).emit(ev, ...args);
    }
}