
import { RequestHandler } from "express";
import SocketIO = require('socket.io');
import { IRoom, ActiveUser } from "../Room";
import { IRoomRepository } from "../RoomRepository";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";
import { IGeneralSocketService } from "./GeneralSocketService";
import { ChatFileInfo, ChatMsgInfo, CloseConsumerInfo, ConnectWebRtcTransportInfo, UserReadyInfo, NewConsumerInfo, NewProducerInfo, NewWebRtcTransportInfo, UserInfo } from "nostromo-shared/types/RoomTypes";
import { MediasoupTypes } from "../MediasoupService";
import { IFileService } from "../FileService/FileService";
import { IUserBanRepository } from "../UserBanRepository";
import { IUserAccountRepository } from "../UserAccountRepository";
import { ActionOnUserInfo, ChangeUserNameInfo } from "nostromo-shared/types/AdminTypes";

type Socket = SocketIO.Socket;

export interface IRoomSocketService
{
    /** Выгнать пользователя userId из комнаты roomId. */
    kickUser(info: ActionOnUserInfo): void;

    /** Заблокировать пользователя userId, находящегося в комнате, на сервере. */
    banUser(info: ActionOnUserInfo): Promise<void>;

    /** Выгнать всех пользователей из комнаты. */
    kickAllUsers(roomId: string): void;

    /** Сообщить клиенту пользователя, о том, что необходимо прекратить захват видеодорожки. */
    stopUserVideo(info: ActionOnUserInfo): void;

    /** Сообщить клиенту пользователя, о том, что необходимо прекратить захват аудиодорожки. */
    stopUserAudio(info: ActionOnUserInfo): void;

    /** Изменить имя пользователя. */
    changeUsername(info: ChangeUserNameInfo): void;
}

/** Обработчик событий комнаты. */
export class RoomSocketService implements IRoomSocketService
{
    private roomIo: SocketIO.Namespace;
    private roomRepository: IRoomRepository;
    private userAccountRepository: IUserAccountRepository;
    private userBanRepository: IUserBanRepository;
    private generalSocketService: IGeneralSocketService;
    private fileService: IFileService;
    private latestMaxVideoBitrate = -1;

    constructor(
        roomIo: SocketIO.Namespace,
        generalSocketService: IGeneralSocketService,
        fileService: IFileService,
        roomRepository: IRoomRepository,
        userAccountRepository: IUserAccountRepository,
        userBanRepository: IUserBanRepository,
        sessionMiddleware: RequestHandler,
    )
    {
        this.roomIo = roomIo;
        this.generalSocketService = generalSocketService;
        this.roomRepository = roomRepository;
        this.userAccountRepository = userAccountRepository;
        this.userBanRepository = userBanRepository;
        this.fileService = fileService;

        this.applySessionMiddleware(sessionMiddleware);
        this.checkAuth();
        this.clientConnected();
    }

    /** Применяем middlware для сессий. */
    private applySessionMiddleware(sessionMiddleware: RequestHandler): void
    {
        this.roomIo.use((socket: Socket, next) =>
        {
            sessionMiddleware(socket.handshake, {}, next);
        });
    }

    /** Проверка авторизации в комнате. */
    private checkAuth(): void
    {
        this.roomIo.use((socket: Socket, next) =>
        {
            const session = socket.handshake.session!;

            const userId = session.userId;
            const roomId = session.joinedRoomId;

            // Если пользователь авторизован в запрашиваемой комнате
            if (userId && roomId && this.roomRepository.isAuthInRoom(roomId, userId))
            {
                return next();
            }
            return next(new Error("unauthorized"));
        });
    }

    /** Клиент подключился. */
    private clientConnected(): void
    {
        this.roomIo.on('connection', async (socket: Socket) =>
        {
            const session = socket.handshake.session!;
            const room = this.roomRepository.get(session.joinedRoomId!);
            const userId = session.userId!;

            if (!room)
            {
                return;
            }

            await socket.join(room.id);
            this.clientJoined(room, socket, userId);
        });
    }

    /** Пользователь заходит в комнату. */
    private clientJoined(
        room: IRoom,
        socket: Socket,
        userId: string
    ): void
    {
        const userIp = socket.handshake.address.substring(7);
        const username = this.userAccountRepository.getUsername(userId)!;

        console.log(`[Room] [${room.id}, ${room.name}]: [ID: ${userId}, IP: ${userIp}] user (${username}) joined.`);
        room.activeUsers.set(userId, new ActiveUser(userId, socket.id));

        const user: ActiveUser = room.activeUsers.get(userId)!;

        // Сообщаем пользователю название комнаты.
        socket.emit(SE.RoomName, room.name);

        // Сообщаем пользователю максимальный битрейт для аудиопотоков.
        socket.emit(SE.MaxAudioBitrate, room.maxAudioBitrate);

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
                this.emitMaxVideoBitrate(room.maxVideoBitrate);
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
                this.emitMaxVideoBitrate(room.maxVideoBitrate);
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
            this.emitMaxVideoBitrate(room.maxVideoBitrate);
        });

        // Клиент ставит producer на паузу (например, временно выключает микрофон).
        socket.on(SE.PauseProducer, async (producerId: string) =>
        {
            const paused = await room.userRequestedPauseProducer(user, producerId);

            if (paused)
            {
                // Поток был поставлен на паузу и соответственно был перерасчёт
                // максимального битрейта для видеопотоков.
                this.emitMaxVideoBitrate(room.maxVideoBitrate);
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
                this.emitMaxVideoBitrate(room.maxVideoBitrate);
            }
        });

        // Новый ник пользователя.
        socket.on(SE.NewUsername, (username: string) =>
        {
            this.userChangedName(room.id, socket, userId, username);
        });

        // Новое сообщение в чате.
        socket.on(SE.ChatMsg, (msg: string) =>
        {
            this.userSentChatMsg(socket, room.id, userId, msg);
        });

        // Новый файл в чате (ссылка на файл).
        socket.on(SE.ChatFile, (fileId: string) =>
        {
            this.userSentChatFile(socket, userId, room.id, fileId);
        });

        // пользователь отсоединился
        socket.on(SE.Disconnect, (reason: string) =>
        {
            this.userDisconnected(room, socket, userId, reason);
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
            console.error(`[Room] createWebRtcTransport for User ${user.userId} error: `, (error as Error).message);
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
        const username = this.userAccountRepository.getUsername(userId)!;

        console.log(`[Room] [${room.id}, ${room.name}]: [ID: ${userId}, IP: ${userIp}] user (${username}) ready to get consumers.`);

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

                const otherUserName = this.userAccountRepository.getUsername(otherUser[0])!;
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
            this.handleConsumerEvents(socket, room, consumer, consumerUser, producerUserId);

            // сообщаем клиенту всю информацию об этом потребителе
            const newConsumerInfo: NewConsumerInfo = {
                producerUserId,
                id: consumer.id,
                producerId: producer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters
            };

            socket.emit(SE.NewConsumer, newConsumerInfo);
        }
        catch (error)
        {
            console.error(`[Room] createConsumer error for User ${consumerUser.userId} | `, (error as Error).message);
        }
    }

    /** Обработка событий у потока-потребителя. */
    private handleConsumerEvents(
        socket: Socket,
        room: IRoom,
        consumer: MediasoupTypes.Consumer,
        consumerUser: ActiveUser,
        producerUserId: string
    ): void
    {
        /** Действия после автоматического закрытия consumer. */
        const consumerClosed = () =>
        {
            room.consumerClosed(consumer, consumerUser);

            // Поскольку поток был завершен,
            // возможно был перерасчёт максимального битрейта для видеопотоков.
            this.emitMaxVideoBitrate(room.maxVideoBitrate);

            const closeConsumerInfo: CloseConsumerInfo = {
                consumerId: consumer.id,
                producerUserId
            };

            socket.emit(SE.CloseConsumer, closeConsumerInfo);
        };

        /** Поставить на паузу consumer. */
        const pauseConsumer = async () =>
        {
            const paused = await room.pauseConsumer(consumer);

            if (paused)
            {
                // Поток был поставлен на паузу и соответственно был перерасчёт
                // максимального битрейта для видеопотоков.
                this.emitMaxVideoBitrate(room.maxVideoBitrate);
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
                this.emitMaxVideoBitrate(room.maxVideoBitrate);
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
            this.emitMaxVideoBitrate(room.maxVideoBitrate);

            // Обрабатываем события у Producer.
            this.handleProducerEvents(socket, room, user, producer);

            // Перебираем всех пользователей, кроме текущего
            // и создадим для них consumer.
            for (const otherUser of room.activeUsers)
            {
                if (otherUser[0] != user.userId)
                {
                    const otherUserSocket = this.getSocketBySocketId(otherUser[1].socketId)!;
                    await this.requestCreateConsumer(otherUserSocket, room, otherUser[1], user.userId, producer);
                }
            }

            socket.emit(SE.NewProducer, producer.id);
        }
        catch (error)
        {
            console.error(`[Room] createProducer error for User ${user.userId} | `, (error as Error).message);
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
            this.emitMaxVideoBitrate(room.maxVideoBitrate);

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
        const socketId = this.roomRepository.getActiveUserSocketId(roomId, userId);
        return this.getSocketBySocketId(socketId);
    }

    /** Пользователь изменил ник. */
    private userChangedName(
        roomId: string,
        socket: Socket,
        userId: string,
        username: string
    ): void
    {
        this.userAccountRepository.setUsername(userId, username);

        const info: UserInfo = {
            id: userId,
            name: username
        };

        socket.to(roomId).emit(SE.NewUsername, info);

        // Сообщаем заинтересованным новый список пользователей в комнате.
        this.generalSocketService.sendUserListToAllSubscribers(roomId);
    }

    /** Пользователь отправил сообщение в чат. */
    private userSentChatMsg(
        socket: Socket,
        roomId: string,
        userId: string,
        msg: string
    )
    {
        const chatMsgInfo: ChatMsgInfo = {
            userId,
            msg: msg.trim()
        };
        socket.to(roomId).emit(SE.ChatMsg, chatMsgInfo);
    }

    /** Пользователь отправил ссылку на файл в чат. */
    private userSentChatFile(
        socket: Socket,
        userId: string,
        roomId: string,
        fileId: string
    )
    {
        const fileInfo = this.fileService.getFileInfo(fileId);
        if (!fileInfo)
        {
            return;
        }

        const chatFileInfo: ChatFileInfo = { userId, fileId, filename: fileInfo.name, size: fileInfo.size };

        socket.to(roomId).emit(SE.ChatFile, chatFileInfo);
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
        const username = this.userAccountRepository.getUsername(userId)!;

        console.log(`[Room] [${room.id}, ${room.name}]: [ID: ${userId}, IP: ${userIp}] user (${username}) disconnected: ${reason}.`);

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

    public kickUser(info: ActionOnUserInfo): void
    {
        const { roomId, userId } = info;

        const userSocket = this.getSocketByUserId(roomId, userId);

        if (userSocket)
        {
            userSocket.emit(SE.Redirect, "main-page");
        }
    }

    public kickAllUsers(roomId: string): void
    {
        const room = this.roomRepository.get(roomId);

        if (!room)
        {
            return;
        }

        for (const user of room.activeUsers)
        {
            this.kickUser({ roomId, userId: user[0] });
        }
    }

    public stopUserVideo(info: ActionOnUserInfo): void
    {
        const { roomId, userId } = info;

        const userSocket = this.getSocketByUserId(roomId, userId);

        if (userSocket)
        {
            userSocket.emit(SE.StopUserVideo);
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
}