// Класс для работы с интерфейсом (веб-страница)
export default class UI {
    constructor() {
        // поля
        /** @type {Map<string, HTMLElement | HTMLButtonElement>} */
        this.buttons = new Map(); // кнопки
        /** @type {HTMLElement | HTMLVideoElement} */
        this.localVideo; // локальное видео
        this.localVideoLabel;
        /** @type {HTMLElement | HTMLVideoElement} */
        this.remoteVideo; // видео собеседника
        /** @type {Map<number, HTMLElement | HTMLVideoElement>} */
        this.allVideos = new Map();
        this.afterConnectSection = document.getElementById('afterConnectSection'); // секция с чатом и выбором файла для передачи
        /// чат
        /** @type {HTMLElement | HTMLTextAreaElement} */
        this.chat = document.getElementById('chat');
        /** @type {HTMLElement | HTMLInputElement} */
        this.messageText = document.getElementById('messageText'); // сообщение пользователя, отправляемое собеседнику
        /// файлы
        this.fileInput = document.getElementById('fileInput');
        /** @type {HTMLElement | HTMLAnchorElement} */
        this.downloadAnchor = document.getElementById('download');
        /** @type {HTMLElement | HTMLProgressElement} */
        this.receiveProgress = document.getElementById('receiveProgress');
        this.captureSettings = document.querySelector("#captureSettings");
        this.chatOptions = document.querySelector("#chatOptions");
        this.usernameInput = document.querySelector("#usernameInput");
        this.mutePolicy = true;
        // конструктор, т.е функции ниже вызываются при создания объекта UI
        console.debug("UI ctor");
        this.prepareButtons();
        this.prepareCloseButtonsForModalsWindows();
        this.prepareLocalVideo();
        window.addEventListener('resize', () => this.resizeVideos());
        this.buttons.get('enableSounds').addEventListener('click', () => this.enableSounds());
        this.showUserName();

    }
    showModalWindow(modalWindowName) {
        document.getElementById(`modalWindow_${modalWindowName}`).style.display = "block"; // показываем модальное окно с инструкцией
    }
    prepareButtons() {
        this.buttons.set('getUserMediaMic', document.getElementById('btn_getUserMediaMic'));
        this.buttons.set('getUserMediaCam', document.getElementById('btn_getUserMediaCam'));
        this.buttons.set('getDisplayMedia', document.getElementById('btn_getDisplayMedia'));
        this.buttons.set('sendMessage', document.getElementById('btn_sendMessage'));
        this.buttons.set('sendFile', document.getElementById('btn_sendFile'));
        this.buttons.set('enableSounds', document.getElementById('btn_enableSounds'));
        this.buttons.set('setNewUsername', document.getElementById('btn_setNewUsername'));
    }
    setNewUsername() {
        localStorage["username"] = this.usernameInput.value;
        this.showUserName();
    }
    showUserName() {
        if (localStorage["username"] == undefined) localStorage["username"] = "noname";
        this.usernameInput.value = localStorage["username"];
        this.localVideoLabel.innerText = localStorage["username"];
    }
    prepareCloseButtonsForModalsWindows() {
        // -- для модального окна, обрабатываем закрытие окон на кнопку "X" -- //
        const btn_close_list = document.getElementsByClassName("close");
        for (let btn of btn_close_list) {
            btn.addEventListener('click', () => {
                btn.parentElement.parentElement.style.display = "none";
            });
        }
    }
    getCaptureSettings() {
        return this.captureSettings.value;
    }
    getChatOption() {
        return this.chatOptions.value;
    }
    enableSounds() {
        for (const video of this.allVideos.values()) {
            if (video != this.localVideo) {
                video.muted = false;
            }
        }
        this.mutePolicy = false;
    }
    addVideo(remoteVideoID, name) {
        let newVideoContainer = document.createElement('div');
        newVideoContainer.style.position = "relative";
        newVideoContainer.style.display = "inline-block";
        let newVideo = document.createElement('video');
        newVideo.id = `remoteVideo-${remoteVideoID}`;
        newVideo.autoplay = true;
        newVideo.muted = this.mutePolicy;
        newVideo.poster = "/img/novideodata.jpg";
        let label = document.createElement('span');
        label.innerText = name;
        label.id = `remoteVideoLabel-${remoteVideoID}`
        label.setAttribute('style', 'position: absolute; background-color: lightgrey; right: 0; padding: 5px; font-size: 35px; border: 1px solid black;');
        newVideoContainer.appendChild(label);
        newVideoContainer.appendChild(newVideo);
        document.querySelector("#videos").appendChild(newVideoContainer);
        this.allVideos.set(remoteVideoID, newVideo);
        this.remoteVideo = newVideo;
    }

    updateVideoLabel(remoteVideoID, name) {
        document.querySelector(`#remoteVideoLabel-${remoteVideoID}`).innerText = name;
    }
    updateChatOption(remoteUserID, name) {
        let chatOption = document.querySelector(`option[value='${remoteUserID}']`);
        chatOption.innerText = `собеседник ${name}`;
    }

    addChatOption(remoteUserID, remoteUsername) {
        let newChatOption = document.createElement('option');
        newChatOption.value = remoteUserID;
        newChatOption.innerText = `собеседник ${remoteUsername}`;
        this.chatOptions.appendChild(newChatOption);
    }
    // удалить видео собеседника (и опцию для чата/файлов тоже)
    removeVideo(remoteVideoID) {
        this.allVideos.delete(remoteVideoID);
        let video = document.querySelector(`#remoteVideo-${remoteVideoID}`);
        if (video != null) {
            video.parentElement.remove();
            let chatOption = document.querySelector(`option[value='${remoteVideoID}']`);
            if (chatOption != null) {
                chatOption.remove();
            }

        }
    }
    resizeVideos() {
        let w = (document.body.clientWidth - 300) / 2;
        if (this.allVideos != undefined && this.allVideos.size > 0) {
            for (const video of this.allVideos.values()) {
                video.style.width = w + "px";
                video.style.height = w * 9 / 16 + "px";
            }
        }
    }
    prepareLocalVideo() {
        let localVideoContainer = document.createElement('div');
        localVideoContainer.style.position = "relative";
        localVideoContainer.style.display = "inline-block";
        this.localVideo = document.createElement('video');
        this.localVideo.id = `localVideo`;
        this.localVideo.autoplay = true;
        this.localVideo.muted = true;
        this.localVideo.poster = "/img/novideodata.jpg";
        this.localVideoLabel = document.createElement('span');
        this.localVideoLabel.innerText = "Я - ";
        this.localVideoLabel.setAttribute('style', 'position: absolute; background-color: lightgrey; right: 0; padding: 5px; font-size: 35px; border: 1px solid black;');
        localVideoContainer.appendChild(this.localVideoLabel);
        localVideoContainer.appendChild(this.localVideo);
        document.querySelector("#videos").appendChild(localVideoContainer);
        this.allVideos.set(0, this.localVideo);
        this.resizeVideos();
    }
}