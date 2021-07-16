import { io, Socket } from "socket.io-client";

import { NewRoomInfo } from "shared/AdminTypes";
import { VideoCodec } from "shared/RoomTypes";

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

    private videoCodecSelect?: HTMLSelectElement;

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
            this.socket.on('roomList', (roomList: Room[], roomIndex: number) =>
            {
                this.setRoomList(roomList);
                this.latestRoomId = roomIndex;
            });
            const btn_createRoom = document.getElementById('btn_createRoom')! as HTMLButtonElement;
            const btn_deleteRoom = document.getElementById('btn_deleteRoom')! as HTMLButtonElement;

            this.prepareVideoCodecSelect();

            btn_createRoom.addEventListener('click', () => { this.createRoom(); });
            btn_deleteRoom.addEventListener('click', () => { this.deleteRoom(); });
        }
    }

    private prepareVideoCodecSelect()
    {
        this.videoCodecSelect = document.getElementById('videoCodec')! as HTMLSelectElement;

        const Vp9Option = new Option(VideoCodec.VP9, VideoCodec.VP9, true);
        this.videoCodecSelect.add(Vp9Option);

        const Vp8Option = new Option(VideoCodec.VP8, VideoCodec.VP8);
        this.videoCodecSelect.add(Vp8Option);

        const H264Option = new Option(VideoCodec.H264, VideoCodec.H264);
        this.videoCodecSelect.add(H264Option);
    }

    private onAuthPage(): boolean
    {
        const joinButton = document.getElementById('btn_join');
        if (joinButton)
        {
            const passInput = document.getElementById('pass')! as HTMLInputElement;

            joinButton.addEventListener('click', () =>
            {
                this.socket.emit('joinAdmin', passInput.value);
            });

            passInput.addEventListener('keydown', (e) =>
            {
                if (e.key == 'Enter' && !e.shiftKey)
                {
                    e.preventDefault();
                    joinButton.click();
                };
            });

            return true;
        }
        return false;
    }

    private createRoom(): void
    {
        const name = (document.getElementById('roomNameInput') as HTMLInputElement).value;
        const pass = (document.getElementById('roomPassInput') as HTMLInputElement).value;
        const videoCodec = this.videoCodecSelect!.value as VideoCodec;

        const newRoomInfo: NewRoomInfo = {
            name,
            pass,
            videoCodec
        };

        this.socket.emit('createRoom', newRoomInfo);
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
            roomSelect!.appendChild(newOption);
        }
    }

    private addRoomListItem(roomName: string): void
    {
        const roomSelect = document.getElementById('roomSelect') as HTMLSelectElement;
        const id = ++this.latestRoomId;
        let newOption = document.createElement('option');
        newOption.value = id.toString();
        newOption.innerText = `[${id}] ${roomName}`;
        roomSelect!.appendChild(newOption);
    }
}