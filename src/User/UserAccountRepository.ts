import path = require('path');
import fs = require('fs');
import { nanoid } from "nanoid";

export interface UserAccount
{
    /** Идентификатор аккаунта пользователя. */
    readonly id: string;

    /** Имя пользователя. */
    name: string;

    /** Роль пользователя. */
    role: string;
}

interface NewUserAccountInfo
{
    role: string;
}

export interface IUserAccountRepository
{
    /** Создать запись об аккаунте пользователя. */
    create(info: NewUserAccountInfo): Promise<string>;

    /** Удалить запись об аккаунте пользователя. */
    remove(id: string): Promise<void>;

    /** Получить запись об аккаунте пользователя. */
    get(id: string): UserAccount | undefined;

    /** Есть ли запись об этом аккаунте? */
    has(id: string): boolean;

    /** Установить новое имя пользователя. */
    setUsername(id: string, name: string): Promise<void>;

    /** Установить новую роль для пользователя. */
    setRole(id: string, role: string): Promise<void>;

    /** Получить имя пользователя. */
    getUsername(id: string): string | undefined;

    /** Является ли пользователь администратором? */
    isAdmin(id: string): boolean;
}

export class PlainUserAccountRepository implements IUserAccountRepository
{
    private readonly className = "PlainUserAccountRepository";

    private readonly USERS_FILE_PATH = path.resolve(process.cwd(), "data", "users.json");

    private users = new Map<string, UserAccount>();

    constructor()
    {
        this.init();
    }

    /** Полностью обновить содержимое файла с записями о пользователях. */
    private async rewriteUsersToFile(): Promise<void>
    {
        return new Promise((resolve, reject) =>
        {
            // Создаём новый стрим для того, чтобы полностью перезаписать файл.
            const writeStream = fs.createWriteStream(this.USERS_FILE_PATH, { encoding: "utf8" });

            writeStream.write(JSON.stringify(Array.from(this.users.values()), null, 2));

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
        if (fs.existsSync(this.USERS_FILE_PATH))
        {
            const fileContent = fs.readFileSync(this.USERS_FILE_PATH, 'utf-8');
            if (fileContent)
            {
                const usersFromJson = JSON.parse(fileContent) as UserAccount[];

                for (const user of usersFromJson)
                {
                    this.users.set(user.id, user);
                }

                if (this.users.size > 0)
                {
                    console.log(`[${this.className}] Info about ${this.users.size} users has been loaded from the 'users.json' file.`);
                }
            }
        }
    }

    public async create(info: NewUserAccountInfo): Promise<string>
    {
        let id: string = nanoid(21);
        while (this.users.has(id))
        {
            id = nanoid(21);
        }

        const userAccount: UserAccount = {
            id,
            name: "Гость",
            role: info.role
        };

        this.users.set(id, userAccount);
        await this.rewriteUsersToFile();

        console.log(`[${this.className}] New user account [Id: ${id}] was created.`);

        return id;
    }

    public async remove(id: string): Promise<void>
    {
        if (!this.users.has(id))
        {
            console.error(`[ERROR] [${this.className}] Can't delete user account [${id}], because it's not exist.`);
            return;
        }

        this.users.delete(id);
        await this.rewriteUsersToFile();

        console.log(`[${this.className}] User account [Id: ${id}] was deleted.`);

    }

    public get(id: string): UserAccount | undefined
    {
        return this.users.get(id);
    }

    public has(id: string): boolean
    {
        return this.users.has(id);
    }

    public async setUsername(id: string, name: string): Promise<void>
    {
        const user = this.users.get(id);

        if (!user)
        {
            console.error(`[ERROR] [${this.className}] Can't rename user account [${id}], because it's not exist.`);
            return;
        }

        const oldName = user.name;
        user.name = name;

        await this.rewriteUsersToFile();

        console.log(`[${this.className}] User [Id: ${id}, '${oldName}'] has a new name: '${name}'.`);
    }

    public async setRole(id: string, role: string): Promise<void>
    {
        const user = this.users.get(id);

        if (!user)
        {
            console.error(`[ERROR] [${this.className}] Can't set new role for user account [${id}], because it's not exist.`);
            return;
        }

        user.role = role;

        await this.rewriteUsersToFile();

        console.log(`[${this.className}] User [Id: ${id}, '${user.name}'] has a new role: '${role}'.`);
    }

    public getUsername(id: string): string | undefined
    {
        const user = this.users.get(id);

        if (!user)
        {
            console.error(`[ERROR] [${this.className}] Can't get username of User [${id}], because user is not exist.`);
            return;
        }

        return user.name;
    }

    public isAdmin(id: string): boolean
    {
        const user = this.users.get(id);

        if (!user)
        {
            console.error(`[ERROR] [${this.className}] Can't check role of User [${id}], because user is not exist.`);
            return false;
        }

        return user.role == "admin";
    }
}