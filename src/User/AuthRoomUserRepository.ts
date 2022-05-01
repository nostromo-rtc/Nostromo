import path = require('path');
import fs = require('fs');

/** Authorized Room Users. */
export interface IAuthRoomUserRepository
{
    /** Создать запись об авторизации пользователя userId в комнате roomId. */
    create(roomId: string, userId: string): Promise<void>;

    /** Удалить запись об авторизации пользователя userId в комнате roomId. */
    remove(roomId: string, userId: string): Promise<void>;

    /** Удалить все записи об авторизациях пользователей в комнате roomId. */
    removeAll(roomId: string): Promise<void>;

    /** Получить список авторизованных пользователей в комнате roomId. */
    get(roomId: string): string[] | undefined;

    /** Есть ли запись об авторизованном пользователе userId в комнате roomId? */
    has(roomId: string, userId: string): boolean;
}

type AuthorizationRecords = {
    roomId: string,
    userIds: string[]
};

export class PlainAuthRoomUserRepository implements IAuthRoomUserRepository
{
    private readonly className = "PlainAuthRoomUserRepository";

    private readonly AUTH_ROOM_USERS_FILE_PATH = path.resolve(process.cwd(), "data", "auth-room-users.json");

    /** Идентификаторы авторизованных пользователей в комнате. */
    private authRoomUsers = new Map<string, AuthorizationRecords>();

    constructor()
    {
        this.init();
    }

    /** Полностью обновить содержимое файла с Id пользователей, авторизованных в комнатах. */
    private async rewriteAuthRoomUsersToFile(): Promise<void>
    {
        return new Promise((resolve, reject) =>
        {
            // Создаём новый стрим для того, чтобы полностью перезаписать файл.
            const writeStream = fs.createWriteStream(this.AUTH_ROOM_USERS_FILE_PATH, { encoding: "utf8" });

            writeStream.write(JSON.stringify(Array.from(this.authRoomUsers.values()), null, 2));

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

    public init(): void
    {
        if (fs.existsSync(this.AUTH_ROOM_USERS_FILE_PATH))
        {
            const fileContent = fs.readFileSync(this.AUTH_ROOM_USERS_FILE_PATH, 'utf-8');
            if (fileContent)
            {
                const authRoomUsersFromJson = JSON.parse(fileContent) as AuthorizationRecords[];

                for (const records of authRoomUsersFromJson)
                {
                    this.authRoomUsers.set(records.roomId, records);
                }

                if (this.authRoomUsers.size > 0)
                {
                    console.log(`[${this.className}] Info about ${this.authRoomUsers.size} rooms with authorization user records has been loaded from the 'auth-room-users.json' file.`);
                }
            }
        }
    }

    public async create(roomId: string, userId: string): Promise<void>
    {
        let users = this.authRoomUsers.get(roomId);

        if (!users)
        {
            this.authRoomUsers.set(roomId, {roomId, userIds: []});
            users = this.authRoomUsers.get(roomId)!;
        }

        users.userIds.push(userId);
        await this.rewriteAuthRoomUsersToFile();

        console.log(`[${this.className}] New authorization record for User [${userId}] in Room [${roomId}] was created.`);
    }

    public async remove(roomId: string, userId: string): Promise<void>
    {
        const users = this.authRoomUsers.get(roomId);
        const idx = users?.userIds?.indexOf(userId);

        if (!users || idx == undefined || idx == -1)
        {
            console.error(`[ERROR] [${this.className}] Can't remove authorization record for User [${userId}] in Room [${roomId}].`);
            return;
        }

        users.userIds.splice(idx, 1);
        await this.rewriteAuthRoomUsersToFile();

        console.log(`[${this.className}] Authorization record for User [${userId}] in Room [${roomId}] was removed.`);
    }

    public async removeAll(roomId: string): Promise<void>
    {
        this.authRoomUsers.delete(roomId);
        await this.rewriteAuthRoomUsersToFile();

        console.log(`[${this.className}] Authorization records of users in Room [${roomId}] were removed.`);
    }

    public get(roomId: string): string[] | undefined
    {
        return this.authRoomUsers.get(roomId)?.userIds;
    }

    public has(roomId: string, userId: string): boolean
    {
        const users = this.authRoomUsers.get(roomId);
        const idx = users?.userIds?.indexOf(userId);

        if (!users || idx == undefined || idx == -1)
        {
            return false;
        }

        return true;
    }
}