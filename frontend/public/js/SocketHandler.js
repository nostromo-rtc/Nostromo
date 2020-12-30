import UserMedia from './UserMedia.js';
import PeerConnection from "./PeerConnection.js";
// Класс для работы с сокетами
export default class SocketHandler {
    /**
     * @param {import("./UI").default} _UI
     */
    constructor(_UI) {
        // поля
        this.UI = _UI;
        this.localUserID = 0;
        this.socket = io.connect();
        this.userMedia = new UserMedia(this.UI, this);
        /** @type {Map<number, PeerConnection>} */
        // контейнер с p2p-соединениями с другими пользователями
        this.pcContainer = new Map();
        // конструктор (тут работаем с сокетами)
        // узнаем наш ID
        this.socket.on('userConnected', (userID) => {
            this.localUserID = userID;
            this.UI.localVideolabel.append(`${this.localUserID}`);
        });
        // новый пользователь (т.е другой)
        this.socket.on('newUser', (remoteUserID, AmIOffer) => {
            this.UI.addVideo(remoteUserID);
            this.UI.resizeVideos();
            const socketSettings = {
                remoteUserID: remoteUserID,
                socket: this.socket
            }
            let PCInstance = new PeerConnection(this.UI, this.userMedia.stream, socketSettings, AmIOffer);
            // сохраняем подключение
            this.pcContainer.set(remoteUserID, PCInstance);
        });
        // от нас запросили приглашение для remoteUserID
        this.socket.on('newOffer', (remoteUserID) => {
            if (this.pcContainer.has(remoteUserID)) {
                const pc = this.pcContainer.get(remoteUserID);
                console.log('newOffer', this.localUserID, remoteUserID);
                pc.createOffer();
            }
        });
        // если придет приглашение от remoteUser, обработать его
        this.socket.on('receiveOffer', (SDP, remoteUserID) => {
            if (this.pcContainer.has(remoteUserID)) {
                const pc = this.pcContainer.get(remoteUserID);
                console.log('receiveOffer', this.localUserID, remoteUserID);
                pc.isOffer = false;
                pc.receiveOffer(SDP);
            }
        });
        // если придет ответ от remoteUser, обработать его
        this.socket.on('receiveAnswer', (SDP, remoteUserID) => {
            if (this.pcContainer.has(remoteUserID)) {
                const pc = this.pcContainer.get(remoteUserID);
                console.log('receiveAnswer', this.localUserID, remoteUserID);
                pc.receiveAnswer(SDP);
                pc.connected = true;
            }
        });
        // другой пользователь отключился
        this.socket.on('userDisconnected', (remoteUserID) => {
            if (this.pcContainer.has(remoteUserID)) {
                this.UI.removeVideo(remoteUserID);
                // удаляем объект соединения
                let pc = this.pcContainer.get(remoteUserID);
                this.pcContainer.delete(remoteUserID);
                pc = undefined;
            }
        });
        this.socket.on('disconnect', () => {
            for (const remoteUserID of this.pcContainer.keys()) {
                this.UI.removeVideo(remoteUserID);
                // удаляем объект соединения
                let pc = this.pcContainer.get(remoteUserID);
                this.pcContainer.delete(remoteUserID);
                pc = undefined;
            }
        });
        // обработка личных чатов
        this.UI.buttons.get('sendMessage').addEventListener('click', () =>
        {
            if (this.UI.getChatOption() != "default")
            {
                const receiverID = Number(this.UI.getChatOption());
                let pc = this.pcContainer.get(receiverID);
                pc.dc.sendMessage();
            }
        });
        this.UI.buttons.get('sendFile').addEventListener('click', () =>
        {
            if (this.UI.getChatOption() != "default")
            {
                const receiverID = Number(this.UI.getChatOption());
                let pc = this.pcContainer.get(receiverID);
                pc.dc.sendFile();
            }
        });
        document.addEventListener('beforeunload', () => {
            this.socket.close()
        });
    }
    // добавить медиапоток в подключение
    addNewMediaStream(trackKind) {
        this.socket.emit('mediaReady');
        for (const pc of this.pcContainer.values()) {
            pc.isOffer = true;
            pc.addNewMediaStream(this.userMedia.stream, trackKind);
        }
    }
    // обновить существующее медиа
    updateMediaStream(trackKind) {
        for (const pc of this.pcContainer.values()) {
            pc.updateMediaStream(this.userMedia.stream, trackKind);
        }
    }

}