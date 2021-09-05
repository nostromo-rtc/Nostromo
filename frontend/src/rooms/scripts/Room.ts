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

interface ConsumerAppData
{
    /** Consumer был поставлен на паузу со стороны клиента (плеер на паузе) */
    localPaused: boolean;

    /**
     * Consumer был поставлен на паузу со стороны сервера
     * (соответствующий producer на сервере был поставлен на паузу)
     */
    serverPaused: boolean;
}

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
    static KILO = 1024;
    static MEGA = 1024 * 1024;
    private maxVideoBitrate = 10 * Room.MEGA;
    private maxAudioBitrate = 64 * Room.KILO;

    // задержка после входа на воспроизведение звуковых оповещений
    private soundDelayAfterJoin = true;

    // для работы с mediasoup-client
    private mediasoup: Mediasoup;

    constructor(ui: UI)
    {
        console.debug("[Room] > ctor");

        this.ui = ui;
        this.mediasoup = new Mediasoup();
        this.userMedia = new UserMedia(this.ui, this);

        // обработка кнопок
        this.handleButtons();

        // через X миллисекунд разрешаем включать звуковые оповещения
        setTimeout(() => this.soundDelayAfterJoin = false, 2000);

        this.socket.on('connect', () =>
        {
            console.info("[Room] > Создано веб-сокет подключение:", this.socket.id);

            // включим звук, что зашли в комнату
            this.ui.joinedSound.play();
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
            const producer = this.mediasoup.getProducer(producerId);

            if (producer)
            {
                producer.close();
                this.mediasoup.deleteProducer(producer);
            }
        });

        // на сервере закрылся consumer (так как закрылся транспорт или producer на сервере),
        // поэтому надо закрыть его и здесь
        this.socket.on('closeConsumer', ({ consumerId, producerUserId }: CloseConsumerInfo) =>
        {
            const consumer = this.mediasoup.getConsumer(consumerId);

            if (!consumer) return;

            const remoteVideo = this.ui.allVideos.get(producerUserId);

            if (remoteVideo)
            {
                const stream = remoteVideo.srcObject as MediaStream;
                consumer.track.stop();
                stream.removeTrack(consumer.track);

                // перезагружаем видеоэлемент,
                // чтобы не висел последний кадр удаленной видеодорожки
                if (consumer.track.kind == 'video')
                    remoteVideo.load();

                const hasAudio: boolean = stream.getAudioTracks().length > 0;
                // если дорожек не осталось, выключаем элементы управления плеера
                if (stream.getTracks().length == 0)
                {
                    this.ui.hideControls(remoteVideo.plyr);
                }
                // предусматриваем случай, когда звуковых дорожек не осталось
                // и убираем кнопку регулирования звука
                else if (!hasAudio)
                {
                    this.ui.hideVolumeControl(remoteVideo.plyr);
                }
            }

            consumer.close();
            this.mediasoup.deleteConsumer(consumer);
        });

        // получаем название комнаты
        this.socket.on('roomName', (roomName: string) =>
        {
            this.ui.roomName = roomName;
            document.title += ' - ' + roomName;
        });

        // получаем макс. битрейт для аудио
        this.socket.on('maxAudioBitrate', (bitrate: number) =>
        {
            this.maxAudioBitrate = bitrate;
        });

        // новый пользователь (т.е другой)
        this.socket.on('newUser', ({ id, name }: NewUserInfo) =>
        {
            this.ui.addVideo(id, name);

            this.pauseAndPlayEventsPlayerHandler(id);

            if (!this.soundDelayAfterJoin)
                this.ui.joinedSound.play();
        });

        // другой пользователь поменял имя
        this.socket.on('newUsername', ({ id, name }: NewUserInfo) =>
        {
            this.ui.updateVideoLabel(id, name);
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

        // на сервере consumer был поставлен на паузу, сделаем тоже самое и на клиенте
        this.socket.on('pauseConsumer', (consumerId) =>
        {
            const consumer = this.mediasoup.getConsumer(consumerId);
            if (!consumer) return;

            // запоминаем, что сервер поставил на паузу (по крайней мере хотел)
            (consumer.appData as ConsumerAppData).serverPaused = true;

            if (!consumer.paused) consumer.pause();
        });

        // на сервере consumer был снят с паузы, сделаем тоже самое и на клиенте
        this.socket.on('resumeConsumer', (consumerId) =>
        {
            const consumer = this.mediasoup.getConsumer(consumerId);
            if (!consumer) return;

            // запоминаем, что сервер снял с паузы (по крайней мере хотел)
            (consumer.appData as ConsumerAppData).serverPaused = false;

            // проверяем чтобы:
            // 1) consumer был на паузе,
            // 2) мы ГОТОВЫ к снятию паузы у этого consumer
            if (consumer.paused
                && !(consumer.appData as ConsumerAppData).localPaused)
            {
                consumer.resume();
            }
        });

        // новое значение макс. битрейта видео
        this.socket.on('maxVideoBitrate', (bitrate: number) =>
        {
            // если битрейт изменился
            if (this.maxVideoBitrate != bitrate)
            {
                this.maxVideoBitrate = bitrate;
                console.debug('[Room] > New maxVideoBitrate in Mbit', bitrate / Room.MEGA);

                for (const producer of this.mediasoup.getProducers())
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
            this.ui.leftSound.play();
        });

        // ошибка при соединении нашего веб-сокета
        this.socket.on('connect_error', (err: Error) =>
        {
            console.error("[Room] > ", err.message); // скорее всего not authorized
        });

        // наше веб-сокет соединение разорвано
        this.socket.on('disconnect', (reason) =>
        {
            console.warn("[Room] > Вы были отсоединены от веб-сервера (websocket disconnect)", reason);

            location.reload();
        });

        this.socket.io.on("error", (error) =>
        {
            console.error("[Room] > ", error.message);
        });

        // обработка чатов
        this.ui.buttons.get('sendMessage')!.addEventListener('click', () =>
        {
            const message: string = this.ui.messageText.value.toString().trim();

            if (message)
            {
                const timestamp = this.getTimestamp();
                this.ui.chat.innerHTML += `[${timestamp}] (Общий) Я: ${message}` + "\n";
                this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
                this.socket.emit('chatMsg', message);
            }
        });
    }

    // обрабатываем паузу и снятие паузы на плеере
    private pauseAndPlayEventsPlayerHandler(id: string)
    {
        const remoteVideo = this.ui.allVideos.get(id);
        if (!remoteVideo) return;

        const listenerFunc = (playerPause: boolean) =>
        {
            const stream = remoteVideo.srcObject as MediaStream | null;
            if (!stream) return;

            if (playerPause)
            {
                console.debug(`[Room] > Плеер (${remoteVideo.id}) был поставлен на паузу`);
            }
            else
            {
                console.debug(`[Room] > Плеер (${remoteVideo.id}) был снят с паузы`);
            }

            for (const track of stream.getTracks())
            {
                const consumerId = this.mediasoup.getConsumerByTrackId(track.id)!;
                const consumer = this.mediasoup.getConsumer(consumerId)!;

                if (playerPause)
                {
                    // запоминаем, что поставили / хотели поставить на паузу
                    (consumer.appData as ConsumerAppData).localPaused = true;

                    // ставим на паузу consumer у клиента
                    if (!consumer.paused) consumer.pause();

                    // просим поставить на паузу consumer на сервере
                    // т.е сообщаем о нашем намерении поставить на паузу
                    this.socket.emit('pauseConsumer', consumer.id);
                }
                else
                {
                    // запоминаем, что сняли / хотели снять с паузы
                    (consumer.appData as ConsumerAppData).localPaused = false;

                    // снимаем с паузы consumer у клиента, если:
                    // 1) consumer на паузе
                    // 2) сервер готов
                    if (consumer.paused
                        && !(consumer.appData as ConsumerAppData).serverPaused)
                    {
                        consumer.resume();
                    }

                    // просим снять с паузы consumer на сервере
                    // т.е сообщаем о нашем намерении снять с паузы
                    this.socket.emit('resumeConsumer', consumer.id);
                }
            }
        };

        remoteVideo.addEventListener('pause', () => listenerFunc(true));
        remoteVideo.addEventListener('play', () => listenerFunc(false));
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

            console.debug('[Room] > Ник был изменен на', this.ui.usernameInputValue);

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
            console.debug("[Room] > connectionstatechange: ", state);
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

        console.info('[Room] > Входим в комнату...');
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
        const consumer = await this.mediasoup.createConsumer(newConsumerInfo);

        // если consumer не удалось создать
        if (!consumer) return;

        const remoteVideo: HTMLVideoElement = this.ui.allVideos.get(newConsumerInfo.producerUserId)!;

        let stream = remoteVideo.srcObject as MediaStream | null;

        // если MediaStream нет, то создадим его и инициализируем этим треком
        if (!stream)
        {
            stream = new MediaStream([consumer.track]);
            remoteVideo.srcObject = stream;
        }
        else // иначе добавим новый трек
        {
            const streamWasActive = stream.active;
            stream.addTrack(consumer.track);

            // перезагружаем видеоэлемент. Это необходимо, на тот случай,
            // если до этого из стрима удалили все дорожки и стрим стал неактивным,
            // а при удалении видеодорожки (и она была последней при удалении) вызывали load(),
            // чтобы убрать зависнувший последний кадр.
            // Иначе баг на Chrome: если в стриме только аудиодорожка,
            // то play/pause на видеоэлементе не будут работать, а звук будет все равно идти.
            if (!streamWasActive) remoteVideo.load();
        }

        // включаем отображение элементов управления
        // также обрабатываем в плеере случаи когда в stream нет звуковых дорожек и когда они есть
        const hasAudio: boolean = stream.getAudioTracks().length > 0;
        this.ui.showControls(remoteVideo.plyr, hasAudio);

        // если видеоэлемент на паузе, ставим новый consumer на паузу
        // на сервере он изначально на паузе
        if (remoteVideo.paused)
        {
            consumer.pause();
            (consumer.appData as ConsumerAppData).localPaused = true;
        }
        else // иначе сообщаем серверу, чтобы он снял с паузы consumer
        {
            this.socket.emit('resumeConsumer', consumer.id);
        }
    }

    // добавить медиапоток (одну дорожку) в подключение
    public async addMediaStreamTrack(track: MediaStreamTrack): Promise<void>
    {
        const maxBitrate = (track.kind == 'video') ? this.maxVideoBitrate : this.maxAudioBitrate;

        // создаем producer
        this.mediasoup.createProducer(track, maxBitrate);
    }

    // обновить существующее медиа
    public async updateMediaStreamTrack(oldTrackId: string, track: MediaStreamTrack): Promise<void>
    {
        const producer = Array.from(this.mediasoup.getProducers())
            .find((producer) => producer.track!.id == oldTrackId);

        if (producer) await producer.replaceTrack({ track });
    }

    // удалить медиапоток (дорожку) из подключения
    public removeMediaStreamTrack(trackId: string): void
    {
        const producer = Array.from(this.mediasoup.getProducers())
            .find((producer) => producer.track!.id == trackId);

        if (producer)
        {
            producer.close();
            this.mediasoup.deleteProducer(producer);
            this.socket.emit('closeProducer', producer.id);
        }
    }

    // поставить медиапоток (дорожку) на паузу
    public pauseMediaStreamTrack(trackId: string): void
    {
        const producer = Array.from(this.mediasoup.getProducers())
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
        const producer = Array.from(this.mediasoup.getProducers())
            .find((producer) => producer.track!.id == trackId);

        if (producer)
        {
            producer.resume();
            this.socket.emit('resumeProducer', producer.id);
        }
    }
}
