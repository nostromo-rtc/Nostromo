// Класс, определяющий функции для передачи файлов и текста
export default class DataChannel {
    /**
     * @param {import("./UI").default} _UI
     */
    constructor(_UI, _parent) {
        this.UI = _UI;
        this.parent = _parent;
        this.message_dc = null;
        this.file_dc = null;
        this.receiveBuffer = [];
        this.isFileOrFileDesc = 0; // 0 если file desc, 1 если размер файла, 2 если сам файл
        this.receivedSize = 0;
        this.fileSize = 0;
        // конструктор
        console.debug("DataChannel ctor");
    }

    getTimestamp() {
        let timestamp = (new Date).toLocaleString("en-us", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        });
        return timestamp;
    }

    sendMessage() {
        if (this.UI.messageText.value) {
            let timestamp = this.getTimestamp();
            this.UI.chat.innerHTML += "[" + timestamp + "] " + "Я: " + this.UI.messageText.value + "\n";
            this.message_dc.send(this.UI.messageText.value);
            this.UI.messageText.value = "";
        }
    }

    receiveMessage(event) {
        let timestamp = this.getTimestamp();
        this.UI.chat.innerHTML += "[" + timestamp + "] " + `(ЛС) Собеседник${this.parent.socketSettings.remoteUserID}: ` + event.data + "\n";
    }

    sendFile() {
        const file = this.UI.fileInput.files[0];
        if (file) {
            console.log("Отправляем файл", file.name, file.size);
            this.file_dc.send(file.name); // отправляем имя+расширение файла
            this.file_dc.send(file.size); // отправляем размер файла
            const chunkSize = 16376;
            let offset = 0;
            let fileReader = new FileReader();
            fileReader.addEventListener('load', e => {
                this.file_dc.send(e.target.result);
                offset += e.target.result.byteLength;
                if (offset < file.size) {
                    readSlice(offset);
                }
            });
            const readSlice = o => {
                const slice = file.slice(offset, o + chunkSize);
                fileReader.readAsArrayBuffer(slice);
            };
            readSlice(0); // отправляем сам файл
            console.log("Файл был отправлен");
        }
    }

    receiveFile(event) {
        if (this.isFileOrFileDesc == 0) {
            this.isFileOrFileDesc = 1;
            this.UI.downloadAnchor.download = event.data;
            this.UI.receiveProgress.hidden = false;
        } else if (this.isFileOrFileDesc == 1) {
            this.fileSize = event.data;
            console.log("Размер принимаемого файла: ", this.fileSize);
            this.UI.receiveProgress.max = Number(this.fileSize);
            this.isFileOrFileDesc = 2;
        } else {
            this.receiveBuffer.push(event.data);
            this.receivedSize += event.data.byteLength;
            this.UI.receiveProgress.value = Number(this.receivedSize);
            if (this.receivedSize == this.fileSize) {
                const received = new Blob(this.receiveBuffer);
                this.receiveBuffer = [];
                this.receivedFile = 0;
                this.receivedSize = 0;
                this.UI.downloadAnchor.href = URL.createObjectURL(received);
                this.UI.downloadAnchor.textContent = "Нажмите чтобы скачать файл " + this.UI.downloadAnchor.download;
                this.UI.downloadAnchor.style.display = 'block';
                this.isFileOrFileDesc = 0;
                this.UI.receiveProgress.hidden = true;
            }
        }
    }

}