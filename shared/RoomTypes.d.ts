import { types as MediasoupTypes } from "mediasoup";
import { types as MediasoupClientTypes } from "mediasoup-client";
export type SocketId = string;
// номер комнаты
export type RoomId = string;

export type NewUserInfo = {
    id: SocketId,
    name: string;
};

export type JoinInfo = {
    name: string,
    rtpCapabilities: MediasoupTypes.RtpCapabilities;
};

export type NewWebRtcTransportInfo = {
    id: MediasoupTypes.Transport['id'],
    iceParameters: MediasoupTypes.IceParameters,
    iceCandidates: Array<MediasoupClientTypes.IceCandidate>,
    dtlsParameters: MediasoupTypes.DtlsParameters;
};

export type ConnectWebRtcTransportInfo = {
    transportId: MediasoupTypes.Transport['id'],
    dtlsParameters: MediasoupTypes.DtlsParameters;
};

export type NewProducerInfo = {
    transportId: MediasoupTypes.Transport['id'],
    kind: MediasoupTypes.MediaKind,
    rtpParameters: MediasoupTypes.RtpParameters
};

export type NewConsumerInfo = {
    producerUserId: SocketId,
    id: MediasoupTypes.Consumer['id'],
    producerId: MediasoupTypes.Producer['id'],
    kind: MediasoupTypes.MediaKind,
    rtpParameters: MediasoupTypes.RtpParameters
};
