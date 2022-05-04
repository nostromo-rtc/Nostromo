
import SocketIO = require('socket.io');

import { IGeneralSocketService } from "./GeneralSocketService";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";
import { IRoomRepository } from "../Room/RoomRepository";
import { ActionOnUserInfo, ChangeUserNameInfo, NewRoomInfo, NewRoomNameInfo, NewRoomPassInfo, NewRoomSaveChatPolicyInfo, UpdateRoomInfo } from "nostromo-shared/types/AdminTypes";
import { IRoomSocketService } from "./RoomSocketService";
import { PublicRoomInfo } from "nostromo-shared/types/RoomTypes";
import { IUserBanRepository } from "../User/UserBanRepository";
import { IAuthRoomUserRepository } from "../User/AuthRoomUserRepository";
import { IUserAccountRepository } from "../User/UserAccountRepository";
import { TokenSocketMiddleware } from "../TokenService";
import { IRoomChatRepository } from "../Room/RoomChatRepository";
import { IFileRepository } from "../FileService/FileRepository";

type Socket = SocketIO.Socket;

export class AdminSocketService
{
    private adminIo: SocketIO.Namespace;
    private generalSocketService: IGeneralSocketService;
    private roomSocketService: IRoomSocketService;
    private roomRepository: IRoomRepository;
    private authRoomUserRepository: IAuthRoomUserRepository;
    private userBanRepository: IUserBanRepository;
    private userAccountRepository: IUserAccountRepository;
    private roomChatRepository: IRoomChatRepository;
    private fileRepository: IFileRepository;

    constructor(
        adminIo: SocketIO.Namespace,
        tokenMiddleware: TokenSocketMiddleware,
        generalSocketService: IGeneralSocketService,
        roomSocketService: IRoomSocketService,
        roomRepository: IRoomRepository,
        userBanRepository: IUserBanRepository,
        authRoomUserRepository: IAuthRoomUserRepository,
        userAccountRepository: IUserAccountRepository,
        roomChatRepository: IRoomChatRepository,
        fileRepository: IFileRepository
    )
    {
        this.adminIo = adminIo;
        this.generalSocketService = generalSocketService;
        this.roomSocketService = roomSocketService;

        this.roomRepository = roomRepository;
        this.authRoomUserRepository = authRoomUserRepository;
        this.userBanRepository = userBanRepository;
        this.userAccountRepository = userAccountRepository;
        this.roomChatRepository = roomChatRepository;
        this.fileRepository = fileRepository;

        this.checkIp();

        this.adminIo.use(tokenMiddleware);

        this.clientConnected();
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
            const userId = socket.handshake.token.userId;
            if (!userId || !this.userAccountRepository.isAdmin(userId))
            {
                return;
            }

            socket.emit(SE.RoomList, this.roomRepository.getRoomLinkList());

            socket.on(SE.CreateRoom, this.createRoom);
            socket.on(SE.DeleteRoom, this.deleteRoom);
            socket.on(SE.ChangeRoomName, this.changeRoomName);
            socket.on(SE.ChangeRoomPass, this.changeRoomPass);
            socket.on(SE.ChangeRoomSaveChatPolicy, this.changeRoomSaveChatPolicy);

            socket.on(SE.ClearRoomChat, async (roomId: string) =>
            {
                await this.roomChatRepository.removeAll(roomId);
            });

            socket.on(SE.DeleteRoomFiles, async (roomId: string) =>
            {
                await this.fileRepository.removeByRoom(roomId);
            });

            socket.on(SE.KickUser, this.kickUser);

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
        });
    }

    /** Создать комнату. */
    private createRoom = async (info: NewRoomInfo): Promise<void> =>
    {
        const id = await this.roomRepository.create(info);

        const newRoomInfo: PublicRoomInfo = {
            id,
            name: info.name,
            videoCodec: info.videoCodec
        };

        this.generalSocketService.notifyAboutCreatedRoom(newRoomInfo);
    };

    /** Удалить комнату. */
    private deleteRoom = async (roomId: string): Promise<void> =>
    {
        this.generalSocketService.notifyAboutDeletedRoom(roomId);
        this.generalSocketService.unsubscribeAllUserListSubscribers(roomId);
        this.roomSocketService.kickAllUsers(roomId);
        await this.roomRepository.remove(roomId);

        // После удаления комнаты, стираем данные об авторизациях в этой комнате.
        await this.authRoomUserRepository.removeAll(roomId);

        // Удаляем все файлы, связанные с комнатой.
        await this.fileRepository.removeByRoom(roomId);

        // Удаляем историю чата комнаты.
        await this.roomChatRepository.removeAll(roomId);
    };

    /** Кик пользователя. */
    private kickUser = async (info: ActionOnUserInfo) =>
    {
        this.roomSocketService.kickUser(info);
        await this.authRoomUserRepository.remove(info.roomId, info.userId);
    };

    /** Изменить название комнаты. */
    private changeRoomName = async (info: NewRoomNameInfo): Promise<void> =>
    {
        const { id, name } = info;

        const updateRoomInfo: UpdateRoomInfo = { id, name };
        await this.roomRepository.update(updateRoomInfo);

        this.generalSocketService.notifyAboutChangedRoomName({ id, name });
    };

    /** Изменить пароль комнаты. */
    private changeRoomPass = async (info: NewRoomPassInfo): Promise<void> =>
    {
        const { id, password } = info;

        const updateRoomInfo: UpdateRoomInfo = { id, password };
        await this.roomRepository.update(updateRoomInfo);

        // После смены пароля деавторизуем всех в комнате.
        await this.authRoomUserRepository.removeAll(id);
    };

    /** Изменить политику сохранения истории чатов. */
    private changeRoomSaveChatPolicy = async (info: NewRoomSaveChatPolicyInfo): Promise<void> =>
    {
        const { id, saveChatPolicy } = info;

        const updateRoomInfo: UpdateRoomInfo = { id, saveChatPolicy };
        await this.roomRepository.update(updateRoomInfo);
    };
}