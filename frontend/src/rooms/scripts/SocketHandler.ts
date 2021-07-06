import UI from "./UI.js";
import UserMedia from './UserMedia.js';
import PeerConnection from "./PeerConnection.js";
import { io, Socket } from "socket.io-client";

export type SocketSettings =
    {
        remoteUserID: string,
        remoteUsername: string,
        socket: Socket;
    };

// Класс для работы с сокетами
export default class SocketHandler
{
    private ui: UI;
    private socket: Socket = io('/room', {
        'transports': ['websocket']
    });

    private userMedia: UserMedia;

    // контейнер с p2p-соединениями с другими пользователями
    private pcContainer = new Map<string, PeerConnection>();
    constructor(_ui: UI)
    {
        this.ui = _ui;
        this.userMedia = new UserMedia(this.ui, this);

        console.debug("SocketHandler ctor");

        this.ui.buttons.get('setNewUsername')!.addEventListener('click', () =>
        {
            this.ui.setNewUsername();
            this.socket.emit('newUsername', this.ui.usernameInputValue);
        });

        this.socket.on('connect', () =>
        {
            console.info("Создано веб-сокет подключение");
            console.info("Client ID:", this.socket.id);
            // сообщаем имя
            this.socket.emit('afterConnect', this.ui.usernameInputValue);
        });

        this.socket.on('connect_error', (err: Error) =>
        {
            console.log(err.message); // not authorized
        });

        this.socket.on('roomName', (roomName: string) =>
        {
            this.ui.roomName = roomName;
        });

        // новый пользователь (т.е другой)
        this.socket.on('newUser', (remoteUserID: string, remoteName: string, AmIOffer: boolean) =>
        {
            this.ui.addVideo(remoteUserID, remoteName);

            const socketSettings: SocketSettings = {
                remoteUserID: remoteUserID,
                remoteUsername: remoteName,
                socket: this.socket
            };

            let PCInstance = new PeerConnection(this.ui, this.userMedia.stream, socketSettings, AmIOffer);

            // сохраняем подключение
            this.pcContainer.set(remoteUserID, PCInstance);
        });

        // другой пользователь поменял имя
        this.socket.on('newUsername', (remoteUserID: string, newName: string) =>
        {
            let pc = this.pcContainer.get(remoteUserID);
            if (pc)
            {
                pc.socketSettings.remoteUsername = newName;
                this.ui.updateVideoLabel(remoteUserID, newName);
                this.ui.updateChatOption(remoteUserID, newName);
            }
        });

        // от нас запросили приглашение для remoteUserID
        this.socket.on('newOffer', async (remoteUserID: string) =>
        {
            if (this.pcContainer.has(remoteUserID))
            {
                const pc: PeerConnection = this.pcContainer.get(remoteUserID)!;
                console.info('SocketHandler > newOffer for', `[${remoteUserID}]`);
                await pc.createOffer();
            }
        });

        // если придет приглашение от remoteUser, обработать его
        this.socket.on('receiveOffer', async (SDP: RTCSessionDescription, remoteUserID: string) =>
        {
            if (this.pcContainer.has(remoteUserID))
            {
                const pc: PeerConnection = this.pcContainer.get(remoteUserID)!;
                console.info('SocketHandler > receiveOffer from', `[${remoteUserID}]`);
                pc.isOffer = false;
                await pc.receiveOffer(SDP);
            }
        });

        // если придет ответ от remoteUser, обработать его
        this.socket.on('receiveAnswer', async (SDP: RTCSessionDescription, remoteUserID: string) =>
        {
            if (this.pcContainer.has(remoteUserID))
            {
                const pc: PeerConnection = this.pcContainer.get(remoteUserID)!;
                console.info('SocketHandler > receiveAnswer from', `[${remoteUserID}]`);
                await pc.receiveAnswer(SDP);
            }
        });

        // другой пользователь отключился
        this.socket.on('userDisconnected', (remoteUserID: string) =>
        {
            if (this.pcContainer.has(remoteUserID))
            {
                console.info("SocketHandler > remoteUser disconnected:", `[${remoteUserID}]`);
                this.ui.removeVideo(remoteUserID);
                // удаляем объект соединения
                let disconnectedPC: PeerConnection = this.pcContainer.get(remoteUserID)!;
                this.pcContainer.delete(remoteUserID);
                disconnectedPC.close();
            }
        });

        this.socket.on('disconnect', () =>
        {
            console.warn("Вы были отсоединены от веб-сервера (websocket disconnect)");
            for (const remoteUserID of this.pcContainer.keys())
            {
                this.ui.removeVideo(remoteUserID);
                // удаляем объект соединения
                let pc: PeerConnection = this.pcContainer.get(remoteUserID)!;
                this.pcContainer.delete(remoteUserID);
                pc.close();
            }
        });

        // обработка личных чатов
        this.ui.buttons.get('sendMessage')!.addEventListener('click', () =>
        {
            if (this.ui.currentChatOption != "default")
            {
                const receiverID = this.ui.currentChatOption;
                if (this.pcContainer.has(receiverID))
                {
                    let pc: PeerConnection = this.pcContainer.get(receiverID)!;
                    pc.dc.sendMessage();
                }
            }
        });

        this.ui.buttons.get('sendFile')!.addEventListener('click', () =>
        {
            if (this.ui.currentChatOption != "default")
            {
                const receiverID = this.ui.currentChatOption;
                if (this.pcContainer.has(receiverID))
                {
                    let pc: PeerConnection = this.pcContainer.get(receiverID)!;
                    pc.dc.sendFile();
                }
            }
        });

        document.addEventListener('beforeunload', () =>
        {
            this.socket.close();
        });
    }

    // добавить медиапоток в подключение
    public addNewMediaStream(trackKind: string): void
    {
        for (const pc of this.pcContainer.values())
        {
            pc.isOffer = true;
            pc.addNewMediaStream(this.userMedia.stream, trackKind);
        }
    }

    // обновить существующее медиа
    public updateMediaStream(trackKind: string): void
    {
        for (const pc of this.pcContainer.values())
        {
            pc.updateMediaStream(this.userMedia.stream, trackKind);
        }
    }
}