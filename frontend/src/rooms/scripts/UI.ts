// Класс для работы с интерфейсом (веб-страница)
export default class UI
{
    // кнопки
    private _buttons: Map<string, HTMLButtonElement> = this.prepareButtons();
    public get buttons(): Map<string, HTMLButtonElement> { return this._buttons; }

    // название комнаты
    private _roomName = document.getElementById('roomName') as HTMLSpanElement;
    public get roomName(): string { return this._roomName.innerText; }
    public set roomName(name: string) { this._roomName.innerText = name; }

    // метка локального видео
    private localVideoLabel: HTMLSpanElement = this.prepareLocalVideoLabel();

    // контейнер с видеоэлементами
    private _allVideos = new Map<string, HTMLVideoElement>();
    public get allVideos(): Map<string, HTMLVideoElement> { return this._allVideos; }
    public get localVideo() { return this._allVideos.get('localVideo'); }

    // чат
    private _chat = document.getElementById('chat') as HTMLTextAreaElement;
    public get chat() { return this._chat; }

    // выбор собеседника-адресата
    private chatOptions = document.getElementById('chatOptions') as HTMLSelectElement;
    public get currentChatOption(): string { return this.chatOptions.value; }

    // сообщение пользователя, отправляемое собеседнику
    private _messageText = document.getElementById('messageText') as HTMLTextAreaElement;
    public get messageText() { return this._messageText; }

    // поле для выбора файла для отправления
    private _fileInput = document.getElementById('fileInput') as HTMLInputElement;
    public get fileInput() { return this._fileInput; }

    // ссылка на скачивание файла
    private _downloadLink = document.getElementById('downloadLink') as HTMLAnchorElement;
    public get downloadLink() { return this._downloadLink; }

    // прогресс скачивания
    private _receiveProgress = document.getElementById('receiveProgress') as HTMLProgressElement;
    public get receiveProgress() { return this._receiveProgress; }

    // настройки захвата видео
    private captureSettings = document.getElementById('captureSettings') as HTMLSelectElement;
    public get currentCaptureSetting(): string { return this.captureSettings.value; }

    // поле для ввода имени пользователя
    private _usernameInput = document.getElementById('usernameInput') as HTMLInputElement;
    public get usernameInputValue() : string { return this._usernameInput.value; }

    // количество строк и столбцов в раскладке
    private videoRows = 2;
    private videoColumns = 2;

    // текущая политика Mute для видео (свойство muted)
    private mutePolicy = true;

    constructor()
    {
        console.debug('UI ctor');
        this.prepareLocalVideo();
        this.prepareMessageText();
        this.resizeVideos();
        window.addEventListener('resize', () => this.resizeVideos());
        this._buttons.get('enableSounds')!.addEventListener('click', () => this.enableSounds());
        this.showUserName();
    }

    public addCaptureSetting(label: string, value: string): void
    {
        let newSetting = new Option(label, value);
        this.captureSettings.add(newSetting);
    }

    private prepareButtons(): Map<string, HTMLButtonElement>
    {
        let buttons = new Map<string, HTMLButtonElement>();

        buttons.set('getUserMediaMic',  document.getElementById('btn_getUserMediaMic')  as HTMLButtonElement);
        buttons.set('getUserMediaCam',  document.getElementById('btn_getUserMediaCam')  as HTMLButtonElement);
        buttons.set('getDisplayMedia',  document.getElementById('btn_getDisplayMedia')  as HTMLButtonElement);
        buttons.set('sendMessage',      document.getElementById('btn_sendMessage')      as HTMLButtonElement);
        buttons.set('sendFile',         document.getElementById('btn_sendFile')         as HTMLButtonElement);
        buttons.set('enableSounds',     document.getElementById('btn_enableSounds')     as HTMLButtonElement);
        buttons.set('setNewUsername',   document.getElementById('btn_setNewUsername')   as HTMLButtonElement);

        return buttons;
    }

    private prepareMessageText(): void
    {
        this.messageText.addEventListener('keydown', (e) =>
        {
            if (e.key == 'Enter' && !e.shiftKey)
            {
                e.preventDefault();
                this._buttons.get('sendMessage')!.click();
                this.messageText.value = '';
            };
        });
    }

    public setNewUsername(): void
    {
        localStorage['username'] = this._usernameInput.value;
        this.showUserName();
    }

    private showUserName(): void
    {
        if (localStorage['username'] == undefined) localStorage['username'] = 'noname';
        this._usernameInput.value = localStorage['username'];
        this.localVideoLabel.innerText = localStorage['username'];
    }

    // включить звук для всех видео
    private enableSounds(): void
    {
        for (const video of this._allVideos)
        {
            if (video[0] != 'localVideo')
            {
                video[1].muted = false;
            }
        }
        this.mutePolicy = false;
    }

    // добавить новый видеоэлемент собеседника
    public addVideo(remoteVideoID: string, name: string): void
    {
        let newVideoItem = document.createElement('div');
        newVideoItem.classList.add('videoItem');

        let newVideoContainer = document.createElement('div');
        newVideoContainer.classList.add('videoContainer');
        newVideoItem.appendChild(newVideoContainer);

        let videoLabel = document.createElement('span');
        videoLabel.classList.add('videoLabel');
        videoLabel.innerText = name;
        videoLabel.id = `remoteVideoLabel-${remoteVideoID}`;
        newVideoItem.appendChild(videoLabel);

        let newVideo = document.createElement('video');
        newVideo.id = `remoteVideo-${remoteVideoID}`;
        newVideo.autoplay = true;
        newVideo.muted = this.mutePolicy;
        newVideo.poster = './images/novideodata.jpg';
        newVideoContainer.appendChild(newVideo);

        document.getElementById('videos')!.appendChild(newVideoItem);
        this._allVideos.set(remoteVideoID, newVideo);

        // перестроим раскладку
        this.calculateLayout();
        this.resizeVideos();
    }

    // обновления метки видеоэлемента собеседника
    public updateVideoLabel(remoteVideoID: string, newName: string): void
    {
        document.getElementById(`remoteVideoLabel-${remoteVideoID}`)!.innerText = newName;
    }

    // изменить элемент выбора собеседника-адресата в виджете chatOption
    public updateChatOption(remoteUserID: string, name: string): void
    {
        let chatOption = document.querySelector(`option[value='${remoteUserID}']`) as HTMLOptionElement;
        if (chatOption) chatOption.innerText = `собеседник ${name}`;
    }

    // добавить выбор собеседника-адресата в виджет chatOption
    public addChatOption(remoteUserID: string, remoteUsername: string): void
    {
        let newChatOption = new Option(`собеседник ${remoteUsername}`, remoteUserID);
        this.chatOptions.appendChild(newChatOption);
    }

    // удалить выбор собеседника-адресата из виджета chatOption
    public removeChatOption(remoteUserID: string): void
    {
        let chatOption = document.querySelector(`option[value='${remoteUserID}']`) as HTMLOptionElement;
        if (chatOption) chatOption.remove();
    }

    // удалить видео собеседника (и опцию для чата/файлов тоже)
    public removeVideo(remoteVideoID: string): void
    {
        if (this._allVideos.has(remoteVideoID))
        {
            const video = this._allVideos.get(remoteVideoID)!;
            video.parentElement!.parentElement!.remove(); // video > videoContainer > videoItem.remove()
            this._allVideos.delete(remoteVideoID);
            this.removeChatOption(remoteVideoID);
            this.calculateLayout();
            this.resizeVideos();
        }
    }

    // подсчитать количество столбцов и строк в раскладке
    // в зависимости от количества собеседников
    private calculateLayout(): void
    {
        const videoCount = this._allVideos.size;
        // если только 1 видео на экране
        if (videoCount == 1)
        {
            this.videoRows = 2;
            this.videoColumns = 2;
        } // если количество собеседников превысило размеры сетки раскладки
        else if (videoCount > this.videoColumns * this.videoRows)
        {
            // если количество столбцов не равно количеству строк, значит увеличиваем количество строк
            if (this.videoColumns != this.videoRows) ++this.videoRows;
            // иначе увеличиваем количество столбцов
            else ++this.videoColumns;
        } // пересчитываем сетку и после выхода пользователей
        else if (videoCount < this.videoColumns * this.videoRows)
        {
            if (this.videoColumns == this.videoRows &&
                (videoCount <= this.videoColumns * (this.videoRows - 1))) { --this.videoRows; }
            else if (this.videoColumns != this.videoRows &&
                (videoCount <= (this.videoColumns - 1) * this.videoRows)) { --this.videoColumns; }
        }
    }

    // перестроить раскладку
    private resizeVideos(): void
    {
        const header_offset = 82.5;
        const nav_offset    = 150;
        const offset        = 30;
        const aspect_ratio  = 16 / 9;
        // max_h для регулирования размеров видео, чтобы оно вмещалось в videoRows (количество) строк
        let max_h = ((document.documentElement.clientHeight - header_offset) / this.videoRows) - offset;
        let flexBasis = ((document.documentElement.clientWidth - nav_offset) / this.videoColumns) - offset;
        for (const videoItem of document.getElementsByClassName('videoItem'))
        {
            (videoItem as HTMLDivElement).style.maxWidth = max_h * aspect_ratio + 'px';
            (videoItem as HTMLDivElement).style.flexBasis = flexBasis + 'px';
        }
    }

    // подготовить локальный видеоэлемент
    private prepareLocalVideo(): void
    {
        let localVideoItem = document.createElement('div');
        localVideoItem.classList.add('videoItem');

        let localVideoContainer = document.createElement('div');
        localVideoContainer.classList.add('videoContainer');
        localVideoItem.appendChild(localVideoContainer);
        localVideoItem.appendChild(this.localVideoLabel);

        let localVideo = document.createElement('video');
        localVideo.id = `localVideo`;
        localVideo.autoplay = true;
        localVideo.muted = true;
        localVideo.poster = './images/novideodata.jpg';
        localVideoContainer.appendChild(localVideo);

        document.getElementById('videos')!.appendChild(localVideoItem);
        this._allVideos.set('localVideo', localVideo);
    }

    private prepareLocalVideoLabel() : HTMLSpanElement
    {
        let label = document.createElement('span');
        label.classList.add('videoLabel');
        return label;
    }
}