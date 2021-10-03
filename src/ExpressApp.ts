import express = require('express');
import session = require('express-session');
import path = require('path');

import { RoomId, Room } from './Room';
import { FileHandler } from "./FileHandler";

import { FileHandlerConstants } from "nostromo-shared/types/FileHandlerTypes"

const frontend_dirname = process.cwd() + "/node_modules/nostromo-web";

// добавляю в сессию необходимые параметры
declare module 'express-session' {
    interface SessionData
    {
        auth: boolean;              // авторизован?
        username: string;           // ник
        authRoomsId: string[];      // список авторизованных комнат
        joined: boolean;            // в данный момент в комнате?
        joinedRoomId: string;       // номер комнаты, в которой находится пользователь
        admin: boolean;             // администратор?
    }
}

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

    private fileHandler;

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

    constructor(_rooms: Map<RoomId, Room>, _fileHandler: FileHandler)
    {
        this.rooms = _rooms;
        this.fileHandler = _fileHandler;

        // убираем www из адреса
        this.app.use(ExpressApp.wwwMiddleware);

        // перенаправляем на https
        this.app.use(ExpressApp.httpsMiddleware);

        // используем обработчик сессий
        this.app.use(this.sessionMiddleware);

        this.app.disable('x-powered-by');

        // обрабатываем маршруты
        // [главная страница]
        this.app.get('/', (req: express.Request, res: express.Response) =>
        {
            res.sendFile(path.join(frontend_dirname, '/pages', 'index.html'));
        });

        // [комната]
        this.app.get('/rooms/:roomId', (req: express.Request, res: express.Response) =>
        {
            this.roomRoute(req, res);
        });

        // [админка]
        this.app.get('/admin', (req: express.Request, res: express.Response) =>
        {
            this.adminRoute(req, res);
        });

        // [файлы]
        this.handleFilesRoutes();

        // [открываем доступ к статике]
        this.app.use('/admin', (req: express.Request, res: express.Response, next: express.NextFunction) =>
        {
            if ((req.ip == process.env.ALLOW_ADMIN_IP)
                || (process.env.ALLOW_ADMIN_EVERYWHERE === 'true'))
            {
                express.static(frontend_dirname + "/static/admin/")(req, res, next);
            }
            else next();
        });

        this.app.use('/rooms', (req: express.Request, res: express.Response, next: express.NextFunction) =>
        {
            if (req.session.auth)
            {
                express.static(frontend_dirname + "/static/rooms/")(req, res, next);
            }
            else next();
        });

        this.app.use('/', express.static(frontend_dirname + "/static/public/"));

        this.app.use((req: express.Request, res: express.Response) =>
        {
            res.status(404).end('404 error: page not found');
        });
    }

    private handleFilesRoutes()
    {
        // Tus Head Request (узнать, сколько осталось докачать)
        this.app.head(`${FileHandlerConstants.FILES_ROUTE}/:fileId`, (req: express.Request, res: express.Response) =>
        {
            this.fileHandler.tusHeadInfo(req, res);
        });

        // Tus Patch Request (заливка файла)
        this.app.patch(`${FileHandlerConstants.FILES_ROUTE}/:fileId`, async (req: express.Request, res: express.Response) =>
        {
            await this.fileHandler.tusPatchFile(req, res);
        });

        // Tus Options Request (узнать информацию о конфигурации Tus на сервере)
        this.app.options(`${FileHandlerConstants.FILES_ROUTE}`, (req: express.Request, res: express.Response) =>
        {
            this.fileHandler.tusOptionsInfo(req, res);
        });

        // Tus Post Request - Creation Extension (создать адрес файла на сервере и получить его)
        this.app.post(`${FileHandlerConstants.FILES_ROUTE}`, (req: express.Request, res: express.Response) =>
        {
            this.fileHandler.tusPostCreateFile(req, res);
        });

        // скачать файл
        this.app.get(`${FileHandlerConstants.FILES_ROUTE}/:fileId`, (req: express.Request, res: express.Response) =>
        {
            this.fileHandler.tusDownloadFile(req, res);
        });
    }

    private adminRoute(
        req: express.Request,
        res: express.Response
    ): void
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

    private roomRoute(
        req: express.Request,
        res: express.Response
    ): void | express.Response
    {
        // запрещаем кешировать страницу с комнатой
        res.setHeader('Cache-Control', 'no-store');

        // лямбда-функция, которая возвращает страницу с комнатой при успешной авторизации
        const joinInRoom = (roomId: string): void =>
        {
            // сокет сделает данный параметр true,
            // joined нужен для предотвращения создания двух сокетов от одного юзера в одной комнате на одной вкладке
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