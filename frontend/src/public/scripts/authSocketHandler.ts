import { io, Socket } from "socket.io-client";

// Класс для работы с сокетами при авторизации
export default class authSocketHandler
{

    private socket: Socket = io("/auth", {
        'transports': ['websocket']
    });

    private passInput = document.getElementById('pass')! as HTMLInputElement;
    private btn_join = document.getElementById('btn_join')! as HTMLButtonElement;

    constructor()
    {
        console.debug("authSocketHandler ctor");
        this.socket.on('connect', () =>
        {
            console.info("Создано подключение веб-сокета");
            console.info("Client ID:", this.socket.id);
        });

        this.socket.on('connect_error', (err: Error) =>
        {
            console.log(err.message);
        });

        this.socket.on('roomName', (roomName: string) =>
        {
            (document.getElementById('roomName') as HTMLSpanElement).innerText = roomName;
            (document.getElementById('auth') as HTMLDivElement).hidden = false;
        });

        this.socket.on('result', (success: boolean) =>
        {
            if (success) location.reload();
            else (document.getElementById('result') as HTMLParagraphElement).innerText = "Неправильный пароль!";
        });

        this.btn_join.addEventListener('click', () =>
        {
            const pass: string = (document.getElementById('pass') as HTMLInputElement).value;
            this.socket.emit('joinRoom', pass);
        });

        this.passInput.addEventListener('keydown', (e) =>
        {
            if (e.key == 'Enter' && !e.shiftKey)
            {
                e.preventDefault();
                this.btn_join.click();
            };
        });
    }
}