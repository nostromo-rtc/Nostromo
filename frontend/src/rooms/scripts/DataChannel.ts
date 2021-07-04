import UI from "./UI.js";
import PeerConnection from './PeerConnection.js';

enum ReceivedDataType
{
    description, // описания типа файла
    size,        // размер файла
    file         // сам файл
}

// Класс, определяющий функции для передачи файлов и текста
export default class DataChannel
{
    private ui: UI;
    private parent: PeerConnection;

    private messageDc = new RTCDataChannel();

    private fileDc = new RTCDataChannel();
    private receiveBuffer = new Array<ArrayBuffer>();
    private receivedSize: number = 0;
    private fileSize: number = 0;

    private _isCreated: boolean = false;
    public get isCreated(): boolean { return this._isCreated; }
    public set isCreated(flag: boolean) { this._isCreated = flag; }

    private receivedDataType = ReceivedDataType.description;

    constructor(_ui: UI, _parent: PeerConnection)
    {
        this.ui = _ui;
        this.parent = _parent;

        console.debug("DataChannel ctor");
    }

    public createMessageDc(channel: RTCDataChannel): void
    {
        this.messageDc = channel;
        this.messageDc.binaryType = 'arraybuffer';
        this.messageDc.addEventListener('message', (event: MessageEvent) => this.receiveMessage(event));
    }

    public createFileDc(channel: RTCDataChannel): void
    {
        this.fileDc = channel;
        this.fileDc.binaryType = 'arraybuffer';
        this.fileDc.addEventListener('message', (event: MessageEvent) => this.receiveFile(event));
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

    public sendMessage(): void
    {
        const message: string = this.ui.messageText.value.trim();
        if (message.length > 0)
        {
            const timestamp: string = this.getTimestamp();
            this.ui.chat.innerHTML += "[" + timestamp + "] " + "Я: " + message + "\n";
            this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
            this.messageDc.send(message);
        }
    }

    private receiveMessage(event: MessageEvent): void
    {
        const timestamp: string = this.getTimestamp();
        this.ui.chat.innerHTML += `[${timestamp}] (ЛС) Собеседник ${this.parent.socketSettings.remoteUsername}: ${event.data}` + "\n";
        this.ui.chat.scrollTop = this.ui.chat.scrollHeight;
    }

    public sendFile(): void
    {
        const file: (File | undefined | null) = this.ui.fileInput?.files?.item(0);
        if (file)
        {
            console.log("> Отправляем файл", file.name, file.size);
            this.fileDc.send(file.name); // отправляем имя+расширение файла
            this.fileDc.send(file.size.toString()); // отправляем размер файла
            const chunkSize: number = 16 * 1024;

            let fileReader = new FileReader();

            const readSlice = (pos: number) =>
            {
                const slice: Blob = file.slice(pos, pos + chunkSize);
                fileReader.readAsArrayBuffer(slice);
            };

            let offset = 0;
            fileReader.addEventListener('load', (e: ProgressEvent<FileReader>) =>
            {
                if (e.target)
                {
                    this.fileDc.send(e.target.result as ArrayBuffer);
                    offset += (e.target.result as ArrayBuffer).byteLength;
                    if (offset < file.size) readSlice(offset);
                }
            });

            readSlice(0); // отправляем сам файл
            console.log("Файл был отправлен");
        }
    }

    private receiveFile(event: MessageEvent): void
    {
        if (this.receivedDataType == ReceivedDataType.description)
        {
            this.ui.downloadLink.download = event.data as string;
            this.ui.receiveProgress.hidden = false;
            this.receivedDataType = ReceivedDataType.size;
        }
        else if (this.receivedDataType == ReceivedDataType.size)
        {
            this.fileSize = Number(event.data as string);
            console.log("Размер принимаемого файла: ", this.fileSize);
            this.ui.receiveProgress.max = this.fileSize;
            this.receivedDataType = ReceivedDataType.file;
        }
        else
        {
            this.receiveBuffer.push(event.data as ArrayBuffer);
            this.receivedSize += (event.data as ArrayBuffer).byteLength;
            this.ui.receiveProgress.value = this.receivedSize;
            if (this.receivedSize == this.fileSize)
            {
                const received = new Blob(this.receiveBuffer);

                this.ui.downloadLink.href = URL.createObjectURL(received);
                this.ui.downloadLink.textContent = "Нажмите чтобы скачать файл " + this.ui.downloadLink.download;
                this.ui.downloadLink.style.display = 'block';

                this.receiveBuffer = Array<ArrayBuffer>();
                this.receivedSize = 0;
                this.ui.receiveProgress.value = 0;
                this.ui.receiveProgress.hidden = true;

                this.receivedDataType = ReceivedDataType.description;
            }
        }
    }

}