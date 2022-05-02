import path = require("path");
import { UserBanInfo } from "nostromo-shared/types/AdminTypes";
import { readFromFileSync, writeToFile } from "../Utils";

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

export class PlainUserBanRepository implements IUserBanRepository
{
    private readonly className = "PlainUserBanRepository";
    private readonly BANS_FILE_PATH = path.resolve(process.cwd(), "data", "bans.json");
    private bans = new Map<string, UserBanInfo>();

    constructor()
    {
        this.init();
    }

    private init()
    {
        const fileContent = readFromFileSync(this.BANS_FILE_PATH);
        if (fileContent)
        {
            const bansFromJson = JSON.parse(fileContent) as UserBanInfo[];
            for (const banRecord of bansFromJson)
            {
                this.bans.set(banRecord.ip, banRecord);
            }
            if (this.bans.size > 0)
            {
                console.log(`[${this.className}] Info about ${this.bans.size} banned users has been loaded from the 'bans.json' file.`);
            }
        }
    }

    /** Полностью обновить содержимое файла с записями о блокировках пользователя. */
    private async writeDataToFile(): Promise<void>
    {
        try
        {
            await writeToFile(this.BANS_FILE_PATH, Array.from(this.bans.values()));
        }
        catch (error)
        {
            console.error(`[ERROR] [${this.className}] Can't write data to file.`);
        }
    }

    public async create(info: UserBanInfo): Promise<string>
    {
        const { ip } = info;

        this.bans.set(ip, info);
        await this.writeDataToFile();
        console.log(`[${this.className}] User [Ip: ${ip}] has been banned.`);

        return ip;
    }

    public async remove(ip: string): Promise<void>
    {
        const ban = this.bans.get(ip);

        if (!ban)
        {
            console.error(`[ERROR] [${this.className}] Can't unban User [Ip: ${ip}], because that user is not banned.`);
            return;
        }

        this.bans.delete(ip);
        await this.writeDataToFile();
        console.log(`[${this.className}] User [Ip: ${ip}] has been unbanned.`);
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