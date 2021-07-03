import UI from "./UI";
import SocketHandler from "./SocketHandler";

// Класс, получающий медиапотоки пользователя
export default class UserMedia
{
    private ui: UI;
    private parent: SocketHandler;

    private stream = new MediaStream();
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
            let presentMedia = false;
            for (const oldTrack of this.stream.getTracks())
            {
                if (oldTrack.kind == trackKind)
                {
                    presentMedia = true;
                    oldTrack.stop();
                    this.stream.removeTrack(oldTrack);
                    if (trackKind == "video")
                    {
                        this.UI.localVideo.srcObject = null;
                    }
                }
            }
            let mediaStream = await navigator.mediaDevices.getUserMedia(streamConstraints);
            this.handleMediaInactive(mediaStream.getTracks());
            for (const track of mediaStream.getTracks())
            {
                this.stream.addTrack(track);
            }
            console.debug("getUserMedia success:", this.stream);
            this.UI.localVideo.srcObject = this.stream; // -- подключаем медиапоток к HTML-элементу <video> (localVideo) -- //
            // обновляем медиапоток в подключении
            if (presentMedia)
            {
                this.parent.updateMediaStream(trackKind);
            } else
            {
                this.parent.addNewMediaStream(trackKind);
            }
        } catch (error)
        {
            this.getUserMedia_error(error); // -- в случае ошибки -- //
        }
    }

    async getDisplayMedia_click() // -- захват видео с экрана юзера -- //
    {
        try
        {
            let presentVideo = false;
            // проверяем, было ли видео от нас до этого
            if (this.stream.getVideoTracks().length == 1)
            {
                presentVideo = true;
                const oldTrack = this.stream.getVideoTracks()[0];
                oldTrack.stop();
                this.stream.removeTrack(oldTrack);
                this.UI.localVideo.srcObject = null;
            }
            // захват экрана
            let mediaStream = await navigator.mediaDevices.getDisplayMedia(this.captureConstraints.get(this.UI.getCaptureSettings()));
            // добавляем видеодорожку
            this.stream.addTrack(mediaStream.getVideoTracks()[0]);
            // если захват экрана со звуком
            if (mediaStream.getAudioTracks().length == 1)
            {
                // если до этого от нас был звук
                let presentAudio = false;
                if (this.stream.getAudioTracks().length == 1)
                {
                    presentAudio = true;
                    const oldAudioTrack = this.stream.getAudioTracks()[0];
                    oldAudioTrack.stop();
                    this.stream.removeTrack(oldAudioTrack);
                }
                this.stream.addTrack(mediaStream.getAudioTracks()[0]);

                if (!presentAudio && !presentVideo)
                {
                    this.parent.addNewMediaStream('both');
                }
                else
                {
                    if (presentAudio)
                    {
                        this.parent.updateMediaStream('audio');
                    }
                    else
                    {
                        this.parent.addNewMediaStream('audio');
                    }

                    if (presentVideo)
                    {
                        this.parent.updateMediaStream('video');
                    } else
                    {
                        this.parent.addNewMediaStream('video');
                    }
                }
            }
            // если захват экрана без звука
            else
            {
                // обновляем видеопоток в подключении
                if (presentVideo)
                {
                    this.parent.updateMediaStream('video');
                } else
                {
                    this.parent.addNewMediaStream('video');
                }
            }
            this.handleMediaInactive(this.stream.getTracks());
            console.debug("getDisplayMedia success:", this.stream);
            this.UI.localVideo.srcObject = this.stream; // Подключаем медиапоток к HTML-элементу <video>
        } catch (error)
        {
            console.error("> getDisplayMedia_error():", error);
        }
    }
    private handleMediaInactive(tracks: MediaStreamTrack[])
    {
        for (const track of tracks)
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
    }
    private prepareCaptureConstraints(): Map<string, MediaStreamConstraints>
    {
        let _constraints = new Map<string, MediaStreamConstraints>();

        let constraints2560p: MediaStreamConstraints = {
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

        _constraints.set('2560p', constraints2560p);
        _constraints.set('1080p', constraints1080p);
        _constraints.set('1080p@60', constraints1080p60);
        _constraints.set('720p', constraints720p);
        _constraints.set('720p@60', constraints720p60);
        _constraints.set('480p', constraints480p);
        _constraints.set('360p', constraints360p);
        _constraints.set('240p', constraints240p);
        _constraints.set('default', constraints720p);

        return _constraints;
    }
}