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
    create(info: NewUserAccountInfo): string;

    /** Удалить запись об аккаунте пользователя. */
    remove(id: string): void;

    /** Получить запись об аккаунте пользователя. */
    get(id: string): UserAccount | undefined;

    /** Есть ли запись об этом аккаунте? */
    has(id: string): boolean;

    /** Установить новое имя пользователя. */
    setUsername(id: string, name: string): void;

    /** Получить имя пользователя. */
    getUsername(id: string): string | undefined;
}

export class UserAccountRepository implements IUserAccountRepository
{
    private users = new Map<string, UserAccount>();

    public create(info: NewUserAccountInfo): string
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
        console.log(`[UserAccountRepository] New user account [Id: ${id}] was created.`);

        return id;
    }

    public remove(id: string): void
    {
        if (!this.users.has(id))
        {
            console.error(`[ERROR] [UserAccountRepository] Can't delete user account [${id}], because it's not exist.`);
            return;
        }

        this.users.delete(id);
        console.log(`[UserAccountRepository] User account [Id: ${id}] was deleted.`);

    }

    public get(id: string): UserAccount | undefined
    {
        return this.users.get(id);
    }

    public has(id: string): boolean
    {
        return this.users.has(id);
    }

    public setUsername(id: string, name: string): void
    {
        const user = this.users.get(id);

        if (!user)
        {
            console.error(`[ERROR] [UserAccountRepository] Can't rename user account [${id}], because it's not exist.`);
            return;
        }

        const oldName = user.name;
        user.name = name;

        console.log(`[UserAccountRepository] User [Id: ${id}, '${oldName}'] has a new name: '${name}'.`);
    }

    public getUsername(id: string): string | undefined
    {
        const user = this.users.get(id);

        if (!user)
        {
            console.error(`[ERROR] [UserAccountRepository] Can't get username of User [${id}], because user is not exist.`);
            return;
        }

        return user.name;
    }
}