// Класс для работы с интерфейсом (веб-страница)
export default class UI {
    // кнопки
    private _buttons : Map<string, HTMLButtonElement> = this.prepareButtons();
    // название комнаты
    private roomName = document.getElementById('roomName') as HTMLSpanElement;
    // метка локального видео
    private localVideoLabel: HTMLSpanElement;
    // контейнер с видеоэлементами
    private _allVideos = new Map<string, HTMLVideoElement>();
    // чат
    private chat = document.getElementById('chat') as HTMLTextAreaElement;
    // выбор собеседника-адресата
    private chatOptions = document.getElementById('chatOptions') as HTMLSelectElement;
    // сообщение пользователя, отправляемое собеседнику
    private messageText = document.getElementById('messageText') as HTMLTextAreaElement;
    // поле для выбора файла для отправления
    private fileInput = document.getElementById('fileInput') as HTMLInputElement;
    // ссылка на скачивание файла
    private downloadLink = document.getElementById('downloadLink') as HTMLAnchorElement;
    // прогресс скачивания
    private receiveProgress = document.getElementById('receiveProgress') as HTMLProgressElement;
    // настройки захвата видео
    private captureSettings = document.getElementById('captureSettings') as HTMLSelectElement;
    // поле для ввода имени пользователя
    private usernameInput = document.getElementById('usernameInput') as HTMLInputElement;
    // количество строк и столбцов в раскладке
    private videoRows = 2;
    private videoColumns = 2;
    // текущая политика Mute для видео (свойство muted)
    private mutePolicy = true;

    constructor() {
        console.debug('UI ctor');
        this.prepareLocalVideo();
        this.prepareMessageText();
        this.resizeVideos();
        window.addEventListener('resize', () => this.resizeVideos());
        this._buttons.get('enableSounds').addEventListener('click', () => this.enableSounds());
        this.showUserName();
    }

    public get buttons() : Map<string, HTMLButtonElement>
    {
        return this._buttons;
    }

    public get allVideos() : Map<string, HTMLVideoElement>
    {
        return this._allVideos;
    }

    private prepareButtons(): Map<string, HTMLButtonElement> {
        let buttons = new Map<string, HTMLButtonElement>();

        buttons.set('getUserMediaMic', document.getElementById('btn_getUserMediaMic')  as HTMLButtonElement);
        buttons.set('getUserMediaCam', document.getElementById('btn_getUserMediaCam')  as HTMLButtonElement);
        buttons.set('getDisplayMedia', document.getElementById('btn_getDisplayMedia')  as HTMLButtonElement);
        buttons.set('sendMessage',     document.getElementById('btn_sendMessage')      as HTMLButtonElement);
        buttons.set('sendFile',        document.getElementById('btn_sendFile')         as HTMLButtonElement);
        buttons.set('enableSounds',    document.getElementById('btn_enableSounds')     as HTMLButtonElement);
        buttons.set('setNewUsername',  document.getElementById('btn_setNewUsername')   as HTMLButtonElement);

        return buttons;
    }

    private prepareMessageText(): void {
        this.messageText.addEventListener('keydown', (e) => {
            if (e.key == 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._buttons.get('sendMessage').click();
                this.messageText.value = '';
            };
        });
    }
    private setNewUsername(): void {
        localStorage['username'] = this.usernameInput.value;
        this.showUserName();
    }
    private showUserName(): void {
        if (localStorage['username'] == undefined) localStorage['username'] = 'noname';
        this.usernameInput.value = localStorage['username'];
        this.localVideoLabel.innerText = localStorage['username'];
    }
    private setRoomName(roomName: string): void {
        this.roomName.innerText = roomName;
    }
    private getCaptureSettings(): string {
        return this.captureSettings.value;
    }
    public getChatOption(): string {
        return this.chatOptions.value;
    }
    // включить звук для всех видео
    private enableSounds(): void {
        for (const video of this._allVideos) {
            if (video[0] != 'localVideo') {
                video[1].muted = false;
            }
        }
        this.mutePolicy = false;
    }
    // добавить новый видеоэлемент собеседника
    private addVideo(remoteVideoID: string, name: string): void {
        let newVideoItem = document.createElement('div');
        newVideoItem.classList.add('videoItem');

        let newVideoContainer = document.createElement('div');
        newVideoContainer.classList.add('videoContainer');
        newVideoItem.appendChild(newVideoContainer);

        let newVideo = document.createElement('video');
        newVideo.id = `remoteVideo-${remoteVideoID}`;
        newVideo.autoplay = true;
        newVideo.muted = this.mutePolicy;
        newVideo.poster = './images/novideodata.jpg';
        newVideoContainer.appendChild(newVideo);

        let videoLabel = document.createElement('span');
        videoLabel.classList.add('videoLabel');
        videoLabel.innerText = name;
        videoLabel.id = `remoteVideoLabel-${remoteVideoID}`;
        newVideo.appendChild(videoLabel);

        document.getElementById('videos').appendChild(newVideoItem);
        this._allVideos.set(remoteVideoID, newVideo);

        // перестроим раскладку
        this.calculateLayout();
        this.resizeVideos();
    }
    // обновления метки видеоэлемента собеседника
    private updateVideoLabel(remoteVideoID: string, newName: string): void {
        document.getElementById(`remoteVideoLabel-${remoteVideoID}`).innerText = newName;
    }
    // изменить элемент выбора собеседника-адресата в виджете chatOption
    private updateChatOption(remoteUserID: string, name: string): void {
        let chatOption = document.querySelector(`option[value='${remoteUserID}']`) as HTMLOptionElement;
        if (chatOption) chatOption.innerText = `собеседник ${name}`;
    }
    // добавить выбор собеседника-адресата в виджет chatOption
    private addChatOption(remoteUserID: string, remoteUsername: string): void {
        let newChatOption = document.createElement('option') as HTMLOptionElement;
        newChatOption.value = remoteUserID;
        newChatOption.innerText = `собеседник ${remoteUsername}`;
        this.chatOptions.appendChild(newChatOption);
    }
    // удалить выбор собеседника-адресата из виджета chatOption
    private removeChatOption(remoteUserID: string): void {
        let chatOption = document.querySelector(`option[value='${remoteUserID}']`) as HTMLOptionElement;
        if (chatOption) chatOption.remove();
    }
    // удалить видео собеседника (и опцию для чата/файлов тоже)
    private removeVideo(remoteVideoID: string): void {
        if (this._allVideos.has(remoteVideoID)) {
            const video = this._allVideos.get(remoteVideoID);
            video.parentElement.parentElement.remove(); // video > videoContainer > videoItem.remove()
            this._allVideos.delete(remoteVideoID);
            this.removeChatOption(remoteVideoID);
            this.calculateLayout();
            this.resizeVideos();
        }
    }
    // подсчитать количество столбцов и строк в раскладке
    // в зависимости от количества собеседников
    private calculateLayout(): void {
        const videoCount = this._allVideos.size;
        // если только 1 видео на экране
        if (videoCount == 1) {
            this.videoRows = 2;
            this.videoColumns = 2;
        } // если количество собеседников превысило размеры сетки раскладки
        else if (videoCount > this.videoColumns * this.videoRows) {
            // если количество столбцов не равно количеству строк, значит увеличиваем количество строк
            if (this.videoColumns != this.videoRows) ++this.videoRows;
            // иначе увеличиваем количество столбцов
            else ++this.videoColumns;
        } // пересчитываем сетку и после выхода пользователей
        else if (videoCount < this.videoColumns * this.videoRows) {
            if (this.videoColumns == this.videoRows &&
                (videoCount <= this.videoColumns * (this.videoRows - 1))) { --this.videoRows; }
            else if (this.videoColumns != this.videoRows &&
                (videoCount <= (this.videoColumns - 1) * this.videoRows)) { --this.videoColumns; }
        }
    }
    // перестроить раскладку
    private resizeVideos(): void {
        const header_offset = 82.5;
        const nav_offset    = 150;
        const offset        = 30;
        const aspect_ratio  = 16 / 9;
        // max_h для регулирования размеров видео, чтобы оно вмещалось в videoRows (количество) строк
        let max_h = ((document.documentElement.clientHeight - header_offset) / this.videoRows) - offset;
        let flexBasis = ((document.documentElement.clientWidth - nav_offset) / this.videoColumns) - offset;
        for (const videoItem of document.getElementsByClassName('videoItem')) {
            (videoItem as HTMLDivElement).style.maxWidth = max_h * aspect_ratio + 'px';
            (videoItem as HTMLDivElement).style.flexBasis = flexBasis + 'px';
        }
    }
    // подготовить локальный видеоэлемент
    private prepareLocalVideo(): void {
        let localVideoItem = document.createElement('div');
        localVideoItem.classList.add('videoItem');

        let localVideoContainer = document.createElement('div');
        localVideoContainer.classList.add('videoContainer');
        localVideoItem.appendChild(localVideoContainer);

        let localVideo = document.createElement('video');
        localVideo.id = `localVideo`;
        localVideo.autoplay = true;
        localVideo.muted = true;
        localVideo.poster = './images/novideodata.jpg';
        localVideoContainer.appendChild(localVideo);

        this.localVideoLabel = document.createElement('span');
        this.localVideoLabel.classList.add('videoLabel');
        localVideo.appendChild(this.localVideoLabel);

        document.getElementById('videos').appendChild(localVideoItem);
        this._allVideos.set('localVideo', localVideo);
    }
}