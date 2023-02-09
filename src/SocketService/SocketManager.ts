import https = require('https');
import proxyAddr = require("proxy-addr");

import SocketIO = require('socket.io');
import { ExtendedError } from 'socket.io/dist/namespace';
import { ProxyAddrTrust } from "..";

import { IFileRepository } from "../FileService/FileRepository";
import { IMediasoupService } from "../MediasoupService";
import { IRoomChatRepository } from "../Room/RoomChatRepository";
import { IRoomRepository } from "../Room/RoomRepository";
import { TokenSocketMiddleware } from "../TokenService";
import { IAuthRoomUserRepository } from "../User/AuthRoomUserRepository";
import { IUserAccountRepository } from "../User/UserAccountRepository";
import { IUserBanRepository } from "../User/UserBanRepository";
import { AdminSocketService } from "./AdminSocketService";
import { GeneralSocketService, IGeneralSocketService } from "./GeneralSocketService";
import { IRoomSocketService, RoomSocketService } from "./RoomSocketService";


export type SocketNextFunction = (err?: ExtendedError) => void;
type SocketMiddleware = (req: SocketIO.Socket, next: SocketNextFunction) => void;

// Расширяю класс Handshake у Socket.IO, добавляя в него клиентский ip-адрес.
declare module "socket.io/dist/socket" {
    interface Handshake
    {
        clientIp: string;
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
    private roomSocketService: IRoomSocketService;
    private userBanRepository: IUserBanRepository;

    private trustProxyAddrFunc?: ProxyAddrTrust;

    /** Создать SocketIO сервер. */
    private createSocketServer(server: https.Server): SocketIO.Server
    {
        return new SocketIO.Server(server, {
            transports: ['websocket'],
            pingInterval: 5000,
            pingTimeout: 15000,
            serveClient: false,
        });
    }

    private getClientIpMiddleware: SocketMiddleware = (socket, next) => 
    {
        let clientIp = "";

        if (this.trustProxyAddrFunc !== undefined)
        {
            clientIp = proxyAddr(socket.request, this.trustProxyAddrFunc);
        }
        else
        {
            clientIp = socket.handshake.address.substring(7);
        }

        socket.handshake.clientIp = clientIp;

        next();
    }

    private checkBanMiddleware: SocketMiddleware = (socket, next) =>
    {
        const ip = socket.handshake.clientIp;

        if (!this.userBanRepository.has(ip))
        {
            next();
        }
        else
        {
            next(new Error("banned"));
        }
    };

    constructor(
        server: https.Server,
        tokenMiddleware: TokenSocketMiddleware,
        fileRepository: IFileRepository,
        mediasoupService: IMediasoupService,
        roomRepository: IRoomRepository,
        userAccountRepository: IUserAccountRepository,
        userBanRepository: IUserBanRepository,
        authRoomUserRepository: IAuthRoomUserRepository,
        roomChatRepository: IRoomChatRepository,
        adminAllowlist: Set<string>,
        trustProxyAddrFunc: ProxyAddrTrust | undefined
    )
    {
        this.io = this.createSocketServer(server);
        this.userBanRepository = userBanRepository;
        this.trustProxyAddrFunc = trustProxyAddrFunc;

        this.namespaces.set("general", this.io.of("/"));
        this.namespaces.set("room", this.io.of("/room"));
        this.namespaces.set("admin", this.io.of("/admin"));

        for (const mapValue of this.namespaces)
        {
            const ns = mapValue[1];
            ns.use(this.getClientIpMiddleware);
            ns.use(this.checkBanMiddleware);
        }

        // главная страница (общие события)
        this.generalSocketService = new GeneralSocketService(
            this.namespaces.get("general")!,
            roomRepository
        );

        // события комнаты
        this.roomSocketService = new RoomSocketService(
            this.namespaces.get("room")!,
            this.generalSocketService,
            tokenMiddleware,
            fileRepository,
            mediasoupService,
            roomRepository,
            userAccountRepository,
            userBanRepository,
            authRoomUserRepository,
            roomChatRepository
        );

        // события администратора
        this.adminSocketService = new AdminSocketService(
            this.namespaces.get("admin")!,
            tokenMiddleware,
            this.generalSocketService,
            this.roomSocketService,
            roomRepository,
            userBanRepository,
            authRoomUserRepository,
            userAccountRepository,
            roomChatRepository,
            fileRepository,
            adminAllowlist
        );
    }
}