import https = require('https');
import session = require('express-session');
import { RequestHandler } from 'express';

import SocketIO = require('socket.io');
import { Handshake } from 'socket.io/dist/socket';
import { ExtendedError } from 'socket.io/dist/namespace';

import { Room } from '../Room';
import { IMediasoupService } from '../MediasoupService';
import { IFileService } from "../FileService/FileService";
import { IRoomRepository } from "../RoomRepository";
import { AdminSocketService, IAdminSocketService } from "./AdminSocketService";
import { GeneralSocketService, IGeneralSocketService } from "./GeneralSocketService";
import { AuthSocketService, IAuthSocketService } from "./AuthSocketService";

type Socket = SocketIO.Socket;

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
export class SocketManager
{
    /** SocketIO сервер. */
    private io: SocketIO.Server;
    /** Middleware для поддержки сессий. */
    private sessionMiddleware: RequestHandler;
    /** Сервис для работы с комнатами. */
    private roomRepository: IRoomRepository;

    private generalSocketService: IGeneralSocketService;
    private adminSocketService: IAdminSocketService;
    private authSocketService: IAuthSocketService;

    /** Создать SocketIO сервер. */
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
        server: https.Server,
        sessionMiddleware: RequestHandler,
        mediasoup: IMediasoupService,
        fileHandler: IFileService,
        roomRepository: IRoomRepository)
    {
        this.io = this.createSocketServer(server);
        this.sessionMiddleware = sessionMiddleware;
        this.roomRepository = roomRepository;

        // главная страница (общие события)
        this.generalSocketService = new GeneralSocketService(
            this.io.of("/"),
            this.roomRepository
        );

        // события администратора
        this.adminSocketService = new AdminSocketService(
            this.io.of("/admin"),
            this.generalSocketService,
            this.roomRepository,
            this.sessionMiddleware
        );

        // авторизация
        this.authSocketService = new AuthSocketService(
            this.io.of("/auth"),
            this.roomRepository,
            this.sessionMiddleware
        )

        // события комнаты
        this.handleRoom();
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

    public getSocketById(namespace: string, id: string): Socket
    {
        return this.io.of(namespace).sockets.get(id)!;
    }

    public emitTo(namespace: string, name: string, ev: string, ...args: unknown[]): boolean
    {
        return this.io.of(namespace).to(name).emit(ev, ...args);
    }

    public emitToAll(namespace: string, ev: string, ...args: unknown[]): boolean
    {
        return this.io.of(namespace).emit(ev, ...args);
    }

    public getSocketsCount(namespace: string): number
    {
        return this.io.of(namespace).sockets.size;
    }
}