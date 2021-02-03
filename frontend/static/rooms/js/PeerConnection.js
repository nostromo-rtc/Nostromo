import DataChannel from './DataChannel.js';
// Класс, устанавливающий соединение с одним собеседником (p2p-соединение)
export default class PeerConnection {
    /**
     * @param {import("./UI.js").default} _UI
     * @param {MediaStream} _localStream
     * @param {{ remoteUserID: number; socket: Socket; }} _socketSettings
     */
    constructor(_UI, _localStream, _socketSettings, _isOffer) {
        // поля
        this.UI = _UI;
        this.socketSettings = _socketSettings;
        this.localStream = _localStream;
        this.pc = null; // -- peer connection -- //
        this.isOffer = _isOffer; // мы приглашаем или принимаем ответ
        this.firstConnect = true;
        this.needNewOffer = false; // необходимо пересоздать приглашение (например при добавлении нового медиапотока)
        // -- stun/turn сервера -- //
        this.configuration = {
            iceServers: [{
                urls: [
                    "stun:stun.services.mozilla.org",
                    "stun:stun2.l.google.com:19305"
                ]
            }]
        };
        this.dcCreated = false;
        this.dc = new DataChannel(this.UI, this);
        // конструктор
        console.debug("PeerConnection ctor");
        this.createRTCPeerConnection();
    }
    // создание p2p соединения
    async createRTCPeerConnection() {
        console.info(`[${this.socketSettings.remoteUserID}]`,"Создаем RTCPeerConnection");
        this.pc = new RTCPeerConnection(this.configuration); // -- создаем RTCPeerConnection -- //
        this.pc.addEventListener('iceconnectionstatechange', event => this.onICEStateChange(event));
        this.pc.addEventListener('icegatheringstatechange', event => this.onICEGatheringStateChange(event));
        this.pc.addEventListener('track', event => this.gotRemoteStream(event));

        let thisDirection = 'recvonly';
        if (this.isOffer) {
            this.pc.addTransceiver("video", {
                direction: thisDirection,
                streams: [this.localStream]
            });
            this.pc.addTransceiver("audio", {
                direction: thisDirection,
                streams: [this.localStream]
            });
        }
        // -- передаем локальный медиапоток в pc -- //
        if (this.localStream.getTracks().length != 0) {
            this.localStream.getTracks().forEach((track) => this.pc.addTrack(track, this.localStream));
        }
    }

    resetConnection() {
        this.pc.close();
        this.firstConnect = true;
        this.createRTCPeerConnection();
    }

    // добавить медиапоток в подключение
    async addNewMediaStream(stream, trackKind) {
        this.localStream = stream;
        let newTrack = this.localStream.getAudioTracks()[0];
        if (trackKind == 'video') {
            newTrack = this.localStream.getVideoTracks()[0];
        }
        this.pc.addTrack(newTrack, this.localStream);
        console.info(`[${this.socketSettings.remoteUserID}]`, "Добавлена новая медиадорожка");
        console.debug(this.pc.getSenders(), this.pc.getReceivers(), this.pc.getTransceivers());
        if (this.isOffer) {
            if (this.pc.iceConnectionState == 'connected') {
                this.createOffer();
            } else {
                console.error(`[${this.socketSettings.remoteUserID}]`, "maybe BUG, handle it");
                this.needNewOffer = true;
            }
        }
    }
    // обновить медиапоток в подключении
    async updateMediaStream(stream, trackKind) {
        this.localStream = stream;
        let newTrack = this.localStream.getAudioTracks()[0];
        if (trackKind == 'video') {
            newTrack = this.localStream.getVideoTracks()[0];
        }
        let sender = this.pc.getSenders()[0];
        for (sender of this.pc.getSenders()) {
            if (sender != undefined && sender.track != null &&
                sender.track.kind == trackKind) {
                await sender.replaceTrack(newTrack);
            }
        }
        console.info(`[${this.socketSettings.remoteUserID}]`, "Обновлен существующий медиапоток");
        console.debug(this.pc.getSenders(), this.pc.getReceivers(), this.pc.getTransceivers());
    }

    // события WebRTC
    onICEStateChange(event) {
        const connectionState = this.pc.iceConnectionState;
        console.info(`[${this.socketSettings.remoteUserID}]`, "ICE Connection state:", connectionState);
        // собеседник подключился
        if (connectionState == "connected") {
            this.UI.addChatOption(this.socketSettings.remoteUserID, this.socketSettings.remoteUsername);
            if (this.needNewOffer) {
                this.needNewOffer = false;
                this.createOffer();
            }
        }
        // собеседник временно отключился из-за плохой связи и это соединение должно скоро автоматически восстановиться
        else if (connectionState == "disconnected") {
            this.UI.removeChatOption(this.socketSettings.remoteUserID);
        }
        // webrtc соединение с собеседником полностью оборвалось
        else if (connectionState == "failed") {
            // если соединение с заданными SDP-объектами не удалось, то удаляем его и создаем новое
            console.error(`[${this.socketSettings.remoteUserID}]`, "maybe BUG2, handle it");
            this.resetConnection();
            this.UI.removeChatOption(this.socketSettings.remoteUserID);
            if (this.isOffer) {
                this.createOffer();
            }
        }
    }
    onICEGatheringStateChange(event) // -- отслеживаем, когда был создан последний ICE-кандидат -- //
    {
        console.info(`[${this.socketSettings.remoteUserID}]`, "ICE Gathering state: ", this.pc.iceGatheringState);
        if (this.pc.iceGatheringState == "complete") {
            if (this.firstConnect) {
                console.info(`[${this.socketSettings.remoteUserID}]`, "Sending first SDP to web-server (when ice candidates are ready)");
                this.firstConnect = false;
                let emitEvent = 'newOffer';
                if (!this.isOffer) emitEvent = 'newAnswer';
                this.socketSettings.socket.emit(emitEvent, this.pc.localDescription, this.socketSettings.remoteUserID);
            }
        }
    }
    // установка описаний (SDP-объектов)
    async pc_setLocalDescription(desc) {
        // -- устанавливаем приглашение/ответ от нас как описание локальной стороны -- //
        try {
            await this.pc.setLocalDescription(desc);
            console.info(`[${this.socketSettings.remoteUserID}]`, "setLocalDescription complete!");
        } catch (error) {
            console.error(`[${this.socketSettings.remoteUserID}]`, "Failed to set session description:", error);
        }
    }

    async pc_setRemoteDescription(desc) {
        // -- устанавливаем приглашение/ответ от нас как описание удаленной стороны -- //
        try {
            await this.pc.setRemoteDescription(desc);
            console.info(`[${this.socketSettings.remoteUserID}]`, "setRemoteDescription complete!");
        } catch (error) {
            console.error(`[${this.socketSettings.remoteUserID}]`, "Failed to set session description:", error);
        }
    }

    // создаем канал для текстовых сообщений и файлов
    createDataChannel() {
        const dataChannelParams = {
            ordered: true
        };
        this.dc.message_dc = this.pc.createDataChannel('messaging-channel', dataChannelParams);
        this.dc.file_dc = this.pc.createDataChannel('file-channel', dataChannelParams);
        this.dc.message_dc.binaryType = 'arraybuffer';
        this.dc.file_dc.binaryType = 'arraybuffer';

        this.dc.message_dc.addEventListener('message', (event) => this.dc.receiveMessage(event));
        this.dc.file_dc.addEventListener('message', (event) => this.dc.receiveFile(event));
    }
    // создать приглашение
    async createOffer_success(offer) // -- приглашение удалось сформировать -- //
    {
        // мы создали приглашение без ICE кандидатов
        // отправим приглашение тогда, когда ICE кандидаты будут добавлены
        // см. функцию onICEGatheringStateChange
        console.info(`[${this.socketSettings.remoteUserID}]`, "> createOffer_success()");
        await this.pc_setLocalDescription(offer);
        if (!this.firstConnect) {
            console.info(`[${this.socketSettings.remoteUserID}]`, "Sending offer SDP to web-server");
            await this.socketSettings.socket.emit('newOffer', this.pc.localDescription, this.socketSettings.remoteUserID);
        }

    }
    async createOffer() {
        if (!this.dcCreated) {
            this.createDataChannel();
            this.dcCreated = true;
        }
        try { // -- запрашиваем формирования приглашения -- //
            let offer = await this.pc.createOffer();
            await this.createOffer_success(offer);
        } catch (error) {
            console.error(`[${this.socketSettings.remoteUserID}]`, "Failed to create session description (offer):", error);
        }
    }
    // получить приглашение и создать ответ
    async createAnswer_success(answer) // -- ответ на приглашение удалось сформировать -- //
    {
        console.info(`[${this.socketSettings.remoteUserID}]`, "> createAnswer_success()");
        await this.pc_setLocalDescription(answer);
        if (!this.firstConnect) {
            console.info(`[${this.socketSettings.remoteUserID}]`, "Sending answer to web-server");
            await this.socketSettings.socket.emit('newAnswer', this.pc.localDescription, this.socketSettings.remoteUserID);
        }
    }
    async receiveOffer(SDP) {
        console.info(`[${this.socketSettings.remoteUserID}]`, "> receiveOffer()");
        if (this.pc.iceConnectionState == "checking") {
            this.resetConnection();
        }
        if (!this.dcCreated) {
            this.pc.addEventListener('datachannel', event => this.RemoteDataChannel(event));
            this.dcCreated = true;
        }
        await this.pc_setRemoteDescription(SDP);
        try { // -- запрашиваем формирования ответа -- //
            const answer = await this.pc.createAnswer();
            await this.createAnswer_success(answer);
        } catch (error) {
            console.error(`[${this.socketSettings.remoteUserID}]`, "Failed to create session description (answer):", error);
        }
    }
    // получить ответ
    async receiveAnswer(SDP) {
        console.info(`[${this.socketSettings.remoteUserID}]`, "> receiveAnswer()");
        await this.pc_setRemoteDescription(SDP);
    }
    // удаленный поток данных (текстовые сообщения и файлы)
    RemoteDataChannel(event) {
        if (event.channel.label == "messaging-channel") {
            this.dc.message_dc = event.channel;
            this.dc.message_dc.binaryType = 'arraybuffer';
            this.dc.message_dc.addEventListener('message', (event) => this.dc.receiveMessage(event));
        } else if (event.channel.label == "file-channel") {
            this.dc.file_dc = event.channel;
            this.dc.file_dc.binaryType = 'arraybuffer';
            this.dc.file_dc.addEventListener('message', (event) => this.dc.receiveFile(event));
        }
    }
    // удаленный медиапоток
    gotRemoteStream(e) {
        console.debug(`[${this.socketSettings.remoteUserID}]`, "got remoteStream:", e);
        const remoteVideo = this.UI.allVideos.get(this.socketSettings.remoteUserID);
        remoteVideo.srcObject = e.streams[0];
    }
}