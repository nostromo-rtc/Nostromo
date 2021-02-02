// Класс для работы с интерфейсом (веб-страница)
export default class UI {
    constructor() {
        // поля
        /** @type {Map<string, HTMLElement | HTMLButtonElement>} */
        this.buttons = new Map(); // кнопки
        this.roomName = document.getElementById('roomName');
        /** @type {HTMLElement | HTMLVideoElement} */
        this.localVideo; // локальное видео
        this.localVideoLabel;
        /** @type {Map<string, HTMLElement | HTMLVideoElement>} */
        this.allVideos = new Map();
        // количество строк и столбцов в раскладке
        this.videoRows = 1;
        this.videoColumns = 2;
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
        document.getElementById("main").style.visibility = 'visible';

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
    setRoomName(roomName) {
        this.roomName.innerText = roomName;
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
        newVideoContainer.classList.add('videoItem');
        let newVideo = document.createElement('video');
        newVideo.id = `remoteVideo-${remoteVideoID}`;
        newVideo.autoplay = true;
        newVideo.muted = this.mutePolicy;
        newVideo.poster = "/img/novideodata.jpg";
        let label = document.createElement('span');
        label.innerText = name;
        label.id = `remoteVideoLabel-${remoteVideoID}`;
        label.classList.add('videoLabel');
        newVideoContainer.appendChild(label);
        newVideoContainer.appendChild(newVideo);
        document.querySelector("#videos").appendChild(newVideoContainer);
        this.allVideos.set(remoteVideoID, newVideo);
        // перестроим раскладку
        this.calculateLayout();
        this.resizeVideos();
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
    removeChatOption(remoteUserID) {
        let chatOption = document.querySelector(`option[value='${remoteUserID}']`);
        if (chatOption) {
            chatOption.remove();
        }
    }
    // удалить видео собеседника (и опцию для чата/файлов тоже)
    removeVideo(remoteVideoID) {
        if (this.allVideos.has(remoteVideoID)) {
            const video = this.allVideos.get(remoteVideoID);
            video.parentElement.remove();
            this.allVideos.delete(remoteVideoID);
            this.removeChatOption(remoteVideoID);
            this.calculateLayout();
            this.resizeVideos();
        }
    }
    // подсчитать количество столбцов и строк в раскладке
    // в зависимости от количества собеседников
    calculateLayout() {
        const videoCount = this.allVideos.size;
        // если количество собеседников превысило размеры сетки раскладки
        if (videoCount > this.videoColumns * this.videoRows) {
            // если количество столбцов не равно количеству строк, значит увеличиваем количество строк
            if (this.videoColumns != this.videoRows) ++this.videoRows;
            else ++this.videoColumns;
        } // пересчитываем сетку и после выхода пользователей
        else if (videoCount < this.videoColumns * this.videoRows) {
            if (this.videoColumns == this.videoRows && (videoCount <= this.videoColumns * (this.videoRows - 1))) --this.videoRows;
            else if (this.videoColumns != this.videoRows && (videoCount <= (this.videoColumns - 1) * this.videoRows)) --this.videoColumns;
        }
    }
    // перестроить раскладку
    resizeVideos() {
        const header_offset = 82.5;
        const nav_offset = 150;
        const offset = 30;
        const aspect_ratio = 16 / 9;
        let h = ((document.documentElement.clientHeight - header_offset) / this.videoRows) - offset;
        let w = ((document.documentElement.clientWidth - nav_offset) / this.videoColumns) - offset;
        for (const videoItem of document.getElementsByClassName('videoItem')) {
            videoItem.style.maxWidth = h * aspect_ratio + "px";
            videoItem.style.flexBasis = w + "px";
        }
    }
    prepareLocalVideo() {
        let localVideoContainer = document.createElement('div');
        localVideoContainer.classList.add('videoItem');
        this.localVideo = document.createElement('video');
        this.localVideo.id = `localVideo`;
        this.localVideo.autoplay = true;
        this.localVideo.muted = true;
        this.localVideo.poster = "/img/novideodata.jpg";
        this.localVideoLabel = document.createElement('span');
        this.localVideoLabel.classList.add('videoLabel');
        localVideoContainer.appendChild(this.localVideoLabel);
        localVideoContainer.appendChild(this.localVideo);
        document.querySelector("#videos").appendChild(localVideoContainer);
        this.allVideos.set('0', this.localVideo);
    }
}