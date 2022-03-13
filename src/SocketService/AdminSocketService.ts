
import { RequestHandler } from "express";
import SocketIO = require('socket.io');

import { HandshakeSession } from "./SocketManager";
import { IGeneralSocketService } from "./GeneralSocketService";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";
import { IRoomRepository } from "../RoomRepository";
import { NewRoomInfo, RoomLinkInfo } from "nostromo-shared/types/AdminTypes";
import { IRoomSocketService } from "./RoomSocketService";
import { UserInfo } from "nostromo-shared/types/RoomTypes";
type Socket = SocketIO.Socket;

export class AdminSocketService
{
    private adminIo: SocketIO.Namespace;

    private generalSocketService: IGeneralSocketService;

    private roomSocketService: IRoomSocketService;

    private roomRepository: IRoomRepository;

    constructor(
        adminIo: SocketIO.Namespace,
        generalSocketService: IGeneralSocketService,
        roomSocketService: IRoomSocketService,
        roomRepository: IRoomRepository,
        sessionMiddleware: RequestHandler
    )
    {
        this.adminIo = adminIo;
        this.generalSocketService = generalSocketService;
        this.roomSocketService = roomSocketService;

        this.roomRepository = roomRepository;

        this.applySessionMiddleware(sessionMiddleware);
        this.checkIp();
        this.clientConnected();
    }

    /** Применяем middlware для сессий. */
    private applySessionMiddleware(sessionMiddleware: RequestHandler)
    {
        this.adminIo.use((socket: Socket, next) =>
        {
            sessionMiddleware(socket.handshake, {}, next);
        });
    }

    /** Проверяем IP. */
    private checkIp()
    {
        this.adminIo.use((socket: Socket, next) =>
        {
            // TODO: сделать поддержку списка доверенных IP

            // если с недоверенного ip, то не открываем вебсокет-соединение
            if ((socket.handshake.address == process.env.ALLOW_ADMIN_IP)
                || (process.env.ALLOW_ADMIN_EVERYWHERE === 'true'))
            {
                return next();
            }
            return next(new Error("unauthorized"));
        });
    }

    /** Клиент подключился. */
    private clientConnected()
    {
        this.adminIo.on('connection', (socket: Socket) =>
        {
            const session = socket.handshake.session!;
            if (!session.admin)
            {
                this.adminAuth(socket, session);
                return;
            }

            socket.emit(SE.RoomList, this.roomRepository.getRoomLinkList());

            socket.on(SE.DeleteRoom, (id: string) =>
            {
                this.roomRepository.remove(id);
                this.generalSocketService.notifyAboutDeletedRoom(id);
            });

            socket.on(SE.CreateRoom, async (info: NewRoomInfo) =>
            {
                const id = await this.roomRepository.create(info);

                const newRoomInfo: RoomLinkInfo = {
                    id,
                    name: info.name
                };

                socket.emit(SE.RoomCreated, newRoomInfo);
                this.generalSocketService.notifyAboutCreatedRoom(newRoomInfo);
            });

            socket.on(SE.KickUser, (userId: string) =>
            {
                this.roomSocketService.kickUser(userId);
            });

            socket.on(SE.StopUserVideo, (userId: string) =>
            {
                this.roomSocketService.stopUserVideo(userId);
            });

            socket.on(SE.StopUserAudio, (userId: string) =>
            {
                this.roomSocketService.stopUserAudio(userId);
            });

            socket.on(SE.ChangeUsername, (info: UserInfo) =>
            {
                this.roomSocketService.changeUsername(info);
            });
        });
    }

    /** Авторизация в админку. */
    private adminAuth(socket: Socket, session: HandshakeSession)
    {
        socket.on(SE.AdminAuth, (pass: string) =>
        {
            let result = false;
            if (pass == process.env.ADMIN_PASS)
            {
                session.admin = true;
                session.save();
                result = true;
            }

            socket.emit(SE.Result, result);
        });
    }
}