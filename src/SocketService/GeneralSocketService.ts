import SocketIO = require('socket.io');
import { RoomNameInfo } from "nostromo-shared/types/AdminTypes";
import { PublicRoomInfo, UserInfo } from "nostromo-shared/types/RoomTypes";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";

import { IRoomRepository } from "../Room/RoomRepository";
import { TokenSocketMiddleware } from "../TokenService";
import { IUserAccountRepository } from "../User/UserAccountRepository";
type Socket = SocketIO.Socket;

export interface IGeneralSocketService
{
    /** Change name by admin action. */
    changeUsername(info: UserInfo): Promise<void>;

    /** Оповестить на главной странице об удаленной комнате. */
    notifyAboutDeletedRoom(id: string): void;

    /** Оповестить на главной странице о созданной комнате. */
    notifyAboutCreatedRoom(info: PublicRoomInfo): void;

    /** Оповестить на главной странице о новом названии комнаты. */
    notifyAboutChangedRoomName(info: RoomNameInfo): void;

    /** Отправить новый список пользователей комнаты roomId всем подписчикам. */
    sendUserListToAllSubscribers(roomId: string): void;

    /** Отправить список пользователей комнаты roomId подписчику subscriberId. */
    sendUserListToSubscriber(subscriberId: string, roomId: string): void;

    /** Отписать всех подписчиков комнаты от получения списка пользователей этой комнаты. */
    unsubscribeAllUserListSubscribers(roomId: string): void;
}

export class GeneralSocketService implements IGeneralSocketService
{
    private generalIo: SocketIO.Namespace;
    private roomRepository: IRoomRepository;
    private userAccountRepository: IUserAccountRepository;

    constructor(
        generalIo: SocketIO.Namespace,
        tokenMiddleware: TokenSocketMiddleware,
        roomRepository: IRoomRepository,
        userAccountRepository: IUserAccountRepository
    )
    {
        this.generalIo = generalIo;
        this.roomRepository = roomRepository;
        this.userAccountRepository = userAccountRepository;

        this.generalIo.use(tokenMiddleware);

        this.clientConnected();
    }

    private clientConnected()
    {
        this.generalIo.on('connection', (socket: Socket) =>
        {
            const userId = socket.handshake.token.userId;

            socket.on(SE.RoomList, () =>
            {
                socket.emit(SE.RoomList, this.roomRepository.getRoomLinkList());
            });

            socket.on(SE.SubscribeUserList, async (roomId: string) =>
            {
                await this.subscribeUserList(socket, roomId);
            });

            socket.on(SE.UnsubscribeUserList, async (roomId: string) =>
            {
                await this.unsubscribeUserList(socket, roomId);
            });

            socket.on(SE.NewUsername, async (username: string) =>
            {
                if (!userId)
                {
                    return;
                }

                const userInfo: UserInfo = { id: userId, name: username };
                await this.changeUsername(userInfo);
            });
        });
    }

    private async subscribeUserList(socket: Socket, roomId: string): Promise<void>
    {
        // Если такой комнаты вообще нет.
        if (!this.roomRepository.has(roomId))
        {
            return;
        }

        // подписываемся на получение списка юзеров в комнате roomId
        await socket.join(`${SE.UserList}-${roomId}`);

        // отправляем список пользователей этой комнаты
        // TODO: не отправлять список, если он в этой комнате не авторизован
        this.sendUserListToSubscriber(socket.id, roomId);
    }
    private async unsubscribeUserList(socket: Socket, roomId: string): Promise<void>
    {
        // Если такой комнаты вообще нет.
        if (!this.roomRepository.has(roomId))
        {
            return;
        }

        // отписываемся от получения списка юзеров в комнате roomId
        await socket.leave(`${SE.UserList}-${roomId}`);
    }

    public async changeUsername(
        userInfo: UserInfo
    ): Promise<void>
    {
        const userId = userInfo.id;
        let username = userInfo.name;

        if (username.length > 32)
        {
            username = username.slice(0, 32);
        }

        const oldName = this.userAccountRepository.getUsername(userId);
        if (username === oldName)
        {
            return;
        }

        await this.userAccountRepository.setUsername(userId, username);

        const newInfo: UserInfo = {
            id: userId,
            name: username
        };

        // TODO: send new name only to rooms,
        // where this user was before (or is active right now)?
        this.generalIo.emit(SE.NewUsername, newInfo);
    }

    public notifyAboutCreatedRoom(info: PublicRoomInfo): void
    {
        this.generalIo.emit(SE.RoomCreated, info);
    }

    public notifyAboutChangedRoomName(info: RoomNameInfo): void
    {
        this.generalIo.emit(SE.RoomNameChanged, info);
    }

    public notifyAboutDeletedRoom(id: string): void
    {
        this.generalIo.emit(SE.RoomDeleted, id);
    }

    public sendUserListToAllSubscribers(roomId: string): void
    {
        try
        {
            const userList = this.roomRepository.getActiveUserList(roomId);
            this.generalIo.to(`${SE.UserList}-${roomId}`).emit(SE.UserList, userList);
        }
        catch (error)
        {
            console.error(`[ERROR] [GeneralSocketService] getActiveUserList error in Room [${roomId}] |`, (error as Error));
        }
    }

    public sendUserListToSubscriber(subscriberId: string, roomId: string): void
    {
        try
        {
            const userList = this.roomRepository.getActiveUserList(roomId);
            this.generalIo.to(subscriberId).emit(SE.UserList, userList);
        }
        catch (error)
        {
            console.error(`[ERROR] [GeneralSocketService] getActiveUserList error in Room [${roomId}] |`, (error as Error));
        }
    }

    public unsubscribeAllUserListSubscribers(roomId: string): void
    {
        this.generalIo.socketsLeave(`${SE.UserList}-${roomId}`);
    }
}