
import { RequestHandler } from "express";
import SocketIO = require('socket.io');
import { Room, User } from "../Room";
import { IRoomRepository } from "../RoomRepository";
import { SocketEvents as SE } from "nostromo-shared/types/SocketEvents";
import { IAdminSocketService } from "./AdminSocketService";

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
    private applySessionMiddleware(sessionMiddleware: RequestHandler)
    {
        this.roomIo.use((socket: Socket, next) =>
        {
            sessionMiddleware(socket.handshake, {}, next);
        });
    }

    private checkAuth()
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
    private clientConnected()
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
            this.clientJoined(socket, room);
        });
    }

    /** Пользователь заходит в комнату. */
    private clientJoined(socket: Socket, room: Room): void
    {
        const session = socket.handshake.session!;

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
            await this.сreateWebRtcTransport(user, socket, consuming);
        });

        // подключение к транспортному каналу со стороны сервера
        socket.on('connectWebRtcTransport', async (
            connectWebRtcTransportInfo: ConnectWebRtcTransportInfo
        ) =>
        {
            await this.joinEvConnectWebRtcTransport(user, connectWebRtcTransportInfo);
        });

        // пользователь заходит в комнату (т.е уже создал транспортные каналы)
        // и готов к получению потоков (готов к получению consumers)
        socket.once('join', async (joinInfo: JoinInfo) =>
        {
            await this.joinEvJoin(user, socket, session, joinInfo);
        });

        // клиент ставит consumer на паузу
        socket.on('pauseConsumer', async (consumerId: string) =>
        {
            const consumer = user.consumers.get(consumerId);

            if (!consumer)
                throw new Error(`[Room] consumer with id "${consumerId}" not found`);

            // запоминаем, что клиент поставил на паузу вручную
            (consumer.appData as ConsumerAppData).clientPaused = true;

            await this.pauseConsumer(consumer);
        });

        // клиент снимает consumer с паузы
        socket.on('resumeConsumer', async (consumerId: string) =>
        {
            const consumer = user.consumers.get(consumerId);

            if (!consumer)
                throw new Error(`[Room] consumer with id "${consumerId}" not found`);

            // клиент хотел снять с паузы consumer, поэтому выключаем флаг ручной паузы
            (consumer.appData as ConsumerAppData).clientPaused = false;

            await this.resumeConsumer(consumer);
        });
        // создание нового producer
        socket.on('newProducer', async (newProducerInfo: NewProducerInfo) =>
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
     * Создать транспортный канал по запросу клиента.
     * @param consuming Канал для отдачи потоков от сервера клиенту?
     */
    private async сreateWebRtcTransport(
        room: Room,
        user: User,
        socket: Socket,
        consuming: boolean
    )
    {
        try
        {
            const transport = await room.createWebRtcTransport(user, consuming);

            transport.on

            transport.on('routerclose', () =>
            {
                if (consuming)
                {
                    user.consumerTransport = undefined;
                }
                else
                {
                    user.producerTransport = undefined;
                }

                socket.emit('closeTransport', transport.id);
            });

            const info: NewWebRtcTransportInfo = {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates as NewWebRtcTransportInfo['iceCandidates'],
                dtlsParameters: transport.dtlsParameters
            };

            socket.emit(consuming ? 'createRecvTransport' : 'createSendTransport', info);
        }
        catch (error)
        {
            console.error(`[Room] createWebRtcTransport for User ${user.userId} error: `, (error as Error).message);
        }
    }
}