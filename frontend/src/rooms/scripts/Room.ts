import { UI } from "./UI.js";
import { UserMedia } from './UserMedia.js';
import { io, Socket } from "socket.io-client";

import
{
    Mediasoup,
    MediasoupTypes,
    TransportProduceParameters
} from "./Mediasoup.js";

import
{
    SocketId,
    NewUserInfo,
    JoinInfo,
    NewConsumerInfo,
    NewWebRtcTransportInfo,
    ConnectWebRtcTransportInfo,
    NewProducerInfo
} from "shared/RoomTypes";

// класс - комната
export class Room
{
    // для работы с интерфейсом
    private ui: UI;

    // для работы с веб-сокетами
    private socket: Socket = io('/room', {
        'transports': ['websocket']
    });

    // для захватов медиапотоков пользователя
    private userMedia: UserMedia;

    // для работы с mediasoup-client
    private mediasoup: Mediasoup;

    // контейнер с медиастримами других собеседников
    private users = new Map<SocketId, MediaStream>();

    constructor(ui: UI)
    {
        console.debug("Room ctor");

        this.ui = ui;
        this.mediasoup = new Mediasoup();
        this.userMedia = new UserMedia(this.ui, this);

        // обработка кнопок
        this.handleButtons();

        this.socket.on('connect', () =>
        {
            console.info("Создано веб-сокет подключение");
            console.info("Client id:", this.socket.id);
        });

        // получаем RTP возможности сервера
        this.socket.on('routerRtpCapabilities', async (
            routerRtpCapabilities: MediasoupTypes.RtpCapabilities
        ) =>
        {
            await this.routerRtpCapabilities(routerRtpCapabilities);
        });

        // локально создаем транспортный канал для приема потоков
        this.socket.on('createRecvTransport', (transport: NewWebRtcTransportInfo) =>
        {
            this.createRecvTransport(transport);
        });

        // локально создаем транспортный канал для отдачи потоков
        this.socket.on('createSendTransport', (transport: NewWebRtcTransportInfo) =>
        {
            this.createSendTransport(transport);
        });

        // получаем название комнаты
        this.socket.on('roomName', (roomName: string) =>
        {
            this.ui.roomName = roomName;
        });

        // новый пользователь (т.е другой)
        this.socket.on('newUser', ({ id, name }: NewUserInfo) =>
        {
            // создаем пустой mediastream
            const media = new MediaStream();
            // запоминаем его
            this.users.set(id, media);
            // создаем видеоэлемент и привязываем mediastream к нему
            this.ui.addVideo(id, name, media);
        });

        // другой пользователь поменял имя
        this.socket.on('newUsername', ({ id, name }: NewUserInfo) =>
        {
            this.ui.updateVideoLabel(id, name);
            this.ui.updateChatOption(id, name);
        });

        // новый consumer (новый входящий медиапоток)
        this.socket.on('newConsumer', async (newConsumerInfo: NewConsumerInfo) =>
        {
            this.newConsumer(newConsumerInfo);
        });

        // ошибка при соединении нашего веб-сокета
        this.socket.on('connect_error', (err: Error) =>
        {
            console.log(err.message); // скорее всего not authorized
        });

        // другой пользователь отключился
        this.socket.on('userDisconnected', (remoteUserId: SocketId) =>
        {
            console.info("SocketHandler > remoteUser disconnected:", `[${remoteUserId}]`);
            this.ui.removeVideo(remoteUserId);
            this.users.delete(remoteUserId);
        });

        // наше веб-сокет соединение разорвано
        this.socket.on('disconnect', () =>
        {
            console.warn("Вы были отсоединены от веб-сервера (websocket disconnect)");

            for (const userId of this.users.keys())
            {
                this.ui.removeVideo(userId);
            }
            this.ui.localVideo!.srcObject = null;
            this.users.clear();
        });

        // обработка личных чатов
        this.ui.buttons.get('sendMessage')!.addEventListener('click', () =>
        {
            if (this.ui.currentChatOption != "default")
            {
                const receiverId = this.ui.currentChatOption;
            }
        });

        this.ui.buttons.get('sendFile')!.addEventListener('click', () =>
        {
            if (this.ui.currentChatOption != "default")
            {
                const receiverId = this.ui.currentChatOption;
            }
        });

        document.addEventListener('beforeunload', () =>
        {
            this.socket.close();
        });
    }

    // обработка нажатий на кнопки
    private handleButtons(): void
    {
        this.ui.buttons.get('setNewUsername')!.addEventListener('click', () =>
        {
            this.ui.setNewUsername();
            this.socket.emit('newUsername', this.ui.usernameInputValue);
        });
    }

    // получение rtpCapabilities сервера и инициализация ими mediasoup device
    private async routerRtpCapabilities(routerRtpCapabilities: MediasoupTypes.RtpCapabilities)
    {
        await this.mediasoup.loadDevice(routerRtpCapabilities);

        // запрашиваем создание транспортного канала на сервере для приема потоков
        let consuming: boolean = true;
        this.socket.emit('createWebRtcTransport', consuming);

        // и для отдачи наших потоков
        this.socket.emit('createWebRtcTransport', !consuming);
    }

    // обработка общих событий для входящего и исходящего транспортных каналов
    private handleCommonTransportEvents(localTransport: MediasoupTypes.Transport)
    {
        localTransport.on('connect', (
            { dtlsParameters }, callback, errback
        ) =>
        {
            try
            {
                const info: ConnectWebRtcTransportInfo = {
                    transportId: localTransport.id,
                    dtlsParameters
                };
                this.socket.emit('connectWebRtcTransport', info);

                // сообщаем транспорту, что параметры были переданы на сервер
                callback();
            }
            catch (error)
            {
                // сообщаем транспорту, что что-то пошло не так
                errback(error);
            }
        });

        localTransport.on('connectionstatechange', async (state) =>
        {
            console.debug("connectionstatechange: ", state);
        });
    }

    // создаем транспортный канал для приема потоков
    private createRecvTransport(transport: NewWebRtcTransportInfo): void
    {
        // создаем локальный транспортный канал
        this.mediasoup.createRecvTransport(transport);

        // если он не создался
        if (!this.mediasoup.recvTransport) return;

        // если все же создался, обработаем события этого транспорта
        this.handleCommonTransportEvents(this.mediasoup.recvTransport);

        // теперь, когда транспортный канал для приема потоков создан
        // войдем в комнату - т.е сообщим имя и наши rtpCapabilities
        const info: JoinInfo = {
            name: this.ui.usernameInputValue,
            rtpCapabilities: this.mediasoup.device.rtpCapabilities
        };

        this.socket.emit('join', info);
    }

    // создаем транспортный канал для отдачи потоков
    private createSendTransport(transport: NewWebRtcTransportInfo): void
    {
        // создаем локальный транспортный канал
        this.mediasoup.createSendTransport(transport);

        const localTransport = this.mediasoup.sendTransport;

        // если он не создался
        if (!localTransport) return;

        this.handleCommonTransportEvents(localTransport);

        this.handleSendTransportEvents(localTransport);
    }

    // обработка событий исходящего транспортного канала
    private handleSendTransportEvents(localTransport: MediasoupTypes.Transport)
    {
        localTransport.on('produce', (
            parameters: TransportProduceParameters, callback, errback
        ) =>
        {
            try
            {
                const info: NewProducerInfo = {
                    transportId: localTransport.id,
                    kind: parameters.kind,
                    rtpParameters: parameters.rtpParameters
                };

                this.socket.emit('newProducer', info);

                // сообщаем транспорту, что параметры были переданы на сервер
                // и передаем транспорту id серверного producer
                this.socket.once('newProducer', (id: string) =>
                {
                    callback({ id });
                });
            }
            catch (error)
            {
                // сообщаем транспорту, что что-то пошло не так
                errback(error);
            }
        });
    }

    // новый входящий медиапоток
    private async newConsumer(newConsumerInfo: NewConsumerInfo)
    {
        const consumer = await this.mediasoup.newConsumer(newConsumerInfo);

        // если consumer не удалось создать
        if (!consumer) return;

        // если удалось, то сообщаем об этом серверу
        this.socket.emit('consumerReady', consumer.id);

        const media: MediaStream = this.users.get(newConsumerInfo.producerUserId)!;

        media.addTrack(consumer.track);
    }

    // добавить медиапоток (одну дорожку) в подключение
    public async addMediaStreamTrack(track: MediaStreamTrack): Promise<void>
    {
        const producer = await this.mediasoup.sendTransport!.produce({
            track,
            codecOptions:
            {
                videoGoogleStartBitrate: 1000
            }
        });

        this.mediasoup.producers.set(producer.id, producer);
    }

    // обновить существующее медиа
    public async updateMediaStreamTrack(oldTrackId: string, track: MediaStreamTrack): Promise<void>
    {
        const producer = Array.from(this.mediasoup.producers.values())
            .find((producer) => producer.track!.id == oldTrackId);

        if (producer) producer.replaceTrack({ track });
    }
}