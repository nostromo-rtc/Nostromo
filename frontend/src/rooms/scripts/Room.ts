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
    NewProducerInfo,
    CloseConsumerInfo,
    ChatMsgInfo
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

    // максимальный битрейт для видео
    static MEGA = 1024 * 1024;
    private maxVideoBitrate = 10 * Room.MEGA;

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

        // на сервере закрылся транспорт, поэтому надо закрыть его и здесь
        this.socket.on('closeTransport', (transportId: string) =>
        {
            if (this.mediasoup.sendTransport?.id == transportId)
                this.mediasoup.sendTransport.close();

            if (this.mediasoup.recvTransport?.id == transportId)
                this.mediasoup.recvTransport.close();
        });

        // на сервере закрылся producer (так как закрылся транспорт),
        // поэтому надо закрыть его и здесь
        this.socket.on('closeProducer', (producerId: string) =>
        {
            const producer = this.mediasoup.producers.get(producerId);

            if (producer)
            {
                producer.close();
                this.mediasoup.producers.delete(producerId);
            }
        });

        // на сервере закрылся consumer (так как закрылся транспорт или producer на сервере),
        // поэтому надо закрыть его и здесь
        this.socket.on('closeConsumer', ({ consumerId, producerUserId }: CloseConsumerInfo) =>
        {
            const consumer = this.mediasoup.consumers.get(consumerId);

            if (consumer)
            {

                this.users.get(producerUserId)?.removeTrack(consumer.track);

                if (consumer.track.kind == 'video')
                    this.ui.allVideos.get(producerUserId)?.load();

                consumer.close();

                this.mediasoup.consumers.delete(consumerId);
            }
        });

        // получаем название комнаты
        this.socket.on('roomName', (roomName: string) =>
        {
            this.ui.roomName = roomName;
            document.title += ' - ' + roomName;
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

        // сообщение в чат
        this.socket.on('chatMsg', ({ name, msg }: ChatMsgInfo) =>
        {
            const timestamp = this.getTimestamp();
            this.ui.chat.innerHTML += `[${timestamp}] (Общий) Собеседник ${name}: ${msg}` + "\n";
            this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
        });

        // новый consumer (новый входящий медиапоток)
        this.socket.on('newConsumer', async (newConsumerInfo: NewConsumerInfo) =>
        {
            await this.newConsumer(newConsumerInfo);
        });

        // новое значение макс. битрейта видео
        this.socket.on('maxVideoBitrate', (bitrate: number) =>
        {
            // если битрейт изменился
            if (this.maxVideoBitrate != bitrate)
            {
                this.maxVideoBitrate = bitrate;
                console.debug('[Room] New maxVideoBitrate in Mbit', bitrate / Room.MEGA);

                for (const producer of this.mediasoup.producers.values())
                {
                    if (producer.kind == 'video')
                    {
                        let params = producer.rtpSender!.getParameters();
                        params.encodings[0].maxBitrate = bitrate;
                        producer.rtpSender!.setParameters(params);
                    }
                }
            }
        });

        // другой пользователь отключился
        this.socket.on('userDisconnected', (remoteUserId: SocketId) =>
        {
            console.info("[Room] > remoteUser disconnected:", `[${remoteUserId}]`);
            this.ui.removeVideo(remoteUserId);
            this.users.delete(remoteUserId);
        });

        // ошибка при соединении нашего веб-сокета
        this.socket.on('connect_error', (err: Error) =>
        {
            console.log(err.message); // скорее всего not authorized
        });

        // наше веб-сокет соединение разорвано
        this.socket.on('disconnect', (reason) =>
        {
            console.warn("[Room] Вы были отсоединены от веб-сервера (websocket disconnect)", reason);

            location.reload();
        });

        this.socket.io.on("error", (error) =>
        {
            console.error("[Room] >", error.message);
        });

        // обработка чатов
        this.ui.buttons.get('sendMessage')!.addEventListener('click', () =>
        {
            /*if (this.ui.currentChatOption != "default")
            {
                const receiverId = this.ui.currentChatOption;
            }*/
            const message: string = this.ui.messageText.value.toString().trim();

            if (message)
            {
                const timestamp = this.getTimestamp();
                this.ui.chat.innerHTML += `[${timestamp}] (Общий) Я: ${message}` + "\n";
                this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
                this.socket.emit('chatMsg', message);
            }
        });

        /*this.ui.buttons.get('sendFile')!.addEventListener('click', () =>
        {
            if (this.ui.currentChatOption != "default")
            {
                const receiverId = this.ui.currentChatOption;
            }
        });*/
    }

    private getTimestamp(): string
    {
        const timestamp = (new Date).toLocaleString("en-us", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        });
        return timestamp;
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
    private async routerRtpCapabilities(routerRtpCapabilities: MediasoupTypes.RtpCapabilities): Promise<void>
    {
        await this.mediasoup.loadDevice(routerRtpCapabilities);

        // запрашиваем создание транспортного канала на сервере для приема потоков
        let consuming: boolean = true;
        this.socket.emit('createWebRtcTransport', consuming);

        // и для отдачи наших потоков
        this.socket.emit('createWebRtcTransport', !consuming);
    }

    // обработка общих событий для входящего и исходящего транспортных каналов
    private handleCommonTransportEvents(localTransport: MediasoupTypes.Transport): void
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
    private handleSendTransportEvents(localTransport: MediasoupTypes.Transport): void
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
    private async newConsumer(newConsumerInfo: NewConsumerInfo): Promise<void>
    {
        const consumer = await this.mediasoup.newConsumer(newConsumerInfo);

        // если consumer не удалось создать
        if (!consumer) return;

        // если удалось, то сообщаем об этом серверу, чтобы он снял с паузы consumer
        this.socket.emit('resumeConsumer', consumer.id);

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
            },
            encodings: [
                {
                    maxBitrate: this.maxVideoBitrate
                }
            ]
        });

        this.mediasoup.producers.set(producer.id, producer);
    }

    // обновить существующее медиа
    public async updateMediaStreamTrack(oldTrackId: string, track: MediaStreamTrack): Promise<void>
    {
        const producer = Array.from(this.mediasoup.producers.values())
            .find((producer) => producer.track!.id == oldTrackId);

        if (producer) await producer.replaceTrack({ track });
    }

    // удалить медиапоток (дорожку) из подключения
    public removeMediaStreamTrack(trackId: string): void
    {
        const producer = Array.from(this.mediasoup.producers.values())
            .find((producer) => producer.track!.id == trackId);

        if (producer)
        {
            producer.close();
            this.mediasoup.producers.delete(producer.id);
            this.socket.emit('closeProducer', producer.id);
        }
    }

    // поставить медиапоток (дорожку) на паузу
    public pauseMediaStreamTrack(trackId: string): void
    {
        const producer = Array.from(this.mediasoup.producers.values())
            .find((producer) => producer.track!.id == trackId);

        if (producer)
        {
            producer.pause();
            this.socket.emit('pauseProducer', producer.id);
        }
    }

    // снять медиапоток (дорожку) с паузы
    public resumeMediaStreamTrack(trackId: string): void
    {
        const producer = Array.from(this.mediasoup.producers.values())
            .find((producer) => producer.track!.id == trackId);

        if (producer)
        {
            producer.resume();
            this.socket.emit('resumeProducer', producer.id);
        }
    }
}
