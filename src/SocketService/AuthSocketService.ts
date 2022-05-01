
import { RequestHandler } from "express";
import SocketIO = require('socket.io');
import { IRoomRepository } from "../Room/RoomRepository";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";
import { IUserAccountRepository } from "../User/UserAccountRepository";
import { IAuthRoomUserRepository } from "../User/AuthRoomUserRepository";

type Socket = SocketIO.Socket;

// TODO: реализовать авторизацию в комнату и учетку (включая админскую)
// в этом месте, а из AdminSocketService авторизацию убрать
// т.е AdminSocketService должен юзать этот сервис

export class AuthSocketService
{
    private authIo: SocketIO.Namespace;
    private roomRepository: IRoomRepository;
    private userAccountRepository: IUserAccountRepository;
    private authRoomUserRepository: IAuthRoomUserRepository;

    constructor(
        authIo: SocketIO.Namespace,
        roomRepository: IRoomRepository,
        userAccountRepository: IUserAccountRepository,
        authRoomUserRepository: IAuthRoomUserRepository
    )
    {
        this.authIo = authIo;
        this.roomRepository = roomRepository;
        this.userAccountRepository = userAccountRepository;
        this.authRoomUserRepository = authRoomUserRepository;

        this.clientConnected();
    }

    /** Клиент подключился. */
    private clientConnected()
    {
        this.authIo.on('connection', (socket: Socket) =>
        {
            const token = socket.handshake.token;

            const roomId = "test";

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
                    let userId = token.userId;

                    // Если у пользователя не было сессии.
                    if (!userId)
                    {
                        userId = this.userAccountRepository.create({ role: "user" });
                        token.userId = userId;
                    }
                    // Запоминаем для этого пользователя авторизованную комнату.
                    this.authRoomUserRepository.create(roomId, userId);

                    result = true;
                }
                socket.emit(SE.Result, result);
            });
        });
    }
}