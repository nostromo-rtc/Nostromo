
import { RequestHandler } from "express";
import SocketIO = require('socket.io');
import { Room, User } from "../Room";
import { IRoomRepository } from "../RoomRepository";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";
import { IAdminSocketService } from "./AdminSocketService";
import { CloseConsumerInfo, ConnectWebRtcTransportInfo, JoinInfo, NewConsumerInfo, NewProducerInfo, NewWebRtcTransportInfo, UserInfo } from "nostromo-shared/types/RoomTypes";
import { HandshakeSession } from "./SocketManager";
import { MediasoupTypes } from "../MediasoupService";

type Socket = SocketIO.Socket;

/** Обработчик событий комнаты. */
export class RoomSocketService
{
    private roomIo: SocketIO.Namespace;
    private roomRepository: IRoomRepository;
    private adminSocketService: IAdminSocketService;
    constructor(
        roomIo: SocketIO.Namespace,
        adminSocketService: IAdminSocketService,
        roomRepository: IRoomRepository,
        sessionMiddleware: RequestHandler
    )
    {
        this.roomIo = roomIo;
        this.adminSocketService = adminSocketService;
        this.roomRepository = roomRepository;

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
        room: Room
    ): void
    {
        console.log(`[Room] [#${room.id}, ${room.name}]: ${socket.id} (${session.username ?? "Гость"}) user connected`);
        room.users.set(socket.id, new User(socket.id));

        const user: User = room.users.get(socket.id)!;

        // Сообщаем заинтересованным новый список пользователей в комнате.
        this.adminSocketService.sendUserListToAllSubscribers(room.id);

        // Сообщаем пользователю название комнаты.
        socket.emit(SE.RoomName, room.name);

        // Сообщаем пользователю максимальный битрейт аудио в комнате.
        socket.emit(SE.MaxAudioBitrate, room.maxAudioBitrate);

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
        socket.once(SE.Ready, async (joinInfo: JoinInfo) =>
        {
            await this.userReady(socket, room, user, session, joinInfo);
        });

        // Клиент ставит consumer на паузу.
        socket.on(SE.PauseConsumer, async (consumerId: string) =>
        {
            await room.userRequestedPauseConsumer(user, consumerId);
        });

        // клиент снимает consumer с паузы
        socket.on(SE.ResumeConsumer, async (consumerId: string) =>
        {
            await room.userRequestedResumeConsumer(user, consumerId);
        });
        // создание нового producer
        socket.on(SE.NewProducer, async (newProducerInfo: NewProducerInfo) =>
        {
            await this.createProducer(user, socket, newProducerInfo);
        });

        // клиент закрывает producer
        socket.on('closeProducer', (producerId: string) =>
        {
            const producer = user.producers.get(producerId);

            if (!producer)
                throw new Error(`[Room] producer with id "${producerId}" not found`);

            producer.close();

            this.closeProducer(user, producer);
        });

        // клиент ставит producer на паузу (например, временно выключает микрофон)
        socket.on('pauseProducer', async (producerId: string) =>
        {
            const producer = user.producers.get(producerId);

            if (!producer)
                throw new Error(`[Room] producer with id "${producerId}" not found`);

            await this.pauseProducer(producer);
        });

        // клиент снимает producer с паузы (например, включает микрофон обратно)
        socket.on('resumeProducer', async (producerId: string) =>
        {
            const producer = user.producers.get(producerId);

            if (!producer)
                throw new Error(`[Room] producer with id "${producerId}" not found`);

            await this.resumeProducer(producer);
        });

        // новый ник пользователя
        socket.on('newUsername', (username: string) =>
        {
            this.joinEvNewUsername(socket, session, username);
        });

        socket.on('chatMsg', (msg: string) =>
        {
            const chatMsgInfo: ChatMsgInfo = {
                name: socket.handshake.session!.username!,
                msg: msg.trim()
            };
            socket.to(this.id).emit('chatMsg', chatMsgInfo);
        });

        socket.on('chatFile', (fileId: string) =>
        {
            const fileInfo = this.fileService.getFileInfo(fileId);
            if (!fileInfo) return;

            const username = socket.handshake.session!.username!;

            const chatFileInfo: ChatFileInfo = { fileId, filename: fileInfo.name, size: fileInfo.size, username };

            socket.to(this.id).emit('chatFile', chatFileInfo);
        });

        // пользователь отсоединился
        socket.on('disconnect', (reason: string) =>
        {
            this.joinEvDisconnect(socket, session, reason);
        });
    }

    /**
     * Запросить создание транспортного канала по запросу клиента.
     * @param consuming Канал для отдачи потоков от сервера клиенту?
     */
    private async requestCreateWebRtcTransport(
        socket: Socket,
        room: Room,
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
        room: Room,
        user: User,
        session: HandshakeSession,
        joinInfo: JoinInfo
    ): Promise<void>
    {
        const { name, rtpCapabilities } = joinInfo;

        // Запоминаем имя и RTP кодеки клиента.
        session.username = name;
        user.username = name;
        user.rtpCapabilities = rtpCapabilities;

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
                    name: otherUser[1].username
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
        room: Room,
        consumerUser: User,
        producerUserId: string,
        producer: MediasoupTypes.Producer
    )
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
        room: Room,
        consumer: MediasoupTypes.Consumer,
        consumerUser: User,
        producerUserId: string
    ): void
    {
        /** Действия после автоматического закрытия consumer. */
        const consumerClosed = () =>
        {
            room.consumerClosed(consumer, consumerUser);

            const closeConsumerInfo: CloseConsumerInfo = {
                consumerId: consumer.id,
                producerUserId
            };

            socket.emit(SE.CloseConsumer, closeConsumerInfo);
        };

        /** Поставить на паузу consumer. */
        const pauseConsumer = async () =>
        {
            await room.pauseConsumer(consumer);

            // Сообщаем клиенту, чтобы он тоже поставил на паузу, если только это не он попросил.
            // То есть сообщаем клиенту, что сервер поставил или хотел поставить на паузу. Хотел в том случае,
            // если до этого клиент уже поставил на паузу, а после соответствующий producer был поставлен на паузу.
            // Это необходимо, чтобы клиент знал при попытке снять с паузы, что сервер НЕ ГОТОВ снимать с паузы consumer.
            socket.emit(SE.PauseConsumer, consumer.id);
        };

        /** Снять consumer c паузы. */
        const resumeConsumer = async () =>
        {
            await room.pauseConsumer(consumer);

            // Сообщаем клиенту, чтобы он тоже снял с паузы, если только это не он попросил.
            // То есть сообщаем клиенту, что сервер снял или хотел снять паузу.
            // Это необходимо, чтобы клиент знал при попытке снять с паузы, что сервер ГОТОВ снимать с паузы consumer.
            socket.emit('resumeConsumer', consumer.id);
        };

        consumer.on('transportclose', consumerClosed);
        consumer.on('producerclose', consumerClosed);
        consumer.on('producerpause', async () => { await pauseConsumer(); });
        consumer.on('producerresume', async () => { await resumeConsumer(); });
    }
}