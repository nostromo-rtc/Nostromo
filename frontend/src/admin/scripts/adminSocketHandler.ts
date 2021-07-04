import { io, Socket } from "socket.io-client";

type Room = {
    id: string,
    name: string;
};

// Класс для работы с сокетами при авторизации в панель администратора
export default class adminSocketHandler
{

    private socket: Socket = io(`/admin`, {
        'transports': ['websocket']
    });
    private latestRoomId: number = 0;

    constructor()
    {
        console.debug("adminSocketHandler ctor");
        this.socket.on('connect', () =>
        {
            console.info("Создано подключение веб-сокета");
            console.info("Client ID:", this.socket.id);
        });

        this.socket.on('connect_error', (err: Error) =>
        {
            console.log(err.message);
        });

        this.socket.on('result', (success: boolean) =>
        {
            if (success) location.reload();
            else
            {
                const result = document.getElementById('result') as HTMLParagraphElement;
                if (result) result.innerText = "Неправильный пароль!";
            }
        });

        if (!this.onAuthPage())
        {
            this.socket.on('roomList', (roomList: Room[], roomsIdCount: number) =>
            {
                this.setRoomList(roomList);
                this.latestRoomId = roomsIdCount;
            });
            const btn_createRoom = document.getElementById('btn_createRoom') as HTMLButtonElement;
            const btn_deleteRoom = document.getElementById('btn_deleteRoom') as HTMLButtonElement;
            btn_createRoom?.addEventListener('click', () => { this.createRoom(); });
            btn_deleteRoom?.addEventListener('click', () => { this.deleteRoom(); });
        }
    }

    private onAuthPage(): boolean
    {
        const joinButton = document.getElementById('btn_join');
        if (joinButton)
        {
            joinButton.addEventListener('click', () =>
            {
                const pass = (document.getElementById('pass') as HTMLInputElement).value;
                this.socket.emit('joinAdmin', pass);
            });
            return true;
        }
        return false;
    }

    private createRoom(): void
    {
        const name = (document.getElementById('roomNameInput') as HTMLInputElement).value;
        const pass = (document.getElementById('roomPassInput') as HTMLInputElement).value;
        this.socket.emit('createRoom', name, pass);
        this.addRoomListItem(name);
        const roomLink = document.getElementById('roomLink') as HTMLInputElement;
        if (roomLink.hidden) roomLink.hidden = false;
        roomLink.value = `${window.location.origin}/rooms/${this.latestRoomId}?p=${pass}`;
        roomLink.select();
        document.execCommand("copy");
    }

    private deleteRoom(): void
    {
        const roomSelect = (document.getElementById('roomSelect') as HTMLSelectElement);
        const roomId = roomSelect.value;
        if (roomId && roomId != "default")
        {
            this.socket.emit('deleteRoom', roomId);
            let option = document.querySelector(`option[value='${roomId}']`);
            if (option) option.remove();
        }
    }

    private setRoomList(roomList: Room[]): void
    {
        const roomSelect = document.getElementById('roomSelect') as HTMLSelectElement;
        for (const room of roomList)
        {
            let newOption = document.createElement('option');
            newOption.value = room['id'];
            newOption.innerText = `[${room['id']}] ${room['name']}`;
            roomSelect?.appendChild(newOption);
        }
    }

    private addRoomListItem(roomName: string): void
    {
        const roomSelect = document.getElementById('roomSelect') as HTMLSelectElement;
        const id = ++this.latestRoomId;
        let newOption = document.createElement('option');
        newOption.value = id.toString();
        newOption.innerText = `[${id}] ${roomName}`;
        roomSelect?.appendChild(newOption);
    }
}