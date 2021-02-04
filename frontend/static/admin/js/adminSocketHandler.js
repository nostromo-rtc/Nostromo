// Класс для работы с сокетами при авторизации в панель администратора
export default class adminSocketHandler {
    constructor() {
        // поля
        this.socket = io("/admin", {
            'transports': ['websocket']
        });
        this.latestRoomId = 0;

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

        if (!this.onAuthPage()) {
            this.socket.on('roomList', (roomList, roomsIdCount) =>
            {
                this.setRoomList(roomList);
                this.latestRoomId = roomsIdCount;
            });
            document.getElementById('btn_createRoom').addEventListener('click', () => { this.createRoom(); });
            document.getElementById('btn_deleteRoom').addEventListener('click', () => { this.deleteRoom(); });
        }
    }

    onAuthPage() {
        const joinButton = document.getElementById('btn_join');
        if (joinButton) {
            joinButton.addEventListener('click', () => {
                const pass = document.getElementById('pass').value;
                this.socket.emit('joinAdmin', pass);
            });
            return true;
        }
        return false;
    }

    createRoom() {
        const name = document.getElementById('roomNameInput').value;
        const pass = document.getElementById('roomPassInput').value;
        this.socket.emit('createRoom', name, pass);
        this.addRoomListItem(name);
        const roomLink = document.getElementById('roomLink');
        if (roomLink.hidden) roomLink.hidden = false;
        roomLink.value = `${window.location.origin}/rooms/${this.latestRoomId}?p=${pass}`;
        roomLink.select();
        document.execCommand("copy");
    }

    deleteRoom() {
        const roomSelect = document.getElementById('roomSelect');
        const roomId = roomSelect.value;
        if (roomId && roomId != "default") {
            this.socket.emit('deleteRoom', roomId);
            let option = document.querySelector(`option[value='${roomId}']`);
            if (option) {
                option.remove();
            }
        }
    }

    setRoomList(roomList) {
        const roomSelect = document.getElementById('roomSelect');
        for (const roomItem of roomList) {
            let newOption = document.createElement('option');
            newOption.value = roomItem['id'];
            newOption.innerText = `[${roomItem['id']}] ${roomItem['name']}`;
            roomSelect.appendChild(newOption);
        }
    }

    addRoomListItem(roomName) {
        const roomSelect = document.getElementById('roomSelect');
        const id = ++this.latestRoomId;
        let newOption = document.createElement('option');
        newOption.value = id;
        newOption.innerText = `[${id}] ${roomName}`;
        roomSelect.appendChild(newOption);
    }
}