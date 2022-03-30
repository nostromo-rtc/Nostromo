
import { RequestHandler } from "express";
import SocketIO = require('socket.io');

import { HandshakeSession } from "./SocketManager";
import { IGeneralSocketService } from "./GeneralSocketService";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";
import { IRoomRepository } from "../RoomRepository";
import { NewRoomInfo, NewRoomNameInfo, NewRoomPassInfo, UpdateRoomInfo } from "nostromo-shared/types/AdminTypes";
import { IRoomSocketService } from "./RoomSocketService";
import { PublicRoomInfo, UserInfo } from "nostromo-shared/types/RoomTypes";
import { IUserBanRepository } from "../UserBanRepository";
import { IUserAccountRepository } from "../UserAccountRepository";

type Socket = SocketIO.Socket;

export class AdminSocketService
{
    private adminIo: SocketIO.Namespace;
    private generalSocketService: IGeneralSocketService;
    private roomSocketService: IRoomSocketService;
    private roomRepository: IRoomRepository;
    private userAccountRepository: IUserAccountRepository;
    private userBanRepository: IUserBanRepository;

    constructor(
        adminIo: SocketIO.Namespace,
        generalSocketService: IGeneralSocketService,
        roomSocketService: IRoomSocketService,
        roomRepository: IRoomRepository,
        userAccountRepository: IUserAccountRepository,
        userBanRepository: IUserBanRepository,
        sessionMiddleware: RequestHandler
    )
    {
        this.adminIo = adminIo;
        this.generalSocketService = generalSocketService;
        this.roomSocketService = roomSocketService;

        this.roomRepository = roomRepository;
        this.userAccountRepository = userAccountRepository;
        this.userBanRepository = userBanRepository;

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

            socket.on(SE.DeleteRoom, async (roomId: string) =>
            {
                await this.deleteRoom(roomId);
            });

            socket.on(SE.CreateRoom, async (info: NewRoomInfo) =>
            {
                await this.createRoom(info);
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

            socket.on(SE.BanUser, async (userId: string) =>
            {
                await this.roomSocketService.banUser(userId);
            });

            socket.on(SE.BanUserByIp, async (userIp: string) =>
            {
                await this.userBanRepository.create({ ip: userIp });
            });

            socket.on(SE.UnbanUserByIp, async (userIp: string) =>
            {
                await this.userBanRepository.remove(userIp);
            });

            socket.on(SE.ChangeRoomName, async (info: NewRoomNameInfo) =>
            {
                await this.changeRoomName(info);
            });

            socket.on(SE.ChangeRoomPass, async (info: NewRoomPassInfo) =>
            {
                await this.changeRoomPass(info);
            });
        });
    }

    /** Создать комнату. */
    private async createRoom(info: NewRoomInfo)
    {
        const id = await this.roomRepository.create(info);

        const newRoomInfo: PublicRoomInfo = {
            id,
            name: info.name,
            videoCodec: info.videoCodec
        };

        this.generalSocketService.notifyAboutCreatedRoom(newRoomInfo);
    }

    /** Удалить комнату. */
    private async deleteRoom(roomId: string)
    {
        this.generalSocketService.notifyAboutDeletedRoom(roomId);
        this.generalSocketService.unsubscribeAllUserListSubscribers(roomId);
        this.roomSocketService.kickAllUsers(roomId);
        await this.roomRepository.remove(roomId);
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

    /** Изменить название комнаты. */
    private async changeRoomName(info: NewRoomNameInfo)
    {
        const { id, name } = info;
        const room = this.roomRepository.get(id);

        if (!room)
        {
            return;
        }

        const updateRoomInfo: UpdateRoomInfo = { id, name };
        await this.roomRepository.update(updateRoomInfo);

        this.generalSocketService.notifyAboutChangedRoomName({id, name});
    }

    /** Изменить пароль комнаты. */
    private async changeRoomPass(info: NewRoomPassInfo)
    {
        const { id, password } = info;
        const room = this.roomRepository.get(id);

        if (!room)
        {
            return;
        }

        const updateRoomInfo: UpdateRoomInfo = { id, password };
        await this.roomRepository.update(updateRoomInfo);
    }
}