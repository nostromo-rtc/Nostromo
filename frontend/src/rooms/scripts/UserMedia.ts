import UI from "./UI.js";
import SocketHandler from "./SocketHandler.js";

declare global
{
    interface MediaDevices
    {
        getDisplayMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>;
    }
}

// Класс, получающий медиапотоки пользователя
export default class UserMedia
{
    private ui: UI;
    private parent: SocketHandler;

    private _stream = new MediaStream();
    public get stream() { return this._stream; }
    private streamConstraintsMic: MediaStreamConstraints = {
        audio: true, video: false
    };
    private streamConstraintsCam: MediaStreamConstraints = {
        audio: false, video: true
    };
    private captureConstraints = this.prepareCaptureConstraints();

    constructor(_ui: UI, _parent: SocketHandler)
    {
        console.debug("UserMedia ctor");
        this.ui = _ui;          // интерфейс
        this.parent = _parent;  // родительский класс

        this.ui.buttons.get('getUserMediaMic').addEventListener('click',
            () => this.getUserMedia_click("audio", this.streamConstraintsMic));

        this.ui.buttons.get('getUserMediaCam').addEventListener('click',
            () => this.getUserMedia_click("video", this.streamConstraintsCam));

        this.ui.buttons.get('getDisplayMedia').addEventListener('click',
            () => this.getDisplayMedia_click());

    }

    // -- в случае, если не удалось захватить потоки юзера -- //
    private getUserMedia_error(error: DOMException)
    {
        console.error("> getUserMedia_error():", error);
        if (error.name == "NotFoundError")
        {
            console.error("Webcam or Mic not found.");
        }
    }

    // -- получение видео (веб-камера) и аудио (микрофон) потоков -- //
    async getUserMedia_click(trackKind: string, streamConstraints: MediaStreamConstraints)
    {
        try
        {
            // проверяем, было ли от нас что-то до этого
            let presentMedia: boolean = false;
            for (const oldTrack of this.stream.getTracks())
            {
                if (oldTrack.kind == trackKind)
                {
                    presentMedia = true;
                    oldTrack.stop();
                    if (trackKind == "video")
                    {
                        //this.ui.localVideo.srcObject = null;
                    }
                }
            }

            let mediaStream: MediaStream = await navigator.mediaDevices.getUserMedia(streamConstraints);
            for (const track of mediaStream.getTracks())
            {
                this.handleEndedTrack(track);
                this.stream.addTrack(track);
            }

            console.debug("getUserMedia success:", this.stream);

            // -- подключаем медиапоток к HTML-элементу <video> (localVideo) -- //
            this.ui.localVideo.srcObject = this.stream;

            // обновляем медиапоток в подключении
            if (presentMedia)
                this.parent.updateMediaStream(trackKind);
            else
                this.parent.addNewMediaStream(trackKind);
        }
        catch (error) // -- в случае ошибки -- //
        {
            this.getUserMedia_error(error as DOMException);
        }
    }

    // -- захват видео с экрана юзера -- //
    private async getDisplayMedia_click()
    {
        try
        {
            // проверяем, было ли видео от нас до этого
            let presentVideo: boolean = false;
            if (this.stream.getVideoTracks().length == 1)
            {
                presentVideo = true;
                const oldVideoTrack: MediaStreamTrack = this.stream.getVideoTracks()[0];
                oldVideoTrack.stop();
                //this.ui.localVideo.srcObject = null;
            }
            // захват экрана
            let displayMediaStream: MediaStream =
                await navigator.mediaDevices.getDisplayMedia
                    (this.captureConstraints.get(this.ui.currentCaptureSetting));

            // добавляем видеодорожку
            let videoTrack: MediaStreamTrack = displayMediaStream.getVideoTracks()[0];
            this.handleEndedTrack(videoTrack);
            this.stream.addTrack(videoTrack);
            // если захват экрана со звуком
            if (displayMediaStream.getAudioTracks().length == 1)
            {
                // если до этого от нас был звук
                let presentAudio: boolean = false;
                if (this.stream.getAudioTracks().length == 1)
                {
                    presentAudio = true;
                    const oldAudioTrack: MediaStreamTrack = this.stream.getAudioTracks()[0];
                    oldAudioTrack.stop();
                }
                // добавляем аудиодорожку
                let audioTrack: MediaStreamTrack = displayMediaStream.getAudioTracks()[0];
                this.handleEndedTrack(audioTrack);
                this.stream.addTrack(audioTrack);

                if (!presentAudio && !presentVideo)
                {
                    this.parent.addNewMediaStream('both');
                }
                else
                {
                    if (presentAudio)
                        this.parent.updateMediaStream('audio');
                    else
                        this.parent.addNewMediaStream('audio');

                    if (presentVideo)
                        this.parent.updateMediaStream('video');
                    else
                        this.parent.addNewMediaStream('video');
                }
            }
            else // если захват экрана без звука
            {
                // обновляем видеопоток в подключении
                if (presentVideo)
                    this.parent.updateMediaStream('video');
                else
                    this.parent.addNewMediaStream('video');
            }

            console.debug("getDisplayMedia success:", this.stream);
            console.debug(await navigator.mediaDevices.enumerateDevices());

            // -- подключаем медиапоток к HTML-элементу <video> (localVideo) -- //
            this.ui.localVideo.srcObject = this.stream;
        }
        catch (error)
        {
            console.error("> getDisplayMedia_error():", error as DOMException);
        }
    }

    // обработка закончившихся (ended) треков
    private handleEndedTrack(track: MediaStreamTrack)
    {
        track.addEventListener('ended', () =>
        {
            this.stream.removeTrack(track);
            if (this.stream.getTracks().length == 0)
            {
                this.ui.localVideo.srcObject = null;
            }
        });
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
            audio: true
        };

        let constraints1080p: MediaStreamConstraints = {
            video: {
                frameRate: 30,
                width: 1920, height: 1080
            },
            audio: true
        };

        let constraints1080p60: MediaStreamConstraints = {
            video: {
                frameRate: 60,
                width: 1920, height: 1080
            },
            audio: true
        };

        let constraints720p: MediaStreamConstraints = {
            video: {
                frameRate: 30,
                width: 1280, height: 720
            },
            audio: true
        };

        let constraints720p60: MediaStreamConstraints = {
            video: {
                frameRate: 60,
                width: 1280, height: 720
            },
            audio: true
        };

        let constraints480p: MediaStreamConstraints = {
            video: {
                frameRate: 30,
                width: 854, height: 480
            },
            audio: true
        };

        let constraints360p: MediaStreamConstraints = {
            video: {
                frameRate: 30,
                width: 640, height: 360
            },
            audio: true
        };

        let constraints240p: MediaStreamConstraints = {
            video: {
                frameRate: 30,
                width: 426, height: 240
            },
            audio: true
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