import { mediasoupTypes } from "./Mediasoup";
import { SocketId } from "./SocketHandler";
// номер комнаты
export type RoomId = string;

// пользователь комнаты
class User
{
    private userId : SocketId;
    public consume: boolean = true;
    public rtpCapabilities? : mediasoupTypes.RtpCapabilities;

    constructor (_userId : SocketId)
    {
        this.userId = _userId;
    }
}

// комнаты
export class Room
{
    // номер комнаты
    private _id: RoomId;
    public get id(): RoomId { return this._id; }

    // название комнаты
    private _name: string;
    public get name(): string { return this._name; }
    public set name(value: string) { this._name = value; }

    // пароль комнаты
    private _password: string;
    public get password(): string { return this._password; }
    public set password(value: string) { this._password = value; }

    // mediasoup Router
    private _mediasoupRouter: mediasoupTypes.Router;
    public get mediasoupRouter(): mediasoupTypes.Router { return this._mediasoupRouter; }

    // пользователи в комнате
    private _users = new Map<SocketId, User>();
    public get users() { return new Set(this._users.keys()); }

    constructor(roomId: RoomId, name: string, password: string, router: mediasoupTypes.Router)
    {
        console.log(`creating a new Room [${roomId}, ${name}]`);
        this._id = roomId;
        this._name = name;
        this._password = password;
        this._mediasoupRouter = router;
    }

    public join(userId: SocketId): void
    {
        console.log(`[${this._id}, ${this._name}]: ${userId} user connected`);
        this._users.set(userId, new User(userId));
    }

    public leave(userId: SocketId, reason : string): void
    {
        console.log(`[${this._id}, ${this._name}]: ${userId} user disconnected`, reason);
        this._users.delete(userId);
    }

    public close(): void
    {
        console.log(`closing Room [${this._id}]`);
        this._mediasoupRouter.close();
    }
}