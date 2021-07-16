import { io, Socket } from "socket.io-client";

type Room = {
    id: string,
    name: string;
};

// Класс для работы с сокетами на главной странице
export default class indexSocketHandler
{
    private socket: Socket = io("/", {
        'transports': ['websocket']
    });

    private roomList: HTMLDivElement;

    constructor()
    {
        console.debug("indexSocketHandler ctor");

        this.roomList = document.getElementById('roomList') as HTMLDivElement;

        this.socket.on('connect', () =>
        {
            console.info("Создано подключение веб-сокета");
            console.info("Client Id:", this.socket.id);
        });

        this.socket.on('connect_error', (err: Error) =>
        {
            console.log(err.message);
        });

        this.socket.on('roomList', (rooms: Room[]) => this.createRoomList(rooms));
        this.socket.on('newRoom', (room: Room) => this.addRoomToList(room));
        this.socket.on('deletedRoom', (id: string) => this.removeRoomFromList(id));

        this.socket.on('disconnect', () => this.onDisconnect());
    }

    private createRoomList(rooms: Room[]): void
    {
        for (const room of rooms)
        {
            this.addRoomToList(room);
        }
    }

    private addRoomToList(room: Room): void
    {
        let roomListItem = document.createElement('a');
        roomListItem.classList.add('roomListItem');
        roomListItem.id = room.id;
        roomListItem.href = `/rooms/${room['id']}`;
        roomListItem.innerText = room['name'];

        this.roomList.appendChild(roomListItem);
    }

    private removeRoomFromList(id: string): void
    {
        let room = document.getElementById(id);
        if (room) room.remove();
    }

    private onDisconnect(): void
    {
        console.warn("Вы были отсоединены от веб-сервера (websocket disconnect)");
        const roomList: NodeListOf<HTMLAnchorElement> = document.querySelectorAll(".roomListItem");
        console.log(roomList);
        for (const room of roomList)
        {
            console.log(room);
            room.remove();
        }
    }
}