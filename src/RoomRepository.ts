
import { NewRoomInfo, RoomLinkInfo } from "nostromo-shared/types/AdminTypes";
import { UserInfo } from "nostromo-shared/types/RoomTypes";
import { IMediasoupService } from "./MediasoupService";
import { IRoom, Room } from "./Room";

export interface IRoomRepository
{
    /** Создать комнату. */
    create(info: NewRoomInfo): Promise<string>;

    /** Удалить комнату. */
    remove(id: string): void;

    get(id: string): IRoom | undefined;

    has(id: string): boolean,

    getRoomLinkList(): RoomLinkInfo[];

    /** Получить список пользователей в комнате roomId. */
    getUserList(roomId: string): UserInfo[];
}

export class PlainRoomRepository implements IRoomRepository
{
    private rooms = new Map<string, IRoom>();

    private latestRoomIndex = 0;

    private mediasoup: IMediasoupService;

    constructor(
        mediasoup: IMediasoupService
    )
    {
        this.mediasoup = mediasoup;
    }

    public async create(info: NewRoomInfo): Promise<string>
    {
        const { name, pass, videoCodec } = info;

        const id = String(this.latestRoomIndex++);

        this.rooms.set(id, await Room.create(
            id, name, pass, videoCodec,
            this.mediasoup
        ));

        return id;
    }

    public remove(id: string): void
    {
        const room = this.rooms.get(id);

        if (room)
        {
            room.close();
            this.rooms.delete(id);
        }
    }

    public get(id: string): IRoom | undefined
    {
        return this.rooms.get(id);
    }

    public has(id: string): boolean
    {
        return this.rooms.has(id);
    }

    public getRoomLinkList(): RoomLinkInfo[]
    {
        const roomList: RoomLinkInfo[] = [];

        for (const room of this.rooms)
        {
            roomList.push({ id: room[0], name: room[1].name });
        }

        return roomList;
    }

    public getUserList(roomId: string): UserInfo[]
    {
        const room = this.rooms.get(roomId);

        if (!room)
        {
            throw new Error("[RoomRepository] Room with roomId is not exist");
        }

        const userList: UserInfo[] = [];

        for (const user of room.users)
        {
            userList.push({ id: user[0], name: user[1].name });
        }

        return userList;
    }
}