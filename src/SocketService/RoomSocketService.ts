
import SocketIO = require('socket.io');
import { IRoom, ActiveUser } from "../Room/Room";
import { IRoomRepository } from "../Room/RoomRepository";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";
import { IGeneralSocketService } from "./GeneralSocketService";
import { ChatFileInfo, ChatMessage, ConnectWebRtcTransportInfo, UserReadyInfo, NewConsumerInfo, NewProducerInfo, NewWebRtcTransportInfo, UserInfo } from "nostromo-shared/types/RoomTypes";
import { IMediasoupService, MediasoupTypes, ServerProducerAppData } from "../MediasoupService";
import { IUserBanRepository } from "../User/UserBanRepository";
import { IUserAccountRepository } from "../User/UserAccountRepository";
import { ActionOnUserInfo, ChangeUserNameInfo } from "nostromo-shared/types/AdminTypes";
import { IAuthRoomUserRepository } from "../User/AuthRoomUserRepository";
import { IFileRepository } from "../FileService/FileRepository";
import { TokenSocketMiddleware } from "../TokenService";
import { IRoomChatRepository } from "../Room/RoomChatRepository";

type Socket = SocketIO.Socket;

export interface IRoomSocketService
{
    /** Выгнать пользователя userId из комнаты roomId. */
    kickUser(info: ActionOnUserInfo): Promise<void>;

    /** Заблокировать пользователя userId, находящегося в комнате, на сервере. */
    banUser(info: ActionOnUserInfo): Promise<void>;

    /** Выгнать всех пользователей из комнаты. */
    kickAllUsers(roomId: string): Promise<void>;

    /** Сообщить клиенту пользователя, о том, что необходимо прекратить захват экрана. */
    stopUserDisplay(info: ActionOnUserInfo): void;

    /** Сообщить клиенту пользователя, о том, что необходимо прекратить захват видеоустройств. */
    stopUserCam(info: ActionOnUserInfo): void;

    /** Сообщить клиенту пользователя, о том, что необходимо прекратить захват аудиодорожки. */
    stopUserAudio(info: ActionOnUserInfo): void;

    /** Изменить имя пользователя. */
    changeUsername(info: ChangeUserNameInfo): void;

    /** Сообщить клиенту пользователя, о том, что он может выступать. */
    allowUserToSpeak(info: ActionOnUserInfo): void;

    /** Сообщить каждому пользователю, о том, что они могут выступать. */
    allowAllUsersToSpeak(roomId: string): void;

    /** Сообщить клиенту пользователя, о том, что ему нельзя выступать. */
    forbidUserToSpeak(info: ActionOnUserInfo): void;

    /** Сообщить каждому пользователю, о том, что им нельзя выступать. */
    forbidAllUsersToSpeak(roomId: string): void;
}

/** Обработчик событий комнаты. */
export class RoomSocketService implements IRoomSocketService
{
    private roomIo: SocketIO.Namespace;
    private roomRepository: IRoomRepository;
    private roomChatRepository: IRoomChatRepository;
    private userAccountRepository: IUserAccountRepository;
    private userBanRepository: IUserBanRepository;
    private authRoomUserRepository: IAuthRoomUserRepository;
    private generalSocketService: IGeneralSocketService;
    private fileRepository: IFileRepository;
    private mediasoupService: IMediasoupService;
    private latestMaxVideoBitrate;

    constructor(
        roomIo: SocketIO.Namespace,
        generalSocketService: IGeneralSocketService,
        tokenMiddleware: TokenSocketMiddleware,
        fileRepository: IFileRepository,
        mediasoupService: IMediasoupService,
        roomRepository: IRoomRepository,
        userAccountRepository: IUserAccountRepository,
        userBanRepository: IUserBanRepository,
        authRoomUserRepository: IAuthRoomUserRepository,
        roomChatRepository: IRoomChatRepository
    )
    {
        this.roomIo = roomIo;
        this.generalSocketService = generalSocketService;
        this.roomRepository = roomRepository;
        this.roomChatRepository = roomChatRepository;
        this.userAccountRepository = userAccountRepository;
        this.userBanRepository = userBanRepository;
        this.authRoomUserRepository = authRoomUserRepository;
        this.fileRepository = fileRepository;
        this.mediasoupService = mediasoupService;
        this.latestMaxVideoBitrate = this.mediasoupService.maxVideoBitrate;

        this.roomIo.use(tokenMiddleware);

        this.clientConnected();
    }

    /** Клиент подключился. */
    private clientConnected(): void
    {
        this.roomIo.on('connection', (socket: Socket) =>
        {
            const userId = socket.handshake.token.userId;

            socket.once(SE.JoinRoom, async (roomId: string) =>
            {
                const room = this.roomRepository.get(roomId);

                if (!room || !userId || !this.authRoomUserRepository.has(roomId, userId))
                {
                    return;
                }

                if (room.activeUsers.has(userId))
                {
                    socket.emit(SE.UserAlreadyJoined);
                    socket.once(SE.ForceJoinRoom, async () =>
                    {
                        await this.kickUser({ roomId: room.id, userId }, false);
                        await this.clientJoined(room, socket, userId);
                    });
                }
                else
                {
                    await this.clientJoined(room, socket, userId);
                }
            });
        });
    }

    /** Пользователь заходит в комнату. */
    private async clientJoined(
        room: IRoom,
        socket: Socket,
        userId: string
    ): Promise<void>
    {
        const userIp = socket.handshake.address.substring(7);
        const username = this.userAccountRepository.getUsername(userId) ?? "Гость";

        console.log(`[Room] [${room.id}, '${room.name}']: User [${userId}, ${userIp}, '${username}'] has joined.`);
        room.activeUsers.set(userId, new ActiveUser(room.id, userId, socket.id));

        const user: ActiveUser = room.activeUsers.get(userId)!;

        // Вступаем в socket.io комнату.
        await socket.join(room.id);

        // Сообщаем пользователю его идентификатор.
        socket.emit(SE.UserId, userId);

        // Сообщаем пользователю его имя.
        socket.emit(SE.Username, username);

        // Сообщаем пользователю название комнаты.
        socket.emit(SE.RoomName, room.name);

        // Сообщаем пользователю, разрешено ли ему выступать (в зависимости от режима конференции).
        if (room.symmetricMode)
        {
            socket.emit(SE.IsAllowedToSpeak, true);
        }
        else
        {
            socket.emit(SE.IsAllowedToSpeak, room.speakerUsers.has(userId));
        }

        // Сообщаем пользователю максимальный битрейт для аудиопотоков.
        socket.emit(SE.MaxAudioBitrate, this.mediasoupService.maxAudioBitrate);

        // Сообщаем пользователю текущий максимальный битрейт для видеопотоков.
        if (this.latestMaxVideoBitrate != -1)
        {
            socket.emit(SE.MaxVideoBitrate, this.latestMaxVideoBitrate);
        }

        // Сообщаем пользователю RTP возможности (кодеки) сервера.
        socket.emit(SE.RouterRtpCapabilities, room.routerRtpCapabilities);

        // Создание транспортного канала на сервере (с последующей отдачей информации о канале клиенту).
        socket.on(SE.CreateWebRtcTransport, async (consuming: boolean) =>
        {
            await this.requestCreateWebRtcTransport(room, socket, user, consuming);
        });

        // Подключение к транспортному каналу со стороны сервера.
        socket.on(SE.ConnectWebRtcTransport, async (info: ConnectWebRtcTransportInfo) =>
        {
            await room.connectWebRtcTransport(user, info);

            console.log(`[Room] [${room.id}, '${room.name}']: User [${userId}, ${userIp}, '${username}'] is trying to connect to transport.`);

            // Сообщим клиенту, что параметры info были приняты сервером.
            socket.emit(SE.ConnectWebRtcTransport);
        });

        // Пользователь уже создал транспортные каналы
        // и готов к получению потоков (готов к получению consumers).
        socket.once(SE.Ready, async (info: UserReadyInfo) =>
        {
            await this.userReady(room, socket, user, info);
        });

        // Клиент ставит consumer на паузу.
        socket.on(SE.PauseConsumer, async (consumerId: string) =>
        {
            const paused = await room.userRequestedPauseConsumer(user, consumerId);

            if (paused)
            {
                // Поток был поставлен на паузу и соответственно был перерасчёт
                // максимального битрейта для видеопотоков.
                this.emitMaxVideoBitrate(this.mediasoupService.maxVideoBitrate);
            }
        });

        // Клиент снимает consumer с паузы.
        socket.on(SE.ResumeConsumer, async (consumerId: string) =>
        {
            const resumed = await room.userRequestedResumeConsumer(user, consumerId);

            if (resumed)
            {
                // Поток был снят с паузы и соответственно был перерасчёт
                // максимального битрейта для видеопотоков.
                this.emitMaxVideoBitrate(this.mediasoupService.maxVideoBitrate);
            }
        });

        // Создание нового producer.
        socket.on(SE.NewProducer, async (newProducerInfo: NewProducerInfo) =>
        {
            await this.requestCreateProducer(socket, room, user, newProducerInfo);
        });

        // Клиент закрывает producer.
        socket.on(SE.CloseProducer, (producerId: string) =>
        {
            room.userRequestedCloseProducer(user, producerId);

            // Поскольку поток был завершен,
            // возможно был перерасчёт максимального битрейта для видеопотоков.
            this.emitMaxVideoBitrate(this.mediasoupService.maxVideoBitrate);
        });

        // Клиент ставит producer на паузу (например, временно выключает микрофон).
        socket.on(SE.PauseProducer, async (producerId: string) =>
        {
            const paused = await room.userRequestedPauseProducer(user, producerId);

            if (paused)
            {
                // Поток был поставлен на паузу и соответственно был перерасчёт
                // максимального битрейта для видеопотоков.
                this.emitMaxVideoBitrate(this.mediasoupService.maxVideoBitrate);
            }
        });

        // Клиент снимает producer с паузы (например, включает микрофон обратно).
        socket.on(SE.ResumeProducer, async (producerId: string) =>
        {
            const resumed = await room.userRequestedResumeProducer(user, producerId);

            if (resumed)
            {
                // Поток был снят с паузы и соответственно был перерасчёт
                // максимального битрейта для видеопотоков.
                this.emitMaxVideoBitrate(this.mediasoupService.maxVideoBitrate);
            }
        });

        // Новый ник пользователя.
        socket.on(SE.NewUsername, async (username: string) =>
        {
            await this.userChangedName(room.id, socket, userId, username);
        });

        // Пользователь отсоединился.
        socket.once(SE.Disconnect, (reason: string) =>
        {
            this.userDisconnected(room, socket, userId, reason);
        });

        // Отправим пользователю историю чата комнаты.
        await this.sendChatHistory(socket, room.id);

        // Новое сообщение в чате.
        socket.on(SE.ChatMsg, async (msg: string) =>
        {
            await this.userSentChatMsg(room.id, userId, msg);
        });

        // Новый файл в чате (ссылка на файл).
        socket.on(SE.ChatFile, async (fileId: string) =>
        {
            await this.userSentChatFile(userId, room.id, fileId);
        });
    }

    /**
     * Запросить создание транспортного канала по запросу клиента.
     * @param consuming Канал для отдачи потоков от сервера клиенту?
     */
    private async requestCreateWebRtcTransport(
        room: IRoom,
        socket: Socket,
        user: ActiveUser,
        consuming: boolean
    ): Promise<void>
    {
        try
        {
            const transport = await room.createWebRtcTransport(user, consuming);

            transport.on('routerclose', () =>
            {
                room.transportClosed(user, consuming);
                socket.emit(SE.CloseTransport, transport.id);
            });

            const transportInfo: NewWebRtcTransportInfo = {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates as NewWebRtcTransportInfo['iceCandidates'],
                dtlsParameters: transport.dtlsParameters
            };

            socket.emit(consuming ? SE.CreateConsumerTransport : SE.CreateProducerTransport, transportInfo);
        }
        catch (error)
        {
            console.error(`[ERROR] [RoomSocketService] createWebRtcTransport error for User [${user.userId}] in Room [${room.id}] |`, (error as Error));
        }
    }

    /**
     * Запросить потоки других пользователей для нового пользователя.
     * Также оповестить всех о новом пользователе.
     */
    private async userReady(
        room: IRoom,
        socket: Socket,
        user: ActiveUser,
        info: UserReadyInfo
    ): Promise<void>
    {
        const { rtpCapabilities } = info;

        const userIp = socket.handshake.address.substring(7);
        const userId = user.userId;
        const username = this.userAccountRepository.getUsername(userId) ?? "Гость";

        console.log(`[Room] [${room.id}, '${room.name}']: User [${userId}, ${userIp}, '${username}'] is ready to get consumers.`);

        // Запоминаем RTP кодеки клиента.
        user.rtpCapabilities = rtpCapabilities;

        // Сообщаем заинтересованным новый список пользователей в комнате.
        this.generalSocketService.sendUserListToAllSubscribers(room.id);

        /** Запросить потоки пользователя producerUser для пользователя consumerUser. */
        const requestCreatingConsumers = async (producerUser: ActiveUser) =>
        {
            for (const producer of producerUser.producers.values())
            {
                await this.requestCreateConsumer(socket, room, user, producerUser.userId, producer);
            }
        };

        // Информация об этом новом пользователе.
        const thisUserInfo: UserInfo = {
            id: userId,
            name: username
        };

        // Перебираем всех пользователей, кроме нового.
        for (const otherUser of room.activeUsers)
        {
            if (otherUser[0] != userId)
            {
                // Запросим потоки другого пользователя для этого нового пользователя.
                await requestCreatingConsumers(otherUser[1]);

                const otherUserName = this.userAccountRepository.getUsername(otherUser[0]) ?? "Гость";
                const otherUserInfo: UserInfo = { id: otherUser[0], name: otherUserName };

                // Сообщаем новому пользователю о пользователе otherUser.
                socket.emit(SE.NewUser, otherUserInfo);

                // Сообщаем другому пользователю о новом пользователе.
                this.roomIo.to(otherUser[1].socketId).emit(SE.NewUser, thisUserInfo);
            }
        }
    }

    /**
     * Запросить создание потока-потребителя для пользователя consumerUser
     * из потока-производителя пользователя producerUserId.
     */
    private async requestCreateConsumer(
        socket: Socket,
        room: IRoom,
        consumerUser: ActiveUser,
        producerUserId: string,
        producer: MediasoupTypes.Producer
    ): Promise<void>
    {
        try
        {
            const consumer = await room.createConsumer(consumerUser, producer);

            // Обрабатываем события у Consumer.
            this.handleConsumerEvents(socket, room, consumer, consumerUser);

            const streamId = (producer.appData as ServerProducerAppData).streamId;

            // Сообщаем клиенту всю информацию об этом потребителе.
            const newConsumerInfo: NewConsumerInfo = {
                id: consumer.id,
                producerId: producer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
                producerUserId,
                streamId
            };

            socket.emit(SE.NewConsumer, newConsumerInfo);
        }
        catch (error)
        {
            console.error(`[ERROR] [RoomSocketService] createConsumer error for User [${consumerUser.userId}] in Room [${room.id}] |`, (error as Error));
        }
    }

    /** Обработка событий у потока-потребителя. */
    private handleConsumerEvents(
        socket: Socket,
        room: IRoom,
        consumer: MediasoupTypes.Consumer,
        consumerUser: ActiveUser
    ): void
    {
        /** Действия после автоматического закрытия consumer. */
        const consumerClosed = () =>
        {
            room.consumerClosed(consumer, consumerUser);

            // Поскольку поток был завершен,
            // возможно был перерасчёт максимального битрейта для видеопотоков.
            this.emitMaxVideoBitrate(this.mediasoupService.maxVideoBitrate);

            socket.emit(SE.CloseConsumer, consumer.id);
        };

        /** Поставить на паузу consumer. */
        const pauseConsumer = async () =>
        {
            const paused = await room.pauseConsumer(consumer);

            if (paused)
            {
                // Поток был поставлен на паузу и соответственно был перерасчёт
                // максимального битрейта для видеопотоков.
                this.emitMaxVideoBitrate(this.mediasoupService.maxVideoBitrate);
            }

            // Сообщаем клиенту, чтобы он тоже поставил на паузу, если только это не он попросил.
            // То есть сообщаем клиенту, что сервер поставил или хотел поставить на паузу. Хотел в том случае,
            // если до этого клиент уже поставил на паузу, а после соответствующий producer был поставлен на паузу.
            // Это необходимо, чтобы клиент знал при попытке снять с паузы, что сервер НЕ ГОТОВ снимать с паузы consumer.
            socket.emit(SE.PauseConsumer, consumer.id);
        };

        /** Снять consumer c паузы. */
        const resumeConsumer = async () =>
        {
            const resumed = await room.resumeConsumer(consumer);

            if (resumed)
            {
                // Поток был снят с паузы и соответственно был перерасчёт
                // максимального битрейта для видеопотоков.
                this.emitMaxVideoBitrate(this.mediasoupService.maxVideoBitrate);
            }

            // Сообщаем клиенту, чтобы он тоже снял с паузы, если только это не он попросил.
            // То есть сообщаем клиенту, что сервер снял или хотел снять паузу.
            // Это необходимо, чтобы клиент знал при попытке снять с паузы, что сервер ГОТОВ снимать с паузы consumer.
            socket.emit(SE.ResumeConsumer, consumer.id);
        };

        consumer.on('transportclose', consumerClosed);
        consumer.on('producerclose', consumerClosed);
        consumer.on('producerpause', async () => { await pauseConsumer(); });
        consumer.on('producerresume', async () => { await resumeConsumer(); });
    }

    /**
     * Запросить создание потока-производителя для пользователя user.
     */
    private async requestCreateProducer(
        socket: Socket,
        room: IRoom,
        user: ActiveUser,
        newProducerInfo: NewProducerInfo
    ): Promise<void>
    {
        try
        {
            const producer = await room.createProducer(user, newProducerInfo);

            // Был создан новый поток-производитель,
            // следовательно был перерасчёт максимального битрейта для видеопотоков.
            this.emitMaxVideoBitrate(this.mediasoupService.maxVideoBitrate);

            // Обрабатываем события у Producer.
            this.handleProducerEvents(socket, room, user, producer);

            // Перебираем всех пользователей, кроме текущего и создаём для них consumer.
            for (const otherUser of room.activeUsers)
            {
                if (otherUser[0] != user.userId)
                {
                    const otherUserSocket = this.getSocketBySocketId(otherUser[1].socketId);

                    if (!otherUserSocket)
                    {
                        console.error(`[ERROR] [RoomSocketService] Can't get socket by Id [${otherUser[1].socketId}] for User [${otherUser[1].userId}] in Room [${room.id}].`);
                        return;
                    }

                    await this.requestCreateConsumer(otherUserSocket, room, otherUser[1], user.userId, producer);
                }
            }

            socket.emit(SE.NewProducer, producer.id);
        }
        catch (error)
        {
            console.error(`[ERROR] [RoomSocketService] createProducer error for User [${user.userId}] in Room [${room.id}] |`, (error as Error));
        }
    }

    /** Обработка событий у потока-производителя. */
    private handleProducerEvents(
        socket: Socket,
        room: IRoom,
        user: ActiveUser,
        producer: MediasoupTypes.Producer
    ): void
    {
        /** Действия после автоматического закрытия producer. */
        const producerClosed = () =>
        {
            room.producerClosed(producer, user);

            // Поскольку поток был завершен,
            // возможно был перерасчёт максимального битрейта для видеопотоков.
            this.emitMaxVideoBitrate(this.mediasoupService.maxVideoBitrate);

            socket.emit(SE.CloseProducer, producer.id);
        };

        producer.on('transportclose', producerClosed);
    }

    /** Получить веб-сокет соединение по Id. */
    private getSocketBySocketId(id: string): Socket | undefined
    {
        return this.roomIo.sockets.get(id);
    }

    /** Получить веб-сокет соединение по userId. */
    private getSocketByUserId(roomId: string, userId: string): Socket | undefined
    {
        try
        {
            const socketId = this.roomRepository.getActiveUserSocketId(roomId, userId);
            return this.getSocketBySocketId(socketId);
        }
        catch (error)
        {
            console.error(`[ERROR] [RoomSocketService] getActiveUserSocketId error in Room [${roomId}] for User [${userId}] |`, (error as Error));
            return undefined;
        }
    }

    /** Пользователь изменил ник. */
    private async userChangedName(
        roomId: string,
        socket: Socket,
        userId: string,
        username: string
    ): Promise<void>
    {
        if (username.length > 32)
        {
            username = username.slice(0, 32);
        }

        await this.userAccountRepository.setUsername(userId, username);

        const info: UserInfo = {
            id: userId,
            name: username
        };

        socket.to(roomId).emit(SE.NewUsername, info);

        // Сообщаем заинтересованным новый список пользователей в комнате.
        this.generalSocketService.sendUserListToAllSubscribers(roomId);
    }

    /** Пользователь отправил сообщение в чат. */
    private async userSentChatMsg(
        roomId: string,
        userId: string,
        msg: string
    ): Promise<void>
    {
        const chatMessage: ChatMessage = {
            type: "text",
            userId,
            datetime: Date.now(),
            content: msg.trim()
        };

        // Сохраним сообщение на сервере.
        if (this.roomRepository.getSaveChatPolicy(roomId))
        {
            await this.roomChatRepository.addMessage(roomId, chatMessage);
        }

        this.roomIo.to(roomId).emit(SE.ChatMsg, chatMessage);
    }

    /** Пользователь отправил ссылку на файл в чат. */
    private async userSentChatFile(
        userId: string,
        roomId: string,
        fileId: string
    ): Promise<void>
    {
        const fileInfo = this.fileRepository.get(fileId);
        if (!fileInfo)
        {
            return;
        }

        const chatFileInfo: ChatFileInfo = {
            fileId,
            name: fileInfo.name,
            size: fileInfo.size
        };

        const chatMessage: ChatMessage = {
            type: "file",
            userId,
            datetime: Date.now(),
            content: chatFileInfo
        };

        // Сохраним сообщение на сервере.
        if (this.roomRepository.getSaveChatPolicy(roomId))
        {
            await this.roomChatRepository.addMessage(roomId, chatMessage);
        }

        this.roomIo.to(roomId).emit(SE.ChatFile, chatMessage);
    }

    /** Пользователь отключился. */
    private userDisconnected(
        room: IRoom,
        socket: Socket,
        userId: string,
        reason: string
    )
    {
        room.userDisconnected(userId);

        const userIp = socket.handshake.address.substring(7);
        const username = this.userAccountRepository.getUsername(userId) ?? "Гость";

        console.log(`[Room] [${room.id}, '${room.name}']: User [${userId}, ${userIp}, '${username}'] has disconnected: ${reason}.`);

        // Сообщаем заинтересованным новый список пользователей в комнате.
        this.generalSocketService.sendUserListToAllSubscribers(room.id);

        // Сообщаем всем в комнате, что пользователь отключился.
        this.roomIo.to(room.id).emit(SE.UserDisconnected, userId);
    }

    /** Разослать клиентам во всех комнатах новое значение максимального битрейта для видеопотоков. */
    private emitMaxVideoBitrate(newMaxVideoBitrate: number)
    {
        if (newMaxVideoBitrate != -1
            && newMaxVideoBitrate != this.latestMaxVideoBitrate)
        {
            this.roomIo.emit(SE.NewMaxVideoBitrate, newMaxVideoBitrate);
            this.latestMaxVideoBitrate = newMaxVideoBitrate;
        }
    }

    public async kickUser(info: ActionOnUserInfo, deauthorize = true): Promise<void>
    {
        const { roomId, userId } = info;

        const userSocket = this.getSocketByUserId(roomId, userId);

        if (userSocket)
        {
            userSocket.disconnect(true);
        }

        if (deauthorize)
        {
            await this.authRoomUserRepository.remove(info.roomId, info.userId);
        }
    }

    public async kickAllUsers(roomId: string): Promise<void>
    {
        const room = this.roomRepository.get(roomId);

        if (!room)
        {
            return;
        }

        for (const user of room.activeUsers)
        {
            await this.kickUser({ roomId, userId: user[0] });
        }
    }

    public stopUserDisplay(info: ActionOnUserInfo): void
    {
        const { roomId, userId } = info;

        const userSocket = this.getSocketByUserId(roomId, userId);

        if (userSocket)
        {
            userSocket.emit(SE.StopUserDisplay);
        }
    }

    public stopUserCam(info: ActionOnUserInfo): void
    {
        const { roomId, userId } = info;

        const userSocket = this.getSocketByUserId(roomId, userId);

        if (userSocket)
        {
            userSocket.emit(SE.StopUserCam);
        }
    }

    public stopUserAudio(info: ActionOnUserInfo): void
    {
        const { roomId, userId } = info;

        const userSocket = this.getSocketByUserId(roomId, userId);

        if (userSocket)
        {
            userSocket.emit(SE.StopUserAudio);
        }
    }

    public allowUserToSpeak(info: ActionOnUserInfo): void
    {
        const { roomId, userId } = info;

        const userSocket = this.getSocketByUserId(roomId, userId);

        this.roomRepository.addUserToSpeakerUsersList(roomId, userId);

        if (userSocket)
        {
            userSocket.emit(SE.IsAllowedToSpeak, true);
        }
    }

    public allowAllUsersToSpeak(roomId: string): void
    {
        const room = this.roomRepository.get(roomId);

        if (!room)
        {
            return;
        }

        for (const user of room.activeUsers)
        {
            this.allowUserToSpeak({ roomId, userId: user[0] });
        }
    }

    public forbidUserToSpeak(info: ActionOnUserInfo): void
    {
        const { roomId, userId } = info;

        const userSocket = this.getSocketByUserId(roomId, userId);

        this.roomRepository.removeUserFromSpeakerUsersList(roomId, userId);

        if (userSocket)
        {
            userSocket.emit(SE.IsAllowedToSpeak, false);
        }
    }

    public forbidAllUsersToSpeak(roomId: string): void
    {
        const room = this.roomRepository.get(roomId);

        if (!room)
        {
            return;
        }

        for (const user of room.activeUsers)
        {
            this.forbidUserToSpeak({ roomId, userId: user[0] });
        }
    }

    //TODO: когда изменение ника перенесется в настройки, параметр roomId будет не нужен.
    public changeUsername(info: ChangeUserNameInfo): void
    {
        const { roomId, userId, username } = info;

        const userSocket = this.getSocketByUserId(roomId, userId);

        if (userSocket)
        {
            userSocket.emit(SE.ChangeUsername, username);
        }
    }

    public async banUser(info: ActionOnUserInfo): Promise<void>
    {
        const { roomId, userId } = info;

        const userSocket = this.getSocketByUserId(roomId, userId);

        if (userSocket)
        {
            // Выясняем IP-адрес клиента.
            const ip = userSocket.handshake.address.substring(7);

            // Создаём запись о блокировке пользователя.
            await this.userBanRepository.create({ ip });

            // Разрываем соединение веб-сокета с клиентом.
            userSocket.disconnect(true);
        }
    }

    /** Отправляем пользователю историю чата. */
    private async sendChatHistory(
        socket: Socket,
        roomId: string
    ): Promise<void>
    {
        if (!this.roomChatRepository.has(roomId))
        {
            return;
        }

        const messageArr = await this.roomChatRepository.getAll(roomId);
        if (messageArr)
        {
            const usersInChatHistory = new Set<string>();

            for (const message of messageArr)
            {
                let username = undefined;
                if (!usersInChatHistory.has(message.userId))
                {
                    username = this.userAccountRepository.getUsername(message.userId);
                    usersInChatHistory.add(message.userId);
                }

                const socketEvent = message.type == "text" ? SE.ChatMsg : SE.ChatFile;

                socket.emit(socketEvent, message, username);
            }
        }
    }
}