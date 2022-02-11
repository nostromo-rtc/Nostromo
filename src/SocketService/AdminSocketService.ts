
import { RequestHandler } from "express";
import SocketIO = require('socket.io');

import { HandshakeSession } from "./SocketManager";
import { IGeneralSocketService } from "./GeneralSocketService";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";
import { IRoomRepository } from "../RoomRepository";
import { NewRoomInfo, RoomLinkInfo } from "nostromo-shared/types/AdminTypes";
type Socket = SocketIO.Socket;

export interface IAdminSocketService
{
    /** Отправить новый список пользователей комнаты roomId всем подписчикам. */
    sendUserListToAllSubscribers(roomId: string): void;
    /** Отправить список пользователей комнаты roomId подписчику subscriberId. */
    sendUserListToSubscriber(subscriberId: string, roomId: string): void;
}

export class AdminSocketService implements IAdminSocketService
{
    private adminIo: SocketIO.Namespace;
    private generalSocketService: IGeneralSocketService;
    private roomRepository: IRoomRepository;

    constructor(
        adminIo: SocketIO.Namespace,
        generalSocketService: IGeneralSocketService,
        roomRepository: IRoomRepository,
        sessionMiddleware: RequestHandler
    )
    {
        this.adminIo = adminIo;
        this.generalSocketService = generalSocketService;
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

                this.generalSocketService.notifyAboutCreatedRoom(newRoomInfo);
            });

            socket.on(SE.SubscribeUserList, async (roomId: string) =>
            {
                // Если такой комнаты вообще нет.
                if (!this.roomRepository.has(roomId))
                {
                    return;
                }

                // подписываемся на получение списка юзеров в комнате roomId
                await socket.join(`${SE.UserList}-${roomId}`);

                // отправляем список пользователей этой комнаты
                this.sendUserListToSubscriber(socket.id, roomId);
            });

            socket.on(SE.UnsubscribeUserList, async (roomId: string) =>
            {
                // Если такой комнаты вообще нет.
                if (!this.roomRepository.has(roomId))
                {
                    return;
                }

                // отписываемся от получения списка юзеров в комнате roomId
                await socket.leave(`${SE.UserList}-${roomId}`);
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
    public sendUserListToAllSubscribers(roomId: string): void
    {
        const userList = this.roomRepository.getUserList(roomId);
        this.adminIo.to(`${SE.UserList}-${roomId}`).emit(SE.UserList, userList);
    }
    public sendUserListToSubscriber(subscriberId: string, roomId: string): void
    {
        const userList = this.roomRepository.getUserList(roomId);
        this.adminIo.to(subscriberId).emit(SE.UserList, userList);
    }
}