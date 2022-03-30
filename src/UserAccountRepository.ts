import { nanoid } from "nanoid";

interface UserAccount
{
    /** Идентификатор аккаунта пользователя. */
    id: string;
    /** Роль пользователя. */
    role: string;
    /** Список идентификаторов комнат, в которых пользователь авторизован. */
    authRooms: Set<string>;
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

    /** Авторизован ли пользователь userId в комнате с заданным roomId? */
    isAuthInRoom(userId: string, roomId: string): boolean;

    /** Запомнить, что пользователь userId авторизован в комнате roomId. */
    setAuthInRoom(userId: string, roomId: string): void;

    /** Запомнить, что пользователь userId больше не авторизован в комнате roomId. */
    unsetAuthInRoom(userId: string, roomId: string): void;
}

export class UserAccountRepository implements IUserAccountRepository
{
    private users = new Map<string, UserAccount>();
    public create(info: NewUserAccountInfo): string
    {
        const id: string = nanoid(21);

        const userAccount: UserAccount = {
            id,
            role: info.role,
            authRooms: new Set<string>()
        };

        this.users.set(id, userAccount);

        return id;
    }

    public remove(id: string): void
    {
        const user = this.users.get(id);

        if (user)
        {
            this.users.delete(id);
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

    public isAuthInRoom(userId: string, roomId: string): boolean
    {
        const user = this.users.get(userId);

        if (!user)
        {
            return false;
        }

        return user.authRooms.has(roomId);
    }

    public setAuthInRoom(userId: string, roomId: string): void
    {
        const user = this.users.get(userId);

        if (!user)
        {
            return;
        }

        user.authRooms.add(roomId);
    }
    public unsetAuthInRoom(userId: string, roomId: string): void
    {
        const user = this.users.get(userId);

        if (!user)
        {
            return;
        }

        user.authRooms.delete(roomId);
    }
}