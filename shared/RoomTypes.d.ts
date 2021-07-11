import { types as MediasoupTypes } from "mediasoup";
import { types as MediasoupClientTypes } from "mediasoup-client";
export type SocketId = string;
// номер комнаты
export type RoomId = string;

export type NewUserInfo = {
    id: SocketId,
    name: string;
};

export type AfterConnectInfo = {
    name: string,
    rtpCapabilities: MediasoupTypes.RtpCapabilities;
};

export type NewConsumerInfo = {
    userId: SocketId,
    producerId: MediasoupTypes.Producer['id'],
    id: MediasoupTypes.Consumer['id'],
    kind: MediasoupTypes.MediaKind,
    rtpParameters: MediasoupTypes.RtpParameters,
    type: MediasoupTypes.ConsumerType,
    appData: MediasoupTypes.Producer['appData'],
    producerPaused: boolean;
};

export type NewWebRtcTransport = {
    id: MediasoupTypes.Transport['id'],
    iceParameters: MediasoupTypes.IceParameters,
    iceCandidates: Array<MediasoupClientTypes.IceCandidate>,
    dtlsParameters: MediasoupTypes.DtlsParameters;
};