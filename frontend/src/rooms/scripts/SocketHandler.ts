import UI from "./UI.js";
import UserMedia from './UserMedia.js';
import PeerConnection from "./PeerConnection.js";
import { io, Socket } from "socket.io-client";

export type SocketSettings =
    {
        remoteUserId: string,
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
            console.info("Client Id:", this.socket.id);
            // сообщаем имя
            this.socket.emit('afterConnect', this.ui.usernameInputValue);
        });

        this.socket.on('getRouterRtpCapabilities', () =>
        {
            
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
        this.socket.on('newUser', (remoteUserId: string, remoteName: string, AmIOffer: boolean) =>
        {
            this.ui.addVideo(remoteUserId, remoteName);

            const socketSettings: SocketSettings = {
                remoteUserId: remoteUserId,
                remoteUsername: remoteName,
                socket: this.socket
            };

            let PCInstance = new PeerConnection(this.ui, this.userMedia.stream, socketSettings, AmIOffer);

            // сохраняем подключение
            this.pcContainer.set(remoteUserId, PCInstance);
        });

        // другой пользователь поменял имя
        this.socket.on('newUsername', (remoteUserId: string, newName: string) =>
        {
            let pc = this.pcContainer.get(remoteUserId);
            if (pc)
            {
                pc.socketSettings.remoteUsername = newName;
                this.ui.updateVideoLabel(remoteUserId, newName);
                this.ui.updateChatOption(remoteUserId, newName);
            }
        });

        // от нас запросили приглашение для remoteUserd
        this.socket.on('newOffer', async (remoteUserId: string) =>
        {
            if (this.pcContainer.has(remoteUserId))
            {
                const pc: PeerConnection = this.pcContainer.get(remoteUserId)!;
                console.info('SocketHandler > newOffer for', `[${remoteUserId}]`);
                await pc.createOffer();
            }
        });

        // если придет приглашение от remoteUser, обработать его
        this.socket.on('receiveOffer', async (SDP: RTCSessionDescription, remoteUserId: string) =>
        {
            if (this.pcContainer.has(remoteUserId))
            {
                const pc: PeerConnection = this.pcContainer.get(remoteUserId)!;
                console.info('SocketHandler > receiveOffer from', `[${remoteUserId}]`);
                pc.isOffer = false;
                await pc.receiveOffer(SDP);
            }
        });

        // если придет ответ от remoteUser, обработать его
        this.socket.on('receiveAnswer', async (SDP: RTCSessionDescription, remoteUserId: string) =>
        {
            if (this.pcContainer.has(remoteUserId))
            {
                const pc: PeerConnection = this.pcContainer.get(remoteUserId)!;
                console.info('SocketHandler > receiveAnswer from', `[${remoteUserId}]`);
                await pc.receiveAnswer(SDP);
            }
        });

        // другой пользователь отключился
        this.socket.on('userDisconnected', (remoteUserId: string) =>
        {
            if (this.pcContainer.has(remoteUserId))
            {
                console.info("SocketHandler > remoteUser disconnected:", `[${remoteUserId}]`);
                this.ui.removeVideo(remoteUserId);
                // удаляем объект соединения
                let disconnectedPC: PeerConnection = this.pcContainer.get(remoteUserId)!;
                this.pcContainer.delete(remoteUserId);
                disconnectedPC.close();
            }
        });

        this.socket.on('disconnect', () =>
        {
            console.warn("Вы были отсоединены от веб-сервера (websocket disconnect)");
            for (const remoteUserId of this.pcContainer.keys())
            {
                this.ui.removeVideo(remoteUserId);
                // удаляем объект соединения
                let pc: PeerConnection = this.pcContainer.get(remoteUserId)!;
                this.pcContainer.delete(remoteUserId);
                pc.close();
            }
        });

        // обработка личных чатов
        this.ui.buttons.get('sendMessage')!.addEventListener('click', () =>
        {
            if (this.ui.currentChatOption != "default")
            {
                const receiverId = this.ui.currentChatOption;
                if (this.pcContainer.has(receiverId))
                {
                    let pc: PeerConnection = this.pcContainer.get(receiverId)!;
                    pc.dc.sendMessage();
                }
            }
        });

        this.ui.buttons.get('sendFile')!.addEventListener('click', () =>
        {
            if (this.ui.currentChatOption != "default")
            {
                const receiverId = this.ui.currentChatOption;
                if (this.pcContainer.has(receiverId))
                {
                    let pc: PeerConnection = this.pcContainer.get(receiverId)!;
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