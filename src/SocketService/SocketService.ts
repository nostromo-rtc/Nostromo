import https = require('https');
import session = require('express-session');
import SocketIO = require('socket.io');
import { Handshake } from 'socket.io/dist/socket';
import { ExtendedError } from 'socket.io/dist/namespace';
import { RequestHandler } from 'express';
import { RoomId, Room } from '../Room';
import { NewRoomInfo } from "nostromo-shared/types/AdminTypes";
import { MediasoupService } from '../MediasoupService';
import { FileService } from "../FileService/FileService";

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

/** Обработчик веб-сокетов. */
export class SocketService
{
    private io: SocketIO.Server;

    private sessionMiddleware: RequestHandler;
    private mediasoup: MediasoupService;
    private fileHandler: FileService;
    private rooms: Map<RoomId, Room>;
    private roomIndex: number;
    /** Подписан ли кто-то на получение списка пользователей в этой комнате, или нет. */
    public userListSubscriptionsByRoom = new Map<RoomId, number>();
    /** Кто подписан на изменение списка пользователя в этой комнате. */
    private userListSubscriptionsBySocket = new Map<SocketId, RoomId>();

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
        _mediasoup: MediasoupService,
        _fileHandler: FileService,
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

                socket.on('userList', async (roomId: string) =>
                {
                    // Если такой комнаты вообще нет.
                    if (!this.rooms.has(roomId))
                    {
                        return;
                    }

                    const previousSelectedRoom = this.userListSubscriptionsBySocket.get(socket.id);

                    // Если новая выбранная комната на самом деле не новая, а та же самая.
                    if (previousSelectedRoom != undefined
                        && previousSelectedRoom == roomId)
                    {
                        return;
                    }

                    // Смотрим счётчик подписавшихся на комнату.
                    let previousValue = this.userListSubscriptionsByRoom.get(roomId);
                    if (previousValue == undefined)
                    {
                        this.userListSubscriptionsByRoom.set(roomId, 0);
                        previousValue = 0;
                    }

                    // Если до этого были подписаны на изменение списка юзеров
                    // в другой комнате, то отписываемся.
                    if (previousSelectedRoom)
                    {
                        this.userListSubscriptionsByRoom.set(previousSelectedRoom, previousValue - 1);
                    }

                    this.userListSubscriptionsBySocket.set(socket.id, roomId);
                    this.userListSubscriptionsByRoom.set(roomId, previousValue + 1);

                    await socket.join(`userList-${roomId}`);

                    this.rooms.get(roomId)!.sendUserList();
                });

                socket.on('disconnect', () =>
                {
                    const roomId = this.userListSubscriptionsBySocket.get(socket.id);
                    if (roomId)
                    {
                        const previousValue = this.userListSubscriptionsByRoom.get(roomId)!;
                        this.userListSubscriptionsByRoom.set(roomId, previousValue - 1);
                    }

                    this.userListSubscriptionsBySocket.delete(socket.id);
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

    public emitTo(namespace: string, name: string, ev: string, ...args: unknown[]): boolean
    {
        return this.io.of(`/${namespace}`).to(name).emit(ev, ...args);
    }

    public emitToAll(ev: string, ...args: unknown[]): boolean
    {
        return this.io.of('/room').emit(ev, ...args);
    }

    public getSocketsCount(): number
    {
        return this.io.of('/room').sockets.size;
    }
}