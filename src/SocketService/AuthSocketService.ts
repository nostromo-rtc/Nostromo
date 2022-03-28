
import { RequestHandler } from "express";
import SocketIO = require('socket.io');
import { IRoomRepository } from "../RoomRepository";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";

type Socket = SocketIO.Socket;

// TODO: реализовать авторизацию в комнату и учетку (включая админскую)
// в этом месте, а из AdminSocketService авторизацию убрать
// т.е AdminSocketService должен юзать этот сервис

export class AuthSocketService
{
    private authIo: SocketIO.Namespace;
    private roomRepository: IRoomRepository;
    constructor(
        authIo: SocketIO.Namespace,
        roomRepository: IRoomRepository,
        sessionMiddleware: RequestHandler
    )
    {
        this.authIo = authIo;
        this.roomRepository = roomRepository;

        this.applySessionMiddleware(sessionMiddleware);
        this.clientConnected();
    }

    /** Применяем middlware для сессий. */
    private applySessionMiddleware(sessionMiddleware: RequestHandler)
    {
        this.authIo.use((socket: Socket, next) =>
        {
            sessionMiddleware(socket.handshake, {}, next);
        });
    }

    /** Клиент подключился. */
    private clientConnected()
    {
        this.authIo.on('connection', (socket: Socket) =>
        {
            const session = socket.handshake.session!;
            const roomId: string | undefined = session.joinedRoomId;

            // если в сессии нет номера комнаты, или такой комнаты не существует
            if (!roomId || !this.roomRepository.has(roomId))
            {
                return;
            }

            const room = this.roomRepository.get(roomId)!;

            socket.emit(SE.RoomName, room.name);

            socket.on(SE.JoinRoom, async (pass: string) =>
            {
                let result = false;
                const authResult = await this.roomRepository.checkPassword(room.id, pass);

                if (authResult)
                {
                    // если у пользователя не было сессии
                    if (!session.auth)
                    {
                        session.auth = true;
                        session.authRoomsId = new Array<string>();
                    }
                    // запоминаем для этого пользователя авторизованную комнату
                    session.authRoomsId!.push(roomId);
                    session.save();

                    result = true;
                }
                socket.emit(SE.Result, result);
            });
        });
    }
}