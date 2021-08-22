import { UI } from "./UI.js";
import { Room } from "./Room.js";

declare global
{
    interface MediaDevices
    {
        getDisplayMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>;
    }
}

// Класс, получающий медиапотоки пользователя
export class UserMedia
{
    private ui: UI;
    private parent: Room;

    private stream = new MediaStream();

    private streamConstraintsMic: MediaStreamConstraints = {
        audio: true, video: false
    };
    private streamConstraintsCam: MediaStreamConstraints = {
        audio: false, video: true
    };

    private micPaused: boolean = false;

    private captureConstraints: Map<string, MediaStreamConstraints>;

    constructor(_ui: UI, _parent: Room)
    {
        console.debug("UserMedia ctor");

        this.ui = _ui;          // интерфейс
        this.parent = _parent;  // родительский класс
        this.captureConstraints = this.prepareCaptureConstraints();

        this.ui.buttons.get('getUserMediaMic')!.addEventListener('click',
            async () => await this.getUserMedia(this.streamConstraintsMic));

        this.ui.buttons.get('getUserMediaCam')!.addEventListener('click',
            async () => await this.getUserMedia(this.streamConstraintsCam));

        this.ui.buttons.get('getDisplayMedia')!.addEventListener('click',
            async () => await this.getDisplayMedia());

        this.ui.buttons.get('toggleMic')!.addEventListener('click',
            () => this.toggleMic());
    }

    // -- получение видео (веб-камера) или аудио (микрофон) потока -- //
    private async getUserMedia(
        streamConstraints: MediaStreamConstraints
    ): Promise<void>
    {
        try
        {
            const mediaStream: MediaStream = await navigator.mediaDevices.getUserMedia(streamConstraints);

            console.debug("> [UserMedia] getUserMedia success:", mediaStream);

            await this.handleMediaStream(mediaStream);

            if (streamConstraints.audio)
                this.ui.buttons.get('toggleMic')!.hidden = false;
        }
        catch (error) // -- в случае ошибки -- //
        {
            console.error("> [UserMedia] getUserMedia error:", error as DOMException);
        }
    }

    // -- захват видео с экрана юзера -- //
    private async getDisplayMedia(): Promise<void>
    {
        try
        {
            // захват экрана
            const mediaStream: MediaStream = await navigator.mediaDevices
                .getDisplayMedia(this.captureConstraints.get(this.ui.currentCaptureSetting));

            console.debug("> [UserMedia] getDisplayMedia success:", mediaStream.getTracks());

            await this.handleMediaStream(mediaStream);
        }
        catch (error)
        {
            console.error("> [UserMedia] getDisplayMedia error:", error as DOMException);
        }
    }

    private async handleMediaStream(mediaStream: MediaStream)
    {
        for (const newTrack of mediaStream.getTracks())
        {
            this.handleEndedTrack(newTrack);

            // проверяем, было ли от нас что-то до этого такого же типа (аудио или видео)
            let presentSameKindMedia = false;
            for (const oldTrack of this.stream.getTracks())
            {
                if (oldTrack.kind == newTrack.kind)
                {
                    presentSameKindMedia = true;
                    this.stopTrack(oldTrack);
                    await this.parent.updateMediaStreamTrack(oldTrack.id, newTrack);
                }
            }

            const streamWasActive = this.stream.active;
            this.stream.addTrack(newTrack);

            // перезагружаем видеоэлемент. Это необходимо, на тот случай,
            // если до этого из стрима удалили все дорожки и стрим стал неактивным,
            // а при удалении видеодорожки (и она была последней при удалении) вызывали load(),
            // чтобы убрать зависнувший последний кадр.
            // Иначе баг на Chrome: если в стриме только аудиодорожка,
            // то play/pause на видеоэлементе не будут работать, а звук будет все равно идти.
            if (!streamWasActive) this.ui.localVideo!.load();

            // так как добавили новую дорожку, включаем отображение элементов управления
            // также обрабатываем в плеере случаи когда в stream нет звуковых дорожек и когда они есть
            const hasAudio: boolean = this.stream.getAudioTracks().length > 0;
            this.ui.showControls(this.ui.localVideo!.plyr, hasAudio);

            // подключаем медиапоток к HTML-элементу <video> (localVideo)
            if (!this.ui.localVideo!.srcObject)
                this.ui.localVideo!.srcObject = this.stream;

            // если не было
            if (!presentSameKindMedia)
            {
                await this.parent.addMediaStreamTrack(newTrack);
            }
        }
    }

    private stopTrack(oldVideoTrack: MediaStreamTrack): void
    {
        // stop не вызывает событие ended,
        // поэтому удаляем трек из стрима сами
        oldVideoTrack.stop();
        console.debug("stopTrack", oldVideoTrack);
        this.removeTrackFromStream(oldVideoTrack);
    }

    // обработка закончившихся (ended) треков
    private handleEndedTrack(track: MediaStreamTrack): void
    {
        track.addEventListener('ended', () =>
        {
            this.removeTrackFromStream(track);
            this.parent.removeMediaStreamTrack(track.id);
            if (track.kind == 'audio')
            {
                // поскольку аудиодорожка была удалена, значит новая точно
                // должна быть не на паузе
                const toggleMicButton = this.ui.buttons.get('toggleMic')!;
                toggleMicButton.innerText = 'Выключить микрофон';
                toggleMicButton.hidden = true;
                this.micPaused = false;
            }
        });
    }

    // удалить медиадорожку из локального стрима
    private removeTrackFromStream(track: MediaStreamTrack): void
    {
        this.stream.removeTrack(track);
        if (track.kind == 'video')
        {
            // сбрасываем видео объект
            this.ui.localVideo!.load();
        }

        const hasAudio: boolean = this.stream.getAudioTracks().length > 0;
        // если дорожек не осталось, выключаем элементы управления плеера
        if (this.stream.getTracks().length == 0)
        {
            this.ui.hideControls(this.ui.localVideo!.plyr);
        }
        // предусматриваем случай, когда звуковых дорожек не осталось
        // и убираем кнопку регулирования звука
        else if (!hasAudio)
        {
            this.ui.hideVolumeControl(this.ui.localVideo!.plyr);
        }
    }

    private toggleMic(): void
    {
        const audioTrack: MediaStreamTrack = this.stream.getAudioTracks()[0];

        if (!this.micPaused)
        {
            this.parent.pauseMediaStreamTrack(audioTrack.id);
            this.ui.buttons.get('toggleMic')!.innerText = 'Включить микрофон';
            this.micPaused = true;
        }
        else
        {
            this.parent.resumeMediaStreamTrack(audioTrack.id);
            this.ui.buttons.get('toggleMic')!.innerText = 'Выключить микрофон';
            this.micPaused = false;
        }
    }

    // подготовить опции с разрешениями
    private prepareCaptureConstraints(): Map<string, MediaStreamConstraints>
    {
        let _constraints = new Map<string, MediaStreamConstraints>();

        let constraints1440p: MediaStreamConstraints = {
            video: {
                frameRate: 30,
                width: 2560, height: 1440
            },
            audio: { echoCancellation: false, noiseSuppression: false }
        };

        let constraints1080p: MediaStreamConstraints = {
            video: {
                frameRate: 30,
                width: 1920, height: 1080
            },
            audio: { echoCancellation: false, noiseSuppression: false }
        };

        let constraints1080p60: MediaStreamConstraints = {
            video: {
                frameRate: 60,
                width: 1920, height: 1080
            },
            audio: { echoCancellation: false, noiseSuppression: false }
        };

        let constraints720p: MediaStreamConstraints = {
            video: {
                frameRate: 30,
                width: 1280, height: 720
            },
            audio: { echoCancellation: false, noiseSuppression: false }
        };

        let constraints720p60: MediaStreamConstraints = {
            video: {
                frameRate: 60,
                width: 1280, height: 720
            },
            audio: { echoCancellation: false, noiseSuppression: false }
        };

        let constraints480p: MediaStreamConstraints = {
            video: {
                frameRate: 30,
                width: 854, height: 480
            },
            audio: { echoCancellation: false, noiseSuppression: false }
        };

        let constraints360p: MediaStreamConstraints = {
            video: {
                frameRate: 30,
                width: 640, height: 360
            },
            audio: { echoCancellation: false, noiseSuppression: false }
        };

        let constraints240p: MediaStreamConstraints = {
            video: {
                frameRate: 30,
                width: 426, height: 240
            },
            audio: { echoCancellation: false, noiseSuppression: false }
        };

        _constraints.set('1440p', constraints1440p);
        this.ui.addCaptureSetting('2560x1440', '1440p');

        _constraints.set('1080p', constraints1080p);
        this.ui.addCaptureSetting('1920x1080', '1080p');

        _constraints.set('1080p@60', constraints1080p60);
        this.ui.addCaptureSetting('1920x1080@60', '1080p@60');

        _constraints.set('720p', constraints720p);
        this.ui.addCaptureSetting('1280x720', '720p');

        _constraints.set('720p@60', constraints720p60);
        this.ui.addCaptureSetting('1280x720@60', '720p@60');

        _constraints.set('480p', constraints480p);
        this.ui.addCaptureSetting('854x480', '480p');

        _constraints.set('360p', constraints360p);
        this.ui.addCaptureSetting('640x360', '360p');

        _constraints.set('240p', constraints240p);
        this.ui.addCaptureSetting('426x240', '240p');

        _constraints.set('default', constraints720p);

        return _constraints;
    }
}