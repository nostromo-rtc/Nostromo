import { types as MediasoupTypes } from "mediasoup";
type SocketId = string;
// номер комнаты
type RoomId = string;

type NewUserInfo = {
    id: SocketId,
    name: string;
};

type AfterConnectInfo = {
    name: string,
    rtpCapabilities: MediasoupTypes.RtpCapabilities;
};

type NewConsumerInfo = {
    userId: SocketId,
    producerId: MediasoupTypes.Producer['id'],
    id: MediasoupTypes.Consumer['id'],
    kind: MediasoupTypes.MediaKind,
    rtpParameters: MediasoupTypes.RtpParameters,
    type: MediasoupTypes.ConsumerType,
    appData: MediasoupTypes.Producer['appData'],
    producerPaused: boolean;
};

export { SocketId, RoomId, NewUserInfo, AfterConnectInfo, NewConsumerInfo };