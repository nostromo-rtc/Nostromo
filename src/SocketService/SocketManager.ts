import https = require('https');

import SocketIO = require('socket.io');
import { ExtendedError } from 'socket.io/dist/namespace';

import { IRoomRepository } from "../Room/RoomRepository";
import { AdminSocketService } from "./AdminSocketService";
import { GeneralSocketService, IGeneralSocketService } from "./GeneralSocketService";
import { AuthSocketService } from "./AuthSocketService";
import { IRoomSocketService, RoomSocketService } from "./RoomSocketService";
import { IUserBanRepository } from "../User/UserBanRepository";
import { IUserAccountRepository } from "../User/UserAccountRepository";
import { IAuthRoomUserRepository } from "../User/AuthRoomUserRepository";
import { IMediasoupService } from "../MediasoupService";
import { IFileRepository } from "../FileService/FileRepository";
import { TokenData } from "../TokenService";

// расширяю класс Handshake у сокетов, добавляя в него Express сессии
declare module "socket.io/dist/socket" {
    interface Handshake
    {
        token?: TokenData;
    }
}

/** Обработчик веб-сокетов. */
export class SocketManager
{
    /** SocketIO сервер. */
    private io: SocketIO.Server;
    private namespaces = new Map<string, SocketIO.Namespace>();
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
        if (!this.userBanRepository.has(socket.handshake.address.substring(7)))
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
        fileRepository: IFileRepository,
        mediasoupService: IMediasoupService,
        roomRepository: IRoomRepository,
        userAccountRepository: IUserAccountRepository,
        userBanRepository: IUserBanRepository,
        authRoomUserRepository: IAuthRoomUserRepository
    )
    {
        this.io = this.createSocketServer(server);
        this.userBanRepository = userBanRepository;

        this.namespaces.set("general", this.io.of("/"));
        this.namespaces.set("auth", this.io.of("/auth"));
        this.namespaces.set("room", this.io.of("/room"));
        this.namespaces.set("admin", this.io.of("/admin"));

        for (const mapValue of this.namespaces)
        {
            const ns = mapValue[1];
            ns.use((socket, next) => this.applyCheckBanMiddleware(socket, next));
        }

        // главная страница (общие события)
        this.generalSocketService = new GeneralSocketService(
            this.namespaces.get("general")!,
            roomRepository
        );

        // авторизация
        this.authSocketService = new AuthSocketService(
            this.namespaces.get("auth")!,
            roomRepository,
            userAccountRepository,
            authRoomUserRepository
        );

        // события комнаты
        this.roomSocketService = new RoomSocketService(
            this.namespaces.get("room")!,
            this.generalSocketService,
            fileRepository,
            mediasoupService,
            roomRepository,
            userAccountRepository,
            userBanRepository,
            authRoomUserRepository
        );

        // события администратора
        this.adminSocketService = new AdminSocketService(
            this.namespaces.get("admin")!,
            this.generalSocketService,
            this.roomSocketService,
            roomRepository,
            userBanRepository,
            authRoomUserRepository,
            userAccountRepository
        );
    }
}