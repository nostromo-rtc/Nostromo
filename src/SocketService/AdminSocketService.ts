
import { RequestHandler } from "express";
import SocketIO = require('socket.io');

import { HandshakeSession } from "./SocketManager";
import { IGeneralSocketService } from "./GeneralSocketService";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";
import { IRoomRepository } from "../Room/RoomRepository";
import { ActionOnUserInfo, ChangeUserNameInfo, NewRoomInfo, NewRoomNameInfo, NewRoomPassInfo, UpdateRoomInfo } from "nostromo-shared/types/AdminTypes";
import { IRoomSocketService } from "./RoomSocketService";
import { PublicRoomInfo } from "nostromo-shared/types/RoomTypes";
import { IUserBanRepository } from "../User/UserBanRepository";
import { IAuthRoomUserRepository } from "../User/AuthRoomUserRepository";

type Socket = SocketIO.Socket;

export class AdminSocketService
{
    private adminIo: SocketIO.Namespace;
    private generalSocketService: IGeneralSocketService;
    private roomSocketService: IRoomSocketService;
    private roomRepository: IRoomRepository;
    private authRoomUserRepository: IAuthRoomUserRepository;
    private userBanRepository: IUserBanRepository;

    constructor(
        adminIo: SocketIO.Namespace,
        generalSocketService: IGeneralSocketService,
        roomSocketService: IRoomSocketService,
        roomRepository: IRoomRepository,
        userBanRepository: IUserBanRepository,
        authRoomUserRepository: IAuthRoomUserRepository,
        sessionMiddleware: RequestHandler
    )
    {
        this.adminIo = adminIo;
        this.generalSocketService = generalSocketService;
        this.roomSocketService = roomSocketService;

        this.roomRepository = roomRepository;
        this.authRoomUserRepository = authRoomUserRepository;
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

            socket.on(SE.KickUser, (info: ActionOnUserInfo) =>
            {
                this.roomSocketService.kickUser(info);
                this.authRoomUserRepository.remove(info.roomId, info.userId);
            });

            socket.on(SE.StopUserDisplay, (info: ActionOnUserInfo) =>
            {
                this.roomSocketService.stopUserDisplay(info);
            });

            socket.on(SE.StopUserCam, (info: ActionOnUserInfo) =>
            {
                this.roomSocketService.stopUserCam(info);
            });

            socket.on(SE.StopUserAudio, (info: ActionOnUserInfo) =>
            {
                this.roomSocketService.stopUserAudio(info);
            });

            socket.on(SE.ChangeUsername, (info: ChangeUserNameInfo) =>
            {
                this.roomSocketService.changeUsername(info);
            });

            socket.on(SE.BanUser, async (info: ActionOnUserInfo) =>
            {
                await this.roomSocketService.banUser(info);
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

        const updateRoomInfo: UpdateRoomInfo = { id, name };
        await this.roomRepository.update(updateRoomInfo);

        this.generalSocketService.notifyAboutChangedRoomName({ id, name });
    }

    /** Изменить пароль комнаты. */
    private async changeRoomPass(info: NewRoomPassInfo)
    {
        const { id, password } = info;

        const updateRoomInfo: UpdateRoomInfo = { id, password };
        await this.roomRepository.update(updateRoomInfo);

        // После смены пароля деавторизуем всех в комнате.
        this.authRoomUserRepository.removeAll(id);
    }
}