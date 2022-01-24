import https = require('https');
import session = require('express-session');
import SocketIO = require('socket.io');
import { Handshake } from 'socket.io/dist/socket';
import { ExtendedError } from 'socket.io/dist/namespace';
import { RequestHandler } from 'express';
import { RoomId, Room } from './Room';
import { NewRoomInfo } from "nostromo-shared/types/AdminTypes";
import { Mediasoup } from './Mediasoup';
import { FileHandler } from "./FileHandler";

export type SocketId = string;
type Socket = SocketIO.Socket;
type RoomForUser = { id: RoomId, name: Room["name"]; };

export type HandshakeSession = session.Session & Partial<session.SessionData>;

// расширяю класс Handshake у сокетов, добавляя в него Express сессии
declare module "socket.io/dist/socket" {
    interface Handshake
    {
        session?: HandshakeSession;
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
            res: unknown,
            next: (err?: ExtendedError) => void,
        ): void;
    }
}

// класс - обработчик сокетов
export class SocketHandler
{
    private io: SocketIO.Server;

    private sessionMiddleware: RequestHandler;
    private mediasoup: Mediasoup;
    private fileHandler: FileHandler;
    private rooms: Map<RoomId, Room>;

    private roomIndex: number;

    private createSocketServer(server: https.Server): SocketIO.Server
    {
        return new SocketIO.Server(server, {
            transports: ['websocket'],
            pingInterval: 5000,
            pingTimeout: 15000,
            serveClient: false
        });
    }

    constructor(
        _server: https.Server,
        _sessionMiddleware: RequestHandler,
        _mediasoup: Mediasoup,
        _fileHandler: FileHandler,
        _rooms: Map<RoomId, Room>,
        _roomIndex: number)
    {
        this.io = this.createSocketServer(_server);

        this.sessionMiddleware = _sessionMiddleware;
        this.mediasoup = _mediasoup;
        this.fileHandler = _fileHandler;
        this.rooms = _rooms;
        this.roomIndex = _roomIndex;

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
        const roomList: RoomForUser[] = [];
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
            const session = socket.handshake.session!;
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
                socket.emit('roomList', this.getRoomList(), this.roomIndex);

                socket.on('deleteRoom', (id: RoomId) =>
                {
                    this.removeRoom(id);
                    this.io.of('/').emit('deletedRoom', id);
                });

                socket.on('createRoom', async (info: NewRoomInfo) =>
                {
                    const roomId: RoomId = String(++this.roomIndex);
                    await this.createRoom(roomId, info);

                    const roomInfo: RoomForUser = {
                        id: roomId,
                        name: info.name
                    };

                    this.io.of('/').emit('newRoom', roomInfo);
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
            this,
            this.fileHandler
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
            const session = socket.handshake.session!;
            const roomId: string | undefined = session.joinedRoomId;

            // если в сессии нет номера комнаты, или такой комнаты не существует
            if (!roomId || !this.rooms.has(roomId))
                return;

            const room: Room = this.rooms.get(roomId)!;

            socket.emit('roomName', room.name);

            socket.on('joinRoom', (pass: string) =>
            {
                let result = false;
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

    private async joinRoom(room: Room, socket: Socket): Promise<void>
    {
        await socket.join(room.id);
        room.join(socket);
    }

    private handleRoom(): void
    {
        this.io.of('/room').use((socket: Socket, next) =>
        {
            this.sessionMiddleware(socket.handshake, {}, next);
        });

        this.io.of('/room').use((socket: Socket, next) =>
        {
            const session = socket.handshake.session!;
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
        this.io.of('/room').on('connection', async (socket: Socket) =>
        {
            const session = socket.handshake.session!;
            const roomId: string = session.joinedRoomId!;

            if (!this.rooms.has(roomId)) { return; }

            const room: Room = this.rooms.get(roomId)!;

            await this.joinRoom(room, socket);
        });
    }

    public getSocketById(id: SocketId): Socket
    {
        return this.io.of('/room').sockets.get(id)!;
    }

    public emitTo(name: string, ev: string, ...args: any[]): boolean
    {
        return this.io.of('/room').to(name).emit(ev, ...args);
    }

    public emitToAll(ev: string, ...args: any[]) : boolean
    {
        return this.io.of('/room').emit(ev, ...args);
    }

    public getSocketsCount(): number
    {
        return this.io.of('/room').sockets.size;
    }
}