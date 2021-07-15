import { VideoCodec } from "./RoomTypes";

export type NewRoomInfo = {
    name: string,
    pass: string,
    videoCodec: VideoCodec;
};