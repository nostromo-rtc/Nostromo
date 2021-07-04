
import DataChannel from './DataChannel.js';
import UI from './UI.js';
import { SocketSettings } from './SocketHandler.js';
import { MediaKind } from 'mediasoup/lib/RtpParameters';

// Класс, устанавливающий соединение с одним собеседником (p2p-соединение)
export default class PeerConnection
{
    private ui: UI;
    private localStream: MediaStream;
    private _socketSettings: SocketSettings;
    public get socketSettings(): SocketSettings { return this._socketSettings; }
    private _isOffer: boolean;
    public get isOffer(): boolean { return this._isOffer; }
    public set isOffer(flag: boolean) { this._isOffer = flag; }
    private pc: RTCPeerConnection;
    private firstConnect: boolean = true;

    private _dc: DataChannel;
    public get dc(): DataChannel { return this._dc; }

    // необходимо ли пересоздать приглашение (например при добавлении нового медиапотока)
    private needNewOffer: boolean = false;

    // -- stun/turn сервера -- //
    private readonly configuration: RTCConfiguration = {
        iceServers: [{
            urls: [
                "stun:stun.services.mozilla.org",
                "stun:stun2.l.google.com:19305"
            ]
        }]
    };

    constructor(_ui: UI, stream: MediaStream, settings: SocketSettings, isOffer: boolean)
    {
        this.ui = _ui;
        this.localStream = stream;
        this._socketSettings = settings;
        this._isOffer = isOffer; // мы приглашаем или принимаем ответ

        this._dc = new DataChannel(this.ui, this);

        this.pc = this.createRTCPeerConnection();

        console.debug("PeerConnection ctor");
    }

    public close(): void
    {
        this.pc.close();
    }

    // создание p2p соединения
    private createRTCPeerConnection(): RTCPeerConnection
    {
        console.info(`[${this.socketSettings.remoteUserID}]`, "Создаем RTCPeerConnection");

        let pc = new RTCPeerConnection(this.configuration); // -- создаем RTCPeerConnection -- //

        pc.addEventListener('iceconnectionstatechange',
            (event: Event) => this.onIceConnectionStateChange(event));

        pc.addEventListener('icegatheringstatechange',
            (event: Event) => this.onIceGatheringStateChange(event));

        pc.addEventListener('track',
            (event: RTCTrackEvent) => this.gotRemoteStream(event));

        let thisDirection: RTCRtpTransceiverDirection = 'recvonly';

        if (this.isOffer)
        {
            pc.addTransceiver("video", {
                direction: thisDirection,
                streams: [this.localStream]
            });
            pc.addTransceiver("audio", {
                direction: thisDirection,
                streams: [this.localStream]
            });
        }

        // -- передаем локальный медиапоток в pc -- //
        if (this.localStream.getTracks().length)
        {
            for (const track of this.localStream.getTracks())
            {
                pc.addTrack(track, this.localStream);
            }
        }

        return pc;
    }

    private resetConnection(): void
    {
        this.pc.close();
        this.firstConnect = true;
        this.pc = this.createRTCPeerConnection();
    }

    // установка описаний (SDP-объектов)
    private async pc_setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void>
    {
        // -- устанавливаем приглашение/ответ от нас как описание локальной стороны -- //
        try
        {
            await this.pc.setLocalDescription(desc);
            console.info(`[${this.socketSettings.remoteUserID}]`, "setLocalDescription complete!");
        }
        catch (error)
        {
            console.error(`[${this.socketSettings.remoteUserID}]`, "Failed to set session description:", error);
        }
    }

    // установка SDP-описания от собеседника
    private async pc_setRemoteDescription(desc: RTCSessionDescription): Promise<void>
    {
        // -- устанавливаем приглашение/ответ от нас как описание удаленной стороны -- //
        try
        {
            await this.pc.setRemoteDescription(desc);
            console.info(`[${this.socketSettings.remoteUserID}]`, "setRemoteDescription complete!");
        }
        catch (error)
        {
            console.error(`[${this.socketSettings.remoteUserID}]`, "Failed to set session description:", error);
        }
    }

    // приглашение удалось сформировать
    private async createOffer_success(offer: RTCSessionDescriptionInit): Promise<void>
    {
        // мы создали приглашение без ICE кандидатов
        // отправим приглашение тогда, когда ICE кандидаты будут добавлены
        // см. функцию onICEGatheringStateChange

        console.info(`[${this.socketSettings.remoteUserID}]`, "> createOffer_success()");
        await this.pc_setLocalDescription(offer);
        if (!this.firstConnect)
        {
            console.info(`[${this.socketSettings.remoteUserID}]`, "Sending offer SDP to web-server");
            this.socketSettings.socket.emit('newOffer', this.pc.localDescription, this.socketSettings.remoteUserID);
        }
    }

    // создаем канал для текстовых сообщений и файлов
    private createDataChannel(): void
    {
        const dataChannelParams: RTCDataChannelInit = {
            ordered: true
        };

        this.dc.createMessageDc(this.pc.createDataChannel('messaging-channel', dataChannelParams));
        this.dc.createFileDc(this.pc.createDataChannel('file-channel', dataChannelParams));
        this.dc.isCreated = true;
    }

    // создать приглашение
    public async createOffer()
    {
        if (!this.dc.isCreated)
        {
            this.createDataChannel();
        }

        try
        { // -- запрашиваем формирования приглашения -- //
            let offer: RTCSessionDescriptionInit = await this.pc.createOffer();
            await this.createOffer_success(offer);
        } catch (error)
        {
            console.error(`[${this.socketSettings.remoteUserID}]`, "Failed to create session description (offer):", error);
        }
    }

    // ответ на приглашение удалось сформировать
    private async createAnswer_success(answer: RTCSessionDescriptionInit)
    {
        console.info(`[${this.socketSettings.remoteUserID}]`, "> createAnswer_success()");
        await this.pc_setLocalDescription(answer);
        if (!this.firstConnect)
        {
            console.info(`[${this.socketSettings.remoteUserID}]`, "Sending answer to web-server");
            this.socketSettings.socket.emit('newAnswer', this.pc.localDescription, this.socketSettings.remoteUserID);
        }
    }

    // получить приглашение и создать ответ
    public async receiveOffer(SDP: RTCSessionDescription)
    {
        console.info(`[${this.socketSettings.remoteUserID}]`, "> receiveOffer()");

        if (this.pc.iceConnectionState == "checking")
        {
            this.resetConnection();
        }

        if (!this.dc.isCreated)
        {
            this.pc.addEventListener('datachannel', event => this.RemoteDataChannel(event));
        }

        await this.pc_setRemoteDescription(SDP);

        try
        {   // запрашиваем формирования ответа
            const answer: RTCSessionDescriptionInit = await this.pc.createAnswer();
            await this.createAnswer_success(answer);
        }
        catch (error)
        {
            console.error(`[${this.socketSettings.remoteUserID}]`, "Failed to create session description (answer):", error);
        }
    }

    // получить ответ
    public async receiveAnswer(SDP: RTCSessionDescription)
    {
        console.info(`[${this.socketSettings.remoteUserID}]`, "> receiveAnswer()");
        await this.pc_setRemoteDescription(SDP);
    }

    // события WebRTC
    private onIceConnectionStateChange(event: Event): void
    {
        const connectionState: RTCIceConnectionState = this.pc.iceConnectionState;
        console.info(`[${this.socketSettings.remoteUserID}] ICE Connection state: ${connectionState}`);

        // собеседник подключился
        if (connectionState == "connected")
        {
            this.ui.addChatOption(this.socketSettings.remoteUserID, this.socketSettings.remoteUsername);
            if (this.needNewOffer)
            {
                this.needNewOffer = false;
                this.createOffer();
            }
        }
        // собеседник временно отключился из-за плохой связи и это соединение должно скоро автоматически восстановиться
        else if (connectionState == "disconnected")
        {
            this.ui.removeChatOption(this.socketSettings.remoteUserID);
        }
        // webrtc соединение с собеседником полностью оборвалось
        else if (connectionState == "failed")
        {
            // если соединение с заданными SDP-объектами не удалось, то удаляем его и создаем новое
            console.error(`[${this.socketSettings.remoteUserID}]`, "maybe BUG2, handle it");
            this.resetConnection();
            this.ui.removeChatOption(this.socketSettings.remoteUserID);
            if (this.isOffer) { this.createOffer(); }
        }
    }

    // -- отслеживаем, когда был создан последний ICE-кандидат -- //
    private onIceGatheringStateChange(event: Event): void 
    {
        console.info(`[${this.socketSettings.remoteUserID}]`, "ICE Gathering state: ", this.pc.iceGatheringState);
        if (this.pc.iceGatheringState == "complete")
        {
            if (this.firstConnect)
            {
                console.info(`[${this.socketSettings.remoteUserID}]`, "Sending first SDP to web-server (when ice candidates are ready)");
                this.firstConnect = false;
                let emitEvent: string = (this.isOffer) ? 'newOffer' : 'newAnswer';
                this.socketSettings.socket.emit(emitEvent, this.pc.localDescription, this.socketSettings.remoteUserID);
            }
        }
    }

    // удаленный медиапоток
    private gotRemoteStream(event: RTCTrackEvent)
    {
        console.debug(`[${this.socketSettings.remoteUserID}]`, "got remoteStream:", event);
        const remoteVideo = this.ui.allVideos.get(this.socketSettings.remoteUserID);
        if (remoteVideo) remoteVideo.srcObject = event.streams[0];
    }

    // добавить медиапоток в подключение
    public async addNewMediaStream(stream: MediaStream, trackKind: string): Promise<void>
    {
        this.localStream = stream;
        const newVideoTrack: MediaStreamTrack = this.localStream.getVideoTracks()[0];
        const newAudioTrack: MediaStreamTrack = this.localStream.getAudioTracks()[0];

        if (trackKind == 'video')
        {
            this.pc.addTrack(newVideoTrack, this.localStream);
        }
        else if (trackKind == 'audio')
        {
            this.pc.addTrack(newAudioTrack, this.localStream);
        }
        else if (trackKind == 'both')
        {
            this.pc.addTrack(newVideoTrack, this.localStream);
            this.pc.addTrack(newAudioTrack, this.localStream);
        }

        console.info(`[${this.socketSettings.remoteUserID}]`, "Добавлена новая медиадорожка");
        console.debug(this.pc.getSenders(), this.pc.getReceivers(), this.pc.getTransceivers());

        if (this.isOffer)
        {
            if (this.pc.iceConnectionState == 'connected')
            {
                await this.createOffer();
            }
            else
            {
                console.error(`[${this.socketSettings.remoteUserID}]`, "maybe BUG, handle it");
                this.needNewOffer = true;
            }
        }
    }

    // обновить медиапоток в подключении
    public async updateMediaStream(stream: MediaStream, trackKind: string): Promise<void>
    {
        this.localStream = stream;
        let newTrack: MediaStreamTrack = (trackKind == 'video') ? this.localStream.getVideoTracks()[0] : this.localStream.getAudioTracks()[0];
        for (const sender of this.pc.getSenders())
        {
            if (sender != undefined
                && sender.track != null
                && sender.track.kind == trackKind)
            {
                await sender.replaceTrack(newTrack);
            }
        }
        console.info(`[${this.socketSettings.remoteUserID}]`, "Обновлен существующий медиапоток");
        console.debug(this.pc.getSenders(), this.pc.getReceivers(), this.pc.getTransceivers());
    }

    // удаленный поток данных (текстовые сообщения и файлы)
    private RemoteDataChannel(event: RTCDataChannelEvent)
    {
        if (event.channel.label == "messaging-channel")
        {
            this.dc.createMessageDc(event.channel);
        }
        else if (event.channel.label == "file-channel")
        {
            this.dc.createFileDc(event.channel);
        }
        this.dc.isCreated = true;
    }
}