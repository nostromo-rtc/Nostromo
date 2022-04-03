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
        const id: string = nanoid(21);

        const userAccount: UserAccount = {
            id,
            name: "Гость",
            role: info.role
        };

        this.users.set(id, userAccount);

        console.log(`[UserAccountRepository] Create a new user account [Id: ${id}].`);

        return id;
    }

    public remove(id: string): void
    {
        const user = this.users.get(id);

        if (user)
        {
            this.users.delete(id);

            console.log(`[UserAccountRepository] Delete a user account [Id: ${id}].`);
        }
    }

    public get(id: string): UserAccount | undefined
    {
        return this.users.get(id);
    }

    public has(id: string): boolean
    {
        return this.users.has(id);
    }

    public setUsername(id: string, name: string)
    {
        const user = this.users.get(id);

        if (user)
        {
            console.log(`[UserAccountRepository] User [Id: ${id}, '${user.name}'] has a new name: '${name}'.`);
            user.name = name;
        }
    }

    public getUsername(id: string): string | undefined
    {
        return this.users.get(id)?.name;
    }
}