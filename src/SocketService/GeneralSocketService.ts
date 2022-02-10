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
}