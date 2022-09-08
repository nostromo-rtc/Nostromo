import path = require('path');
import { scrypt } from "crypto";
import { nanoid } from "nanoid";
import { IUserAccountRepository } from "../User/UserAccountRepository";

import { NewRoomInfo, UpdateRoomInfo } from "nostromo-shared/types/AdminTypes";
import { RoomInfo, PublicRoomInfo } from "nostromo-shared/types/RoomTypes";
import { UserInfo } from "nostromo-shared/types/RoomTypes";
import { IMediasoupService } from "../MediasoupService";
import { IRoom, Room } from "./Room";
import { readFromFileSync, writeToFile } from "../Utils";

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

    /** Получить список пользователей в комнате roomId.
     * @throws Error, если не существует комнаты roomId.
     * @throws Error, если не удалось найти информацию об активном пользователе userId.
     */
    getActiveUserList(roomId: string): UserInfo[];

    /** Получить socketId у активного пользователя userId в комнате roomId.
     * @throws Error, если не существует комнаты roomId.
     * @throws Error, если userId не является активным пользователем roomId.
    */
    getActiveUserSocketId(roomId: string, userId: string): string;

    /** Проверить правильность пароля от комнаты. */
    checkPassword(id: string, pass: string): Promise<boolean>;

    /** Проверить, есть ли пароль у комнаты. */
    isEmptyPassword(id: string): boolean;

    /** Проверить, нужно ли сохранять сообщения в историю чата комнаты. */
    getSaveChatPolicy(id: string): boolean;

    /** Симметричный ли режим конференции? */
    isSymmetricMode(id: string): boolean;

    /** Очистить список пользователей-докладчиков. */
    clearSpeakerUsersList(id: string): void;

    /** Добавить пользователя в список пользователей-докладчиков. */
    addUserToSpeakerUsersList(roomId: string, userId: string): void;

    /** Удалить пользователя из списка пользователей-докладчиков. */
    removeUserFromSpeakerUsersList(roomId: string, userId: string): void;
}

export class PlainRoomRepository implements IRoomRepository
{
    private readonly className = "PlainRoomRepository";
    private readonly ROOMS_FILE_PATH = path.resolve(process.cwd(), "data", "rooms.json");
    private readonly hashSalt = Buffer.from(process.env.ROOM_PASS_HASH_SALT!);
    private rooms = new Map<string, IRoom>();
    private mediasoup: IMediasoupService;
    private userAccountRepository: IUserAccountRepository;

    constructor(
        mediasoup: IMediasoupService,
        userAccountRepository: IUserAccountRepository
    )
    {
        this.mediasoup = mediasoup;
        this.userAccountRepository = userAccountRepository;
    }

    /** Полностью обновить содержимое файла с записями о комнатах. */
    private async writeDataToFile(): Promise<void>
    {
        const roomsArr: RoomInfo[] = [];
        for (const room of this.rooms.values())
        {
            roomsArr.push({
                id: room.id,
                name: room.name,
                hashPassword: room.password,
                videoCodec: room.videoCodec,
                saveChatPolicy: room.saveChatPolicy,
                symmetricMode: room.symmetricMode
            });
        }

        try
        {
            await writeToFile(this.ROOMS_FILE_PATH, roomsArr);
        }
        catch (error)
        {
            console.error(`[ERROR] [${this.className}] Can't write data to file.`);
        }
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

    public async init(): Promise<void>
    {
        const fileContent = readFromFileSync(this.ROOMS_FILE_PATH);
        if (fileContent)
        {
            const roomsFromJson = JSON.parse(fileContent) as RoomInfo[];

            for (const room of roomsFromJson)
            {
                this.rooms.set(room.id, await Room.create(room, this.mediasoup));
            }

            if (this.rooms.size > 0)
            {
                console.log(`[${this.className}] Info about ${this.rooms.size} rooms has been loaded from the 'rooms.json' file.`);
            }
        }

    }

    public async create(info: NewRoomInfo): Promise<string>
    {
        const { name, password, videoCodec, saveChatPolicy, symmetricMode } = info;

        let id: string = nanoid(11);
        while (this.rooms.has(id))
        {
            id = nanoid(11);
        }

        let hashPassword = "";
        if (password.length > 0)
        {
            hashPassword = await this.generateHashPassword(password);
        }

        const fullRoomInfo: RoomInfo = { id, name, hashPassword, videoCodec, saveChatPolicy, symmetricMode };

        this.rooms.set(id, await Room.create(fullRoomInfo, this.mediasoup));

        await this.writeDataToFile();

        console.log(`[${this.className}] Room [${id}, '${info.name}', ${info.videoCodec}] was created.`);

        return id;
    }

    public async remove(id: string): Promise<void>
    {
        const room = this.rooms.get(id);

        if (!room)
        {
            console.error(`[ERROR] [${this.className}] Can't delete Room [${id}], because it's not exist.`);
            return;
        }

        // Закроем комнату.
        room.close();

        // Удалим запись о комнате.
        this.rooms.delete(id);

        await this.writeDataToFile();
        console.log(`[${this.className}] Room [${id}, '${room.name}', ${room.videoCodec}] was deleted.`);
    }

    public async update(info: UpdateRoomInfo)
    {
        const { id, name, password, saveChatPolicy, symmetricMode } = info;

        const room = this.rooms.get(id);

        if (!room)
        {
            console.error(`[ERROR] [${this.className}] Can't update Room [${id}], because it's not exist.`);
            return;
        }

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

        if (saveChatPolicy != undefined)
        {
            room.saveChatPolicy = saveChatPolicy;
        }

        if (symmetricMode != undefined)
        {
            room.symmetricMode = symmetricMode;
        }

        await this.writeDataToFile();

        console.log(`[${this.className}] Room [${id}, '${room.name}', ${room.videoCodec}] was updated.`);
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

    public getActiveUserList(roomId: string): UserInfo[]
    {
        const room = this.rooms.get(roomId);

        if (!room)
        {
            throw new Error(`Room [${roomId}] is not exist.`);
        }

        const userList: UserInfo[] = [];

        for (const userId of room.activeUsers.keys())
        {
            const user = this.userAccountRepository.get(userId);
            if (!user)
            {
                throw new Error(`User [${userId}] is not exist.`);
            }
            userList.push({ id: userId, name: user.name });
        }

        return userList;
    }

    public getActiveUserSocketId(roomId: string, userId: string): string
    {
        const room = this.rooms.get(roomId);

        if (!room)
        {
            throw new Error(`Room [${roomId}] is not exist.`);
        }

        const user = room.activeUsers.get(userId);

        if (!user)
        {
            throw new Error(`User [${userId}] is not active user in Room [${roomId}].`);
        }

        return user.socketId;
    }

    public async checkPassword(id: string, pass: string): Promise<boolean>
    {
        const room = this.get(id);

        if (!room)
        {
            console.error(`[ERROR] [${this.className}] Can't check Room [${id}] password, because room is not exist.`);
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

    public isEmptyPassword(id: string): boolean
    {
        const room = this.get(id);

        if (!room)
        {
            console.error(`[ERROR] [${this.className}] Can't check Room [${id}] password for emptiness, because room is not exist.`);
            return false;
        }

        return (room.password.length == 0);
    }

    public getSaveChatPolicy(id: string): boolean
    {
        const room = this.get(id);

        if (!room)
        {
            console.error(`[ERROR] [${this.className}] Can't check Room [${id}] chat saving policy, because room is not exist.`);
            return false;
        }

        return room.saveChatPolicy;
    }

    public isSymmetricMode(id: string): boolean
    {
        const room = this.get(id);

        if (!room)
        {
            console.error(`[ERROR] [${this.className}] Can't check Room [${id}] mode, because room is not exist.`);
            return false;
        }

        return room.symmetricMode;
    }

    public clearSpeakerUsersList(id: string): void
    {
        const room = this.get(id);

        if (!room)
        {
            console.error(`[ERROR] [${this.className}] Can't clear Room [${id}] speaker users list, because room is not exist.`);
            return;
        }

        room.speakerUsers.clear();
    }

    public addUserToSpeakerUsersList(roomId: string, userId: string): void
    {
        const room = this.get(roomId);

        if (!room)
        {
            console.error(`[ERROR] [${this.className}] Can't add user to Room [${roomId}] speaker users list, because room is not exist.`);
            return;
        }

        room.speakerUsers.add(userId);
    }

    public removeUserFromSpeakerUsersList(roomId: string, userId: string): void
    {
        const room = this.get(roomId);

        if (!room)
        {
            console.error(`[ERROR] [${this.className}] Can't delete user from Room [${roomId}] speaker users list, because room is not exist.`);
            return;
        }

        room.speakerUsers.delete(userId);
    }
}