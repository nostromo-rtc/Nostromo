// Класс, получающий медиапотоки пользователя
export default class UserMedia {
    /**
     * @param {import("./UI").default} _UI
     * @param {import("./SocketHandler").default} _parent
     */
    constructor(_UI, _parent) {
        // поля
        this.UI = _UI; // интерфейс
        this.parent = _parent;
        this.stream = new MediaStream();
        this.streamConstraintsMic = {
            audio: true,
            video: false
        };
        this.streamConstraintsCam = {
            audio: false,
            video: true
        };
        this.captureConstraints = new Map();
        // конструктор
        this.UI.buttons.get('getUserMediaMic').addEventListener('click', () => this.getUserMedia_click("audio", this.streamConstraintsMic));
        this.UI.buttons.get('getUserMediaCam').addEventListener('click', () => this.getUserMedia_click("video", this.streamConstraintsCam));
        this.UI.buttons.get('getDisplayMedia').addEventListener('click', () => this.getDisplayMedia_click());
        this.prepareCaptureConstraints();
    }

    getUserMedia_error(error) // -- в случае, если не удалось захватить потоки юзера -- //
    {
        console.log("> getUserMedia_error():", error);
        if (error.name == "NotFoundError") {
            console.log("Webcam or Mic not found.");
        }
    }
    async getUserMedia_click(trackKind, streamConstraints) // -- получение видео (веб-камера) и аудио (микрофон) потоков -- //
    {
        this.UI.showModalWindow("UserMedia");
        try {
            let presentMedia = false;
            for (const oldTrack of this.stream.getTracks()) {
                if (oldTrack.kind == trackKind) {
                    presentMedia = true;
                    oldTrack.stop();
                    this.stream.removeTrack(oldTrack);
                    if (trackKind == "video") {
                        this.UI.localVideo.srcObject = null;
                    }
                }
            }
            let mediaStream = await navigator.mediaDevices.getUserMedia(streamConstraints);
            this.handleMediaInactive(mediaStream.getTracks());
            for (const track of mediaStream.getTracks()) {
                this.stream.addTrack(track);
            }
            console.log("getUserMedia success:", this.stream);
            this.UI.localVideo.srcObject = this.stream; // -- подключаем медиапоток к HTML-элементу <video> (localVideo) -- //
            // обновляем медиапоток в подключении
            if (presentMedia) {
                this.parent.updateMediaStream(trackKind);
            } else {
                this.parent.addNewMediaStream(trackKind);
            }

        } catch (error) {
            this.getUserMedia_error(error); // -- в случае ошибки -- //
        }
    }

    async getDisplayMedia_click() // -- захват видео с экрана юзера -- //
    {
        this.UI.showModalWindow("UserMedia");
        try {
            let presentMedia = false;
            for (const oldTrack of this.stream.getTracks()) {
                if (oldTrack.kind == "video") {
                    presentMedia = true;
                    oldTrack.stop();
                    this.stream.removeTrack(oldTrack);
                    this.UI.localVideo.srcObject = null;
                }
            }
            let mediaStream = await navigator.mediaDevices.getDisplayMedia(this.captureConstraints.get(this.UI.getCaptureSettings()));
            this.handleMediaInactive(mediaStream.getTracks());
            for (const track of mediaStream.getTracks()) {
                this.stream.addTrack(track);
            }
            console.log(this.stream.getTracks());
            console.log("getDisplayMedia success:", this.stream);
            this.UI.localVideo.srcObject = this.stream; // Подключаем медиапоток к HTML-элементу <video>
            // обновляем медиапоток в подключении
            if (presentMedia) {
                this.parent.updateMediaStream('video');
            } else {
                this.parent.addNewMediaStream('video');
            }
        } catch (error) {
            console.log("> getDisplayMedia_error():", error);
        }
    }
    handleMediaInactive(tracks) {
        for (const track of tracks) {
            track.addEventListener('ended', () => {
                this.stream.removeTrack(track);
                if (this.stream.getTracks().length == 0) {
                    this.UI.localVideo.srcObject = null;
                }
            });
        }
    }
    prepareCaptureConstraints() {
        let constraints1080p = {
            video: {
                frameRate: {
                    ideal: 30
                },
                width: 1920,
                height: 1080
            },
            audio: true
        };
        let constraints720p = {
            video: {
                frameRate: {
                    ideal: 30
                },
                width: 1280,
                height: 720
            },
            audio: true
        };
        let constraints360p = {
            video: {
                frameRate: {
                    ideal: 30
                },
                width: 640,
                height: 360
            },
            audio: true
        };
        this.captureConstraints.set('360p', constraints360p);
        this.captureConstraints.set('720p', constraints720p);
        this.captureConstraints.set('default', constraints720p);
        this.captureConstraints.set('1080p', constraints1080p);
    }
}