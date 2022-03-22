import https = require('https');
import session = require('express-session');
import { RequestHandler } from 'express';

import SocketIO = require('socket.io');
import { Handshake } from 'socket.io/dist/socket';
import { ExtendedError } from 'socket.io/dist/namespace';

import { IFileService } from "../FileService/FileService";
import { IRoomRepository } from "../RoomRepository";
import { AdminSocketService } from "./AdminSocketService";
import { GeneralSocketService, IGeneralSocketService } from "./GeneralSocketService";
import { AuthSocketService } from "./AuthSocketService";
import { IRoomSocketService, RoomSocketService } from "./RoomSocketService";
import { IUserBanRepository } from "../UserBanRepository";

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

    private generalSocketService: IGeneralSocketService;
    private adminSocketService: AdminSocketService;
    private authSocketService: AuthSocketService;
    private roomSocketService: IRoomSocketService;
    private userBanRepository: IUserBanRepository;

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

    private applyCheckBanMiddleware(socket: SocketIO.Socket, next: (err?: ExtendedError) => void)
    {
        if (!this.userBanRepository.has(socket.handshake.address))
        {
            next();
        }
        else
        {
            next(new Error("banned"));
        }
    }

    constructor(
        server: https.Server,
        sessionMiddleware: RequestHandler,
        fileService: IFileService,
        roomRepository: IRoomRepository,
        userBanRepository: IUserBanRepository
    )
    {
        this.io = this.createSocketServer(server);
        this.userBanRepository = userBanRepository;

        const generalNS = this.io.of("/");
        const authNS = this.io.of("/auth");
        const roomNS = this.io.of("/room");
        const adminNS = this.io.of("/admin");

        generalNS.use((socket, next) => this.applyCheckBanMiddleware(socket, next));
        authNS.use((socket, next) => this.applyCheckBanMiddleware(socket, next));
        roomNS.use((socket, next) => this.applyCheckBanMiddleware(socket, next));
        adminNS.use((socket, next) => this.applyCheckBanMiddleware(socket, next));

        // главная страница (общие события)
        this.generalSocketService = new GeneralSocketService(
            generalNS,
            roomRepository
        );

        // авторизация
        this.authSocketService = new AuthSocketService(
            authNS,
            roomRepository,
            sessionMiddleware
        );

        // события комнаты
        this.roomSocketService = new RoomSocketService(
            roomNS,
            this.generalSocketService,
            roomRepository,
            sessionMiddleware,
            fileService
        );

        // события администратора
        this.adminSocketService = new AdminSocketService(
            adminNS,
            this.generalSocketService,
            this.roomSocketService,
            roomRepository,
            sessionMiddleware,
            userBanRepository
        );
    }
}