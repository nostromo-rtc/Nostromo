export interface IAuthRoomUserRepository
{
    /** Создать запись об авторизации пользователя userId в комнате roomId. */
    create(roomId: string, userId: string): void;

    /** Удалить запись об авторизации пользователя userId в комнате roomId. */
    remove(roomId: string, userId: string): void;

    /** Удалить все записи об авторизациях пользователей в комнате roomId. */
    removeAll(roomId: string): void;

    /** Получить список авторизованных пользователей в комнате roomId. */
    get(roomId: string): Set<string> | undefined;

    /** Есть ли запись об авторизованном пользователе userId в комнате roomId? */
    has(roomId: string, userId: string): boolean;
}

export class AuthRoomUserRepository implements IAuthRoomUserRepository
{
    /** Идентификаторы авторизованных пользователей в комнате. */
    private roomAuthUsers = new Map<string, Set<string>>();

    public create(roomId: string, userId: string): void
    {
        let users = this.roomAuthUsers.get(roomId);

        if (!users)
        {
            this.roomAuthUsers.set(roomId, new Set());
            users = this.roomAuthUsers.get(roomId)!;
        }

        users.add(userId);

        console.log(`[AuthRoomUserRepository] New authorization record for User [${userId}] in Room [${roomId}] was created.`);
    }

    public remove(roomId: string, userId: string): void
    {
        const users = this.roomAuthUsers.get(roomId);

        if (!users)
        {
            console.error(`[ERROR] [AuthRoomUserRepository] Can't remove authorization record for User [${userId}] in Room [${roomId}].`);
            return;
        }

        users.delete(userId);
        console.log(`[AuthRoomUserRepository] Authorization record for User [${userId}] in Room [${roomId}] was removed.`);
    }

    public removeAll(roomId: string): void
    {
        this.roomAuthUsers.delete(roomId);
        console.log(`[AuthRoomUserRepository] Authorization records of users in Room [${roomId}] were removed.`);
    }

    public get(roomId: string): Set<string> | undefined
    {
        return this.roomAuthUsers.get(roomId);
    }

    public has(roomId: string, userId: string): boolean
    {
        const users = this.roomAuthUsers.get(roomId);

        if (!users)
        {
            return false;
        }

        return users.has(userId);
    }
}