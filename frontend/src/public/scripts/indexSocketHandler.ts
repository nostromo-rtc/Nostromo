import { io, Socket } from "socket.io-client";

type Room = {
    id: string,
    name: string;
};

// Класс для работы с сокетами на главной странице
export default class indexSocketHandler {
    private socket: Socket = io("/", {
        'transports': ['websocket']
    });

    constructor() {
        console.debug("indexSocketHandler ctor");
        this.socket.on('connect', () => {
            console.info("Создано подключение веб-сокета");
            console.info("Client ID:", this.socket.id);
        });

        this.socket.on('connect_error', (err : Error) => {
            console.log(err.message);
        });

        this.socket.on('roomList', (rooms : Room[]) => this.getRoomList(rooms));

        this.socket.on('disconnect', () => this.onDisconnect());
    }

    getRoomList(rooms : Room[]) {
        const roomList = document.getElementById('roomList') as HTMLDivElement;
        for (const room of rooms) {
            let roomListItem = document.createElement('a');
            roomListItem.classList.add('roomListItem');
            roomListItem.href = `/rooms/${room['id']}`;
            roomListItem.innerText = room['name'];
            if (roomList) roomList.appendChild(roomListItem);
        }
    }

    onDisconnect() {
        console.warn("Вы были отсоединены от веб-сервера (websocket disconnect)");
        const roomList = document.querySelectorAll(".roomListItem");
        console.log(roomList);
        for (const room of roomList) {
            console.log(room);
            room.remove();
        }
    }
}