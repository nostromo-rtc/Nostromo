
import { NewRoomInfo, UpdateRoomInfo } from "nostromo-shared/types/AdminTypes";
import { RoomInfo, PublicRoomInfo } from "nostromo-shared/types/RoomTypes";
import { UserInfo } from "nostromo-shared/types/RoomTypes";
import { IMediasoupService } from "./MediasoupService";
import { IRoom, Room } from "./Room";

import path = require('path');
import fs = require('fs');
import { scrypt } from "crypto";


export interface IRoomRepository
{
    /** Создать комнату. */
    create(info: NewRoomInfo): Promise<string>;

    /** Удалить комнату. */
    remove(id: string): Promise<void>;

    /** Изменить информацию о комнате. */
    update(info: UpdateRoomInfo): Promise<void>;

    /** Получить комнату. */
    get(id: string): IRoom | undefined;

    /** Есть ли такая комната? */
    has(id: string): boolean,

    /** Получить список ссылок на комнаты. */
    getRoomLinkList(): PublicRoomInfo[];

    /** Получить список пользователей в комнате roomId. */
    getUserList(roomId: string): UserInfo[];

    /** Проверить правильность пароля от комнаты. */
    checkPassword(id: string, pass: string): Promise<boolean>;
}

export class PlainRoomRepository implements IRoomRepository
{
    private readonly ROOMS_FILE_PATH = path.resolve(process.cwd(), "config", "rooms.json");
    private readonly hashSalt = Buffer.from(process.env.ROOM_PASS_HASH_SALT!, "hex");
    private rooms = new Map<string, IRoom>();
    private latestRoomIndex = 0;
    private mediasoup: IMediasoupService;

    constructor(mediasoup: IMediasoupService)
    {
        this.mediasoup = mediasoup;
    }

    public async init(): Promise<void>
    {
        if (fs.existsSync(this.ROOMS_FILE_PATH))
        {
            const fileContent = fs.readFileSync(this.ROOMS_FILE_PATH, 'utf-8');
            if (fileContent)
            {
                const roomsFromJson = JSON.parse(fileContent) as RoomInfo[];

                for (const room of roomsFromJson)
                {
                    this.rooms.set(room.id, await Room.create(
                        room.id, room.name, room.hashPassword, room.videoCodec,
                        this.mediasoup)
                    );
                }

                if (roomsFromJson.length > 0)
                {
                    this.latestRoomIndex = Number(roomsFromJson[roomsFromJson.length - 1].id) + 1;
                }

                if (this.rooms.size > 0)
                {
                    console.log(`[PlainRoomRepository] Info about ${this.rooms.size} rooms has been loaded from the 'rooms.json' file.`);
                }
            }
        }
    }

    public async create(info: NewRoomInfo): Promise<string>
    {
        const { name, password, videoCodec } = info;

        const id = String(this.latestRoomIndex++);

        let hashPassword = "";
        if (password.length > 0)
        {
            hashPassword = await this.generateHashPassword(password);
        }

        this.rooms.set(id, await Room.create(
            id, name, hashPassword, videoCodec,
            this.mediasoup
        ));

        await this.rewriteRoomsToFile();

        return id;
    }

    public async remove(id: string): Promise<void>
    {
        const room = this.rooms.get(id);

        if (room)
        {
            room.close();
            this.rooms.delete(id);

            await this.rewriteRoomsToFile();
        }
    }

    public async update(info: UpdateRoomInfo)
    {
        const { id, name, password } = info;

        const room = this.rooms.get(id)!;

        if (name)
        {
            room.name = name;
        }

        if (password != undefined)
        {
            let hashPassword = "";
            if (password.length > 0)
            {
                hashPassword = await this.generateHashPassword(password);
            }

            room.password = hashPassword;
        }

        await this.rewriteRoomsToFile();
    }

    public get(id: string): IRoom | undefined
    {
        return this.rooms.get(id);
    }

    public has(id: string): boolean
    {
        return this.rooms.has(id);
    }

    public getRoomLinkList(): PublicRoomInfo[]
    {
        const roomList: PublicRoomInfo[] = [];

        for (const roomRec of this.rooms)
        {
            const room = roomRec[1];
            roomList.push({
                id: room.id,
                name: room.name,
                videoCodec: room.videoCodec
            });
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

    /** Полностью обновить содержимое файла с записями о комнатах. */
    private async rewriteRoomsToFile(): Promise<void>
    {
        return new Promise((resolve, reject) =>
        {
            // Создаём новый стрим для того, чтобы полностью перезаписать файл.
            const writeStream = fs.createWriteStream(this.ROOMS_FILE_PATH, { encoding: "utf8" });

            const roomsArr: RoomInfo[] = [];
            for (const roomRecord of this.rooms)
            {
                const room = roomRecord[1];
                roomsArr.push({
                    id: room.id,
                    name: room.name,
                    hashPassword: room.password,
                    videoCodec: room.videoCodec
                });
            }

            writeStream.write(JSON.stringify(roomsArr, null, 2));

            writeStream.on("finish", () =>
            {
                resolve();
            });

            writeStream.on("error", (err: Error) =>
            {
                reject(err);
            });

            writeStream.end();
        });
    }

    private async generateHashPassword(pass: string): Promise<string>
    {
        return new Promise((resolve, reject) =>
        {
            scrypt(pass, this.hashSalt, 24, (err, derivedKey) =>
            {
                if (err)
                {
                    reject();
                }
                else
                {
                    // Поскольку этот хеш может использоваться в URL-запросе.
                    const toBase64Url = (str: string) =>
                    {
                        return str.replace(/\+/g, '-')
                            .replace(/\//g, '_')
                            .replace(/=/g, '');
                    };

                    resolve(toBase64Url(derivedKey.toString("base64")));
                }
            });
        });
    }

    public async checkPassword(id: string, pass: string): Promise<boolean>
    {
        const room = this.get(id);

        if (!room)
        {
            return false;
        }

        // Если нам передали хеш от пароля (или пароля нет вообще).
        if (room.password == pass)
        {
            return true;
        }

        // Иначе посчитаем хеш.
        const hashPassword = await this.generateHashPassword(pass);
        return (room.password == hashPassword);
    }
}