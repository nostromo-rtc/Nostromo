// Класс для работы с сокетами при авторизации в панель администратора
export default class adminSocketHandler {
    constructor() {
        // поля
        this.socket = io("/admin", {
            'transports': ['websocket']
        });

        // конструктор (тут работаем с сокетами)
        console.debug("adminSocketHandler ctor");
        this.socket.on('connect', () => {
            console.info("Создано подключение веб-сокета");
            console.info("Client ID:", this.socket.id);
        });

        this.socket.on('connect_error', (err) => {
            console.log(err.message);
        });

        this.socket.on('result', (success) => {
            if (success) location.reload();
            else document.getElementById('result').innerText = "Неправильный пароль!";
        });

        document.getElementById('join').addEventListener('click', () => {
            const pass = document.getElementById('pass').value;
            this.socket.emit('joinAdmin', pass);
        });
    }
}