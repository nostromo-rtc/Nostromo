import SocketIO = require('socket.io');
import { RoomLinkInfo } from "nostromo-shared/types/AdminTypes";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";
import { IRoomRepository } from "../RoomRepository";
type Socket = SocketIO.Socket;

export interface IGeneralSocketService
{
    /** Оповестить на главной странице об удаленной комнате. */
    notifyAboutDeletedRoom(id: string): void;

    /** Оповестить на главной странице о созданной комнате. */
    notifyAboutCreatedRoom(info: RoomLinkInfo): void;

    /** Отправить новый список пользователей комнаты roomId всем подписчикам. */
    sendUserListToAllSubscribers(roomId: string): void;

    /** Отправить список пользователей комнаты roomId подписчику subscriberId. */
    sendUserListToSubscriber(subscriberId: string, roomId: string): void;
}

export class GeneralSocketService implements IGeneralSocketService
{
    private generalIo: SocketIO.Namespace;
    private roomRepository: IRoomRepository;

    constructor(
        generalIo: SocketIO.Namespace,
        roomRepository: IRoomRepository
    )
    {
        this.generalIo = generalIo;
        this.roomRepository = roomRepository;

        this.clientConnected();
    }

    private clientConnected()
    {
        this.generalIo.on('connection', (socket: Socket) =>
        {
            // Как только клиент подключился, отправляем ему список комнат.
            socket.emit(SE.RoomList, this.roomRepository.getRoomLinkList());

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

    public notifyAboutCreatedRoom(info: RoomLinkInfo): void
    {
        this.generalIo.emit(SE.RoomCreated as string, info);
    }

    public notifyAboutDeletedRoom(id: string): void
    {
        this.generalIo.emit(SE.RoomDeleted as string, id);
    }

    public sendUserListToAllSubscribers(roomId: string): void
    {
        const userList = this.roomRepository.getUserList(roomId);
        this.generalIo.to(`${SE.UserList}-${roomId}`).emit(SE.UserList, userList);
    }

    public sendUserListToSubscriber(subscriberId: string, roomId: string): void
    {
        const userList = this.roomRepository.getUserList(roomId);
        this.generalIo.to(subscriberId).emit(SE.UserList, userList);
    }
}