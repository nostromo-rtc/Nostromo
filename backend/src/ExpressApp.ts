import express = require('express');
import session = require('express-session');
import path = require('path');

// добавляю в сессию необходимые параметры
declare module 'express-session' {
    interface SessionData {
        auth: boolean;
        username: string;
        authRoomsID: Array<string>;
        activeRoomID: string;
        isInRoom: boolean;
        admin: boolean;
    }
}

import { RoomId, RoomInfo } from './index';

// класс - обработчик сокетов
export class ExpressApp {
    // приложение Express
    public app: express.Express = express();
    // обработчик сессий
    public sessionMiddleware: express.RequestHandler = session({
        secret: 'developmentsecretkey',
        name: 'sessionId',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: true
        }
    });
    private rooms: Map<RoomId, RoomInfo>;

    constructor(_rooms: Map<RoomId, RoomInfo>) {
        console.debug("ExpressApp ctor");
        this.rooms = _rooms;
        // используем обработчик сессий
        this.app.use(this.sessionMiddleware);
        this.app.disable('x-powered-by');
        // [обрабатываем маршруты]
        // главная страница
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../frontend/pages', 'index.html'));
        });

        this.app.get('/rooms/:roomID', (req, res) => {
            this.roomRoute(req, res);
        });

        this.app.get('/admin', (req, res) => {
            this.adminRoute(req, res);
        });

        // открываем доступ к статике, т.е к css, js, картинки
        this.app.use('/admin', (req, res, next) => {
            if (req.ip == "::ffff:127.0.0.1") {
                express.static("../frontend/static/admin/")(req, res, next);
            }
            else next();
        });

        this.app.use('/rooms', (req, res, next) => {
            if (req.session.auth) {
                express.static("../frontend/static/rooms/")(req, res, next);
            }
            else next();
        });

        this.app.use('/', express.static("../frontend/static/public/"));

        this.app.use((req, res) => {
            res.status(404).end('404 error: page not found');
        });
    }

    private adminRoute(req: express.Request, res: express.Response) {
        if (req.ip == "::ffff:127.0.0.1") {
            if (!req.session.admin) {
                req.session.admin = false;
                res.sendFile(path.join(__dirname, '../frontend/pages/admin', 'adminAuth.html'));
            }
            else {
                res.sendFile(path.join(__dirname, '../frontend/pages/admin', 'admin.html'));
            }
        }
        else {
            res.status(404).end('404 Error: page not found');
        }
    }
    private roomRoute(req: express.Request, res: express.Response) {
        // запрещаем кешировать страницу с комнатой
        res.setHeader('Cache-Control', 'no-store');
        // лямбда-функция, которая возвращает страницу с комнатой при успешной авторизации
        const joinInRoom = (roomID: string) => {
            // сокет сделает данный параметр true,
            // isInRoom нужен для предотвращения создания двух сокетов от одного юзера в одной комнате на одной вкладке
            req.session.isInRoom = false;
            req.session.activeRoomID = roomID;
            return res.sendFile(path.join(__dirname, '../frontend/pages/room', 'room.html'));
        };
        // проверяем наличие запрашиваемой комнаты
        const roomID = req.params.roomID;
        if (this.rooms.has(roomID)) {
            // если пользователь авторизован в этой комнате
            if (req.session.auth && req.session.authRoomsID.includes(roomID)) {
                return joinInRoom(roomID);
            }
            // если не авторизован, но есть пароль в query
            const pass = req.query.p;
            if (pass) {
                if (pass == this.rooms.get(roomID).password) {
                    // если у пользователя не было сессии
                    if (!req.session.auth) {
                        req.session.auth = true;
                        req.session.authRoomsID = new Array<string>();
                    }
                    // запоминаем для этого пользователя авторизованную комнату
                    req.session.authRoomsID.push(roomID);
                    return joinInRoom(roomID);
                }
                return res.send("неправильный пароль");
            }
            req.session.activeRoomID = roomID;
            return res.sendFile(path.join(__dirname, '../frontend/pages/room', 'roomAuth.html'));
        }
        return res.status(404).end('404 Error: page not found');
    }
}