import express = require('express');
import session = require('express-session');
import path = require('path');

const frontend_dirname = __dirname + "/../../frontend";

// добавляю в сессию необходимые параметры
declare module 'express-session' {
    interface SessionData
    {
        auth: boolean;              // авторизован?
        username: string;           // ник
        authRoomsId: string[];      // список авторизованных комнат
        joined: boolean;            // в данный момент в комнате?
        joinedRoomId: string;       // номер комнаты, в которой находится пользователе
        admin: boolean;             // администратор?
    }
}

import { RoomId, Room } from './Room';

// класс - обработчик веб-сервера
export class ExpressApp
{
    // приложение Express
    public app: express.Express = express();

    // обработчик сессий
    public sessionMiddleware: express.RequestHandler = session({
        secret: process.env.EXPRESS_SESSION_KEY!,
        name: 'sessionId',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: true
        }
    });

    private rooms: Map<RoomId, Room>;

    private static wwwMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void
    {
        if (req.hostname?.slice(0, 4) === 'www.')
        {
            const newHost: string = req.hostname.slice(4);
            res.redirect(301, req.protocol + '://' + newHost + req.originalUrl);
        }
        else next();
    }

    private static httpsMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void
    {
        if (!req.secure)
        {
            res.redirect(301, ['https://', req.hostname, req.originalUrl].join(''));
        }
        else next();
    }

    constructor(_rooms: Map<RoomId, Room>)
    {
        this.rooms = _rooms;

        // убираем www из адреса
        this.app.use(ExpressApp.wwwMiddleware);

        // перенаправляем на https
        this.app.use(ExpressApp.httpsMiddleware);

        // используем обработчик сессий
        this.app.use(this.sessionMiddleware);

        this.app.disable('x-powered-by');

        // [обрабатываем маршруты]
        // главная страница
        this.app.get('/', (req, res) =>
        {
            res.sendFile(path.join(frontend_dirname, '/pages', 'index.html'));
        });

        this.app.get('/rooms/:roomId', (req, res) =>
        {
            this.roomRoute(req, res);
        });

        this.app.get('/admin', (req, res) =>
        {
            this.adminRoute(req, res);
        });

        // открываем доступ к статике, т.е к css, js, картинки
        this.app.use('/admin', (req, res, next) =>
        {
            if ((req.ip == process.env.ALLOW_ADMIN_IP)
                || (process.env.ALLOW_ADMIN_EVERYWHERE === 'true'))
            {
                express.static(frontend_dirname + "/static/admin/")(req, res, next);
            }
            else next();
        });

        this.app.use('/rooms', (req, res, next) =>
        {
            if (req.session.auth)
            {
                express.static(frontend_dirname + "/static/rooms/")(req, res, next);
            }
            else next();
        });

        this.app.use('/', express.static(frontend_dirname + "/static/public/"));

        this.app.use((req, res) =>
        {
            res.status(404).end('404 error: page not found');
        });
    }

    private adminRoute(req: express.Request, res: express.Response): void
    {
        if ((req.ip == process.env.ALLOW_ADMIN_IP)
            || (process.env.ALLOW_ADMIN_EVERYWHERE === 'true'))
        {
            if (!req.session.admin)
            {
                req.session.admin = false;
                res.sendFile(path.join(frontend_dirname, '/pages/admin', 'adminAuth.html'));
            }
            else
            {
                res.sendFile(path.join(frontend_dirname, '/pages/admin', 'admin.html'));
            }
        }
        else
        {
            res.status(404).end('404 Error: page not found');
        }
    }

    private roomRoute(req: express.Request, res: express.Response): void | express.Response
    {
        // запрещаем кешировать страницу с комнатой
        res.setHeader('Cache-Control', 'no-store');

        // лямбда-функция, которая возвращает страницу с комнатой при успешной авторизации
        const joinInRoom = (roomId: string): void =>
        {
            // сокет сделает данный параметр true,
            // isInRoom нужен для предотвращения создания двух сокетов от одного юзера в одной комнате на одной вкладке
            req.session.joined = false;
            req.session.joinedRoomId = roomId;
            return res.sendFile(path.join(frontend_dirname, '/pages/rooms', 'room.html'));
        };

        // проверяем наличие запрашиваемой комнаты
        const roomId: RoomId = req.params.roomId;
        if (this.rooms.has(roomId))
        {
            // если пользователь авторизован в этой комнате
            if (req.session.auth && req.session.authRoomsId?.includes(roomId))
            {
                return joinInRoom(roomId);
            }

            // если не авторизован, но есть пароль в query
            const pass = req.query.p as string || undefined;
            if (pass)
            {
                if (pass == this.rooms.get(roomId)!.password)
                {
                    // если у пользователя не было сессии
                    if (!req.session.auth)
                    {
                        req.session.auth = true;
                        req.session.authRoomsId = new Array<string>();
                    }
                    // запоминаем для этого пользователя авторизованную комнату
                    req.session.authRoomsId!.push(roomId);
                    return joinInRoom(roomId);
                }
                return res.send("неправильный пароль");
            }

            req.session.joinedRoomId = roomId;
            return res.sendFile(path.join(frontend_dirname, '/pages/rooms', 'roomAuth.html'));
        }
        return res.status(404).end('404 Error: page not found');
    }
}