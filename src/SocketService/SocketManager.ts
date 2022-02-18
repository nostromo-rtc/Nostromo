import https = require('https');
import session = require('express-session');
import { RequestHandler } from 'express';

import SocketIO = require('socket.io');
import { Handshake } from 'socket.io/dist/socket';
import { ExtendedError } from 'socket.io/dist/namespace';

import { IMediasoupService } from '../MediasoupService';
import { IFileService } from "../FileService/FileService";
import { IRoomRepository } from "../RoomRepository";
import { AdminSocketService, IAdminSocketService } from "./AdminSocketService";
import { GeneralSocketService, IGeneralSocketService } from "./GeneralSocketService";
import { AuthSocketService } from "./AuthSocketService";
import { RoomSocketService } from "./RoomSocketService";

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
    private adminSocketService: IAdminSocketService;
    private authSocketService: AuthSocketService;
    private roomSocketService: RoomSocketService;

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
        fileService: IFileService,
        roomRepository: IRoomRepository)
    {
        this.io = this.createSocketServer(server);

        // главная страница (общие события)
        this.generalSocketService = new GeneralSocketService(
            this.io.of("/"),
            roomRepository
        );

        // события администратора
        this.adminSocketService = new AdminSocketService(
            this.io.of("/admin"),
            this.generalSocketService,
            roomRepository,
            sessionMiddleware
        );

        // авторизация
        this.authSocketService = new AuthSocketService(
            this.io.of("/auth"),
            roomRepository,
            sessionMiddleware
        );

        // события комнаты
        this.roomSocketService = new RoomSocketService(
            this.io.of("/room"),
            this.adminSocketService,
            roomRepository,
            sessionMiddleware,
            fileService
        );
    }
}