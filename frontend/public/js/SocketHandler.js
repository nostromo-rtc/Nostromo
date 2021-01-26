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
        this.socket = io.connect();
        this.userMedia = new UserMedia(this.UI, this);
        /** @type {Map<number, PeerConnection>} */
        // контейнер с p2p-соединениями с другими пользователями
        this.pcContainer = new Map();

        // конструктор (тут работаем с сокетами)
        console.debug("SocketHandler ctor");
        this.UI.buttons.get('setNewUsername').addEventListener('click', () => {
            this.UI.setNewUsername();
            this.socket.emit('newUsername', this.UI.usernameInput.value);
        });
        this.socket.on('connect', () => {
            console.info("Создано подключение веб-сокета");
            console.info("Client ID:", this.socket.id);
            // сообщаем имя
            this.socket.emit('afterConnect', this.UI.usernameInput.value);
        });
        // новый пользователь (т.е другой)
        this.socket.on('newUser', ({
            ID: remoteUserID,
            name: name
        }, AmIOffer) => {
            this.UI.addVideo(remoteUserID, name);
            this.UI.resizeVideos();
            const socketSettings = {
                remoteUserID: remoteUserID,
                remoteUsername: name,
                socket: this.socket
            }
            let PCInstance = new PeerConnection(this.UI, this.userMedia.stream, socketSettings, AmIOffer);
            // сохраняем подключение
            this.pcContainer.set(remoteUserID, PCInstance);
        });

        // другой пользователь поменял имя
        this.socket.on('newUsername', ({
            ID: remoteUserID,
            name: name
        }) => {
            this.pcContainer.get(remoteUserID).socketSettings.remoteUsername = name;
            this.UI.updateVideoLabel(remoteUserID, name);
            this.UI.updateChatOption(remoteUserID, name);
        });

        // от нас запросили приглашение для remoteUserID
        this.socket.on('newOffer', (remoteUserID) => {
            if (this.pcContainer.has(remoteUserID)) {
                const pc = this.pcContainer.get(remoteUserID);
                console.info('SocketHandler > newOffer', this.socket.id, remoteUserID);
                pc.createOffer();
            }
        });
        // если придет приглашение от remoteUser, обработать его
        this.socket.on('receiveOffer', (SDP, remoteUserID) => {
            if (this.pcContainer.has(remoteUserID)) {
                const pc = this.pcContainer.get(remoteUserID);
                console.info('SocketHandler > receiveOffer', this.socket.id, remoteUserID);
                pc.isOffer = false;
                pc.receiveOffer(SDP);
            }
        });
        // если придет ответ от remoteUser, обработать его
        this.socket.on('receiveAnswer', (SDP, remoteUserID) => {
            if (this.pcContainer.has(remoteUserID)) {
                const pc = this.pcContainer.get(remoteUserID);
                console.info('SocketHandler > receiveAnswer', this.socket.id, remoteUserID);
                pc.receiveAnswer(SDP);
            }
        });
        // другой пользователь отключился
        this.socket.on('userDisconnected', (remoteUserID) => {
            if (this.pcContainer.has(remoteUserID)) {
                console.info("SocketHandler > remoteUser disconnected:", remoteUserID);
                this.UI.removeVideo(remoteUserID);
                // удаляем объект соединения
                let disconnectedPC = this.pcContainer.get(remoteUserID);
                this.pcContainer.delete(remoteUserID);
                disconnectedPC.pc.close();
                disconnectedPC.pc = undefined;
                disconnectedPC = undefined;
            }
        });
        this.socket.on('disconnect', () => {
            console.warn("Данный клиент был отсоединен от веб-сервера");
            for (const remoteUserID of this.pcContainer.keys()) {
                this.UI.removeVideo(remoteUserID);
                // удаляем объект соединения
                let pc = this.pcContainer.get(remoteUserID);
                this.pcContainer.delete(remoteUserID);
                pc.pc.close();
                pc = undefined;
            }
        });
        // обработка личных чатов
        this.UI.buttons.get('sendMessage').addEventListener('click', () => {
            if (this.UI.getChatOption() != "default") {
                const receiverID = this.UI.getChatOption();
                if (this.pcContainer.has(receiverID)) {
                    let pc = this.pcContainer.get(receiverID);
                    pc.dc.sendMessage();
                }
            }
        });
        this.UI.buttons.get('sendFile').addEventListener('click', () => {
            if (this.UI.getChatOption() != "default") {
                const receiverID = this.UI.getChatOption();
                if (this.pcContainer.has(receiverID)) {
                    let pc = this.pcContainer.get(receiverID);
                    pc.dc.sendFile();
                }
            }
        });
        document.addEventListener('beforeunload', () => {
            this.socket.close()
        });
    }
    // добавить медиапоток в подключение
    addNewMediaStream(trackKind) {
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