// Класс для работы с сокетами при авторизации
export default class authSocketHandler {
    constructor() {
        // поля
        this.socket = io("/auth", {
            'transports': ['websocket']
        });

        // конструктор (тут работаем с сокетами)
        console.debug("authSocketHandler ctor");
        this.socket.on('connect', () => {
            console.info("Создано подключение веб-сокета");
            console.info("Client ID:", this.socket.id);
        });

        this.socket.on('connect_error', (err) => {
            console.log(err.message);
        });

        this.socket.on('roomName', (roomName) => {
            document.getElementById('roomName').innerText = roomName;
            document.getElementById('roomNameInput').value = roomName;
            document.getElementById('auth').hidden = false;
        });

        this.socket.on('result', (success) => {
            if (success) location.reload();
            else document.getElementById('result').innerText = "Неправильный пароль!";
        })
        document.getElementById('join').addEventListener('click', () => {
            const pass = document.getElementById('pass').value;
            this.socket.emit('joinRoom', pass);
        });
    }
}