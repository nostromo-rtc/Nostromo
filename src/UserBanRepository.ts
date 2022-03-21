import { UserBanInfo } from "nostromo-shared/types/AdminTypes";
import path = require('path');
import fs = require('fs');

export interface IUserBanRepository
{
    /** Создать запись о блокировке пользователя. */
    create(info: UserBanInfo): string;

    /** Удалить запись о блокировке пользователя. */
    remove(ip: string): void;

    /** Получить запись о блокировке пользователя по ip-адресу. */
    get(ip: string): UserBanInfo | undefined;

    /** Есть ли запись о блокировке пользователя с указанным ip-адресом? */
    has(ip: string): boolean;
}

export class UserBanRepository implements IUserBanRepository
{
    private readonly BANS_FILE_PATH = path.resolve(process.cwd(), "config", "bans.txt");
    private bans = new Map<string, UserBanInfo>();
    private bansFileWS = fs.createWriteStream(this.BANS_FILE_PATH, { flags: 'a+', encoding: "utf8" });

    public create(info: UserBanInfo): string
    {
        const { ip } = info;

        this.bans.set(ip, info);

        //this.bansFileWS.write(info);

        return ip;
    }

    public remove(ip: string): void
    {
        const ban = this.bans.get(ip);

        if (ban)
        {
            this.bans.delete(ip);
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