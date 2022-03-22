
import { RequestHandler } from "express";
import SocketIO = require('socket.io');
import { IRoom, User } from "../Room";
import { IRoomRepository } from "../RoomRepository";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";
import { IGeneralSocketService } from "./GeneralSocketService";
import { ChatFileInfo, ChatMsgInfo, CloseConsumerInfo, ConnectWebRtcTransportInfo, UserReadyInfo, NewConsumerInfo, NewProducerInfo, NewWebRtcTransportInfo, UserInfo } from "nostromo-shared/types/RoomTypes";
import { HandshakeSession } from "./SocketManager";
import { MediasoupTypes } from "../MediasoupService";
import { IFileService } from "../FileService/FileService";
import { IUserBanRepository } from "../UserBanRepository";

type Socket = SocketIO.Socket;

export interface IRoomSocketService
{
    /** Выгнать пользователя userId из комнаты. */
    kickUser(userId: string): void;

    /** Заблокировать пользователя userId, находящегося в комнате, на сервере. */
    banUser(userId: string): Promise<void>;

    /** Выгнать всех пользователей из комнаты. */
    kickAllUsers(roomId: string): void;

    /** Сообщить клиенту пользователя, о том, что необходимо прекратить захват видеодорожки. */
    stopUserVideo(userId: string): void;

    /** Сообщить клиенту пользователя, о том, что необходимо прекратить захват аудиодорожки. */
    stopUserAudio(userId: string): void;

    /** Изменить имя пользователя. */
    changeUsername(info: UserInfo): void;
}

/** Обработчик событий комнаты. */
export class RoomSocketService implements IRoomSocketService
{
    private roomIo: SocketIO.Namespace;
    private roomRepository: IRoomRepository;
    private userBanRepository: IUserBanRepository;
    private generalSocketService: IGeneralSocketService;
    private fileService: IFileService;
    private latestMaxVideoBitrate = -1;

    constructor(
        roomIo: SocketIO.Namespace,
        generalSocketService: IGeneralSocketService,
        roomRepository: IRoomRepository,
        sessionMiddleware: RequestHandler,
        fileService: IFileService,
        userBanRepository: IUserBanRepository
    )
    {
        this.roomIo = roomIo;
        this.generalSocketService = generalSocketService;
        this.roomRepository = roomRepository;
        this.fileService = fileService;
        this.userBanRepository = userBanRepository;

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
            // у пользователя есть сессия
            if (session.auth)
            {
                // если он авторизован в запрашиваемой комнате
                if (session.joinedRoomId
                    && session.authRoomsId?.includes(session.joinedRoomId)
                    && session.joined == false)
                {
                    session.joined = true;
                    session.save();
                    return next();
                }
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
            const roomId: string = session.joinedRoomId!;

            const room = this.roomRepository.get(roomId);

            if (!room)
            {
                return;
            }

            await socket.join(room.id);
            this.clientJoined(socket, session, room);
        });
    }

    /** Пользователь заходит в комнату. */
    private clientJoined(
        socket: Socket,
        session: HandshakeSession,
        room: IRoom
    ): void
    {
        const userIp = socket.handshake.address.substring(7);
        console.log(`[Room] [#${room.id}, ${room.name}]: [ID: ${socket.id}, IP: ${userIp}] user joined.`);
        room.users.set(socket.id, new User(socket.id));

        const user: User = room.users.get(socket.id)!;

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
            await this.requestCreateWebRtcTransport(socket, room, user, consuming);
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
            await this.userReady(socket, room, user, info);
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
            this.userChangedName(socket, room.id, user, username);
        });

        // Новое сообщение в чате.
        socket.on(SE.ChatMsg, (msg: string) =>
        {
            this.userSentChatMsg(socket, room.id, user.name, msg);
        });

        // Новый файл в чате (ссылка на файл).
        socket.on(SE.ChatFile, (fileId: string) =>
        {
            this.userSentChatFile(socket, user.name, room.id, fileId);
        });

        // пользователь отсоединился
        socket.on(SE.Disconnect, (reason: string) =>
        {
            this.userDisconnected(socket, session, room, user.name, reason);
        });
    }

    /**
     * Запросить создание транспортного канала по запросу клиента.
     * @param consuming Канал для отдачи потоков от сервера клиенту?
     */
    private async requestCreateWebRtcTransport(
        socket: Socket,
        room: IRoom,
        user: User,
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
            console.error(`[Room] createWebRtcTransport for User ${user.id} error: `, (error as Error).message);
        }
    }

    /**
     * Запросить потоки других пользователей для нового пользователя.
     * Также оповестить всех о новом пользователе.
     */
    private async userReady(
        socket: Socket,
        room: IRoom,
        user: User,
        info: UserReadyInfo
    ): Promise<void>
    {
        const { name, rtpCapabilities } = info;

        const userIp = socket.handshake.address.substring(7);
        console.log(`[Room] [#${room.id}, ${room.name}]: [ID: ${socket.id}, IP: ${userIp}] user (${name}) ready to get consumers.`);

        // Запоминаем имя и RTP кодеки клиента.
        user.name = name;
        user.rtpCapabilities = rtpCapabilities;

        // Сообщаем заинтересованным новый список пользователей в комнате.
        this.generalSocketService.sendUserListToAllSubscribers(room.id);

        /** Запросить потоки пользователя producerUser для пользователя consumerUser. */
        const requestCreatingConsumers = async (producerUser: User) =>
        {
            for (const producer of producerUser.producers.values())
            {
                await this.requestCreateConsumer(socket, room, user, producerUser.id, producer);
            }
        };

        // Перебираем всех пользователей, кроме нового.
        for (const otherUser of room.users)
        {
            if (otherUser[0] != socket.id)
            {
                // Запросим потоки другого пользователя для этого нового пользователя.
                await requestCreatingConsumers(otherUser[1]);

                const otherUserInfo: UserInfo = {
                    id: otherUser[0],
                    name: otherUser[1].name
                };

                // Сообщаем новому пользователю о пользователе otherUser.
                socket.emit(SE.NewUser, otherUserInfo);

                const thisUserInfo: UserInfo = {
                    id: socket.id,
                    name: name
                };

                // Сообщаем другому пользователю о новом пользователе.
                this.roomIo.to(otherUser[0]).emit(SE.NewUser, thisUserInfo);
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
        consumerUser: User,
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
            console.error(`[Room] createConsumer error for User ${consumerUser.id} | `, (error as Error).message);
        }
    }

    /** Обработка событий у потока-потребителя. */
    private handleConsumerEvents(
        socket: Socket,
        room: IRoom,
        consumer: MediasoupTypes.Consumer,
        consumerUser: User,
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
        user: User,
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
            for (const otherUser of room.users)
            {
                if (otherUser[0] != socket.id)
                {
                    const otherUserSocket = this.getSocketById(otherUser[0])!;

                    await this.requestCreateConsumer(otherUserSocket, room, otherUser[1], socket.id, producer);
                }
            }

            socket.emit(SE.NewProducer, producer.id);
        }
        catch (error)
        {
            console.error(`[Room] createProducer error for User ${user.id} | `, (error as Error).message);
        }
    }

    /** Обработка событий у потока-производителя. */
    private handleProducerEvents(
        socket: Socket,
        room: IRoom,
        user: User,
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
    private getSocketById(id: string): Socket | undefined
    {
        return this.roomIo.sockets.get(id);
    }

    /** Пользователь изменил ник. */
    private userChangedName(
        socket: Socket,
        roomId: string,
        user: User,
        username: string
    ): void
    {
        user.name = username;

        const info: UserInfo = {
            id: socket.id,
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
        username: string,
        msg: string
    )
    {
        const chatMsgInfo: ChatMsgInfo = {
            name: username,
            msg: msg.trim()
        };
        socket.to(roomId).emit(SE.ChatMsg, chatMsgInfo);
    }

    /** Пользователь отправил ссылку на файл в чат. */
    private userSentChatFile(
        socket: Socket,
        username: string,
        roomId: string,
        fileId: string
    )
    {
        const fileInfo = this.fileService.getFileInfo(fileId);
        if (!fileInfo)
        {
            return;
        }

        const chatFileInfo: ChatFileInfo = { fileId, filename: fileInfo.name, size: fileInfo.size, username };

        socket.to(roomId).emit(SE.ChatFile, chatFileInfo);
    }

    /** Пользователь отключился. */
    private userDisconnected(
        socket: Socket,
        session: HandshakeSession,
        room: IRoom,
        username: string,
        reason: string
    )
    {
        session.joined = false;
        session.save();

        room.userDisconnected(socket.id);

        const userIp = socket.handshake.address.substring(7);

        console.log(`[Room] [#${room.id}, ${room.name}]: [ID: ${socket.id}, IP: ${userIp}] user (${username}) disconnected: ${reason}.`);

        // Сообщаем заинтересованным новый список пользователей в комнате.
        this.generalSocketService.sendUserListToAllSubscribers(room.id);

        // Сообщаем всем в комнате, что пользователь отключился.
        this.roomIo.to(room.id).emit(SE.UserDisconnected, socket.id);
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

    public kickUser(userId: string): void
    {
        const userSocket = this.getSocketById(userId);

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

        for (const user of room.users)
        {
            this.kickUser(user[0]);
        }
    }

    public stopUserVideo(userId: string): void
    {
        const userSocket = this.getSocketById(userId);

        if (userSocket)
        {
            userSocket.emit(SE.StopUserVideo);
        }
    }

    public stopUserAudio(userId: string): void
    {
        const userSocket = this.getSocketById(userId);

        if (userSocket)
        {
            userSocket.emit(SE.StopUserAudio);
        }
    }

    public changeUsername(info: UserInfo): void
    {
        const { id, name } = info;
        const userSocket = this.getSocketById(id);

        if (userSocket)
        {
            userSocket.emit(SE.ChangeUsername, name);
        }
    }

    public async banUser(userId: string): Promise<void>
    {
        const userSocket = this.getSocketById(userId);

        if (userSocket)
        {
            // Выясняем IP-адрес клиента.
            const ip = userSocket.handshake.address.substring(7);

            // Создаём запись о блокировке пользователя.
            await this.userBanRepository.create({ip});

            // Разрываем соединение веб-сокета с клиентом.
            userSocket.disconnect(true);
        }
    }
}