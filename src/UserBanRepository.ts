import { UserBanInfo } from "nostromo-shared/types/AdminTypes";
import path = require('path');
import fs = require('fs');

export interface IUserBanRepository
{
    /** Создать запись о блокировке пользователя. */
    create(info: UserBanInfo): Promise<string>;

    /** Удалить запись о блокировке пользователя. */
    remove(ip: string): Promise<void>;

    /** Получить запись о блокировке пользователя по ip-адресу. */
    get(ip: string): UserBanInfo | undefined;

    /** Есть ли запись о блокировке пользователя с указанным ip-адресом? */
    has(ip: string): boolean;
}

export class UserBanRepository implements IUserBanRepository
{
    private readonly BANS_FILE_PATH = path.resolve(process.cwd(), "config", "bans.json");
    private bans = new Map<string, UserBanInfo>();
    private bansFileWS = fs.createWriteStream(this.BANS_FILE_PATH, { encoding: "utf8", flags: "a+" });

    constructor()
    {
        if (fs.existsSync(this.BANS_FILE_PATH))
        {
            const fileContent = fs.readFileSync(this.BANS_FILE_PATH, 'utf-8');
            if (fileContent)
            {
                const bansFromJson = JSON.parse(fileContent) as UserBanInfo[];
                for (const banRecord of bansFromJson)
                {
                    this.bans.set(banRecord.ip, banRecord);
                }
                console.log(`[UserBanRepository] Info about ${this.bans.size} banned users has been loaded from the 'bans.json' file.`)
            }
        }
    }

    /** Полностью обновить содержимое файла с записями о блокировках пользователя. */
    private async rewriteBansToFile(): Promise<void>
    {
        return new Promise((resolve, reject) =>
        {
            // Создаём новый стрим для того, чтобы полностью перезаписать файл.
            const bansFileWS = fs.createWriteStream(this.BANS_FILE_PATH, { encoding: "utf8" });

            bansFileWS.write(JSON.stringify(Array.from(this.bans.values()), null, 2));

            bansFileWS.on("finish", () =>
            {
                resolve();
            });

            bansFileWS.on("error", (err: Error) =>
            {
                reject(err);
            });

            bansFileWS.end();
        });
    }

    /** Полностью обновить содержимое файла с записями о блокировках пользователя. */
    private async appendBanToFile(info: UserBanInfo): Promise<void>
    {
        return new Promise((resolve, reject) =>
        {
            // Дописываем в конец новую запись о блокировки пользователя.
            this.bansFileWS.write(JSON.stringify(info) + "\r\n", (err) =>
            {
                if (err)
                {
                    reject(err);
                }
                else
                {
                    resolve();
                }
            });
        });
    }

    public async create(info: UserBanInfo): Promise<string>
    {
        const { ip } = info;

        this.bans.set(ip, info);

        //await this.appendBanToFile(info);
        await this.rewriteBansToFile();

        return ip;
    }

    public async remove(ip: string): Promise<void>
    {
        const ban = this.bans.get(ip);

        if (ban)
        {
            this.bans.delete(ip);

            await this.rewriteBansToFile();
        }
    }

    public get(ip: string): UserBanInfo | undefined
    {
        return this.bans.get(ip);
    }

    public has(ip: string): boolean
    {
        return this.bans.has(ip);
    }
}