import express = require('express');
import session = require('express-session');
import path = require('path');

import { RoomId, Room } from './Room';
import { FileHandler } from "./FileHandler";

import { FileHandlerConstants } from "nostromo-shared/types/FileHandlerTypes";

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
    /** Приложение Express. */
    public app: express.Express = express();

    /** Обработчик сессий */
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

    constructor(_rooms: Map<RoomId, Room>, _fileHandler: FileHandler)
    {
        this.rooms = _rooms;
        this.fileHandler = _fileHandler;

        this.app.use(ExpressApp.wwwMiddleware);

        this.app.use(ExpressApp.httpsMiddleware);

        this.app.use(this.sessionMiddleware);

        this.app.disable('x-powered-by');

        this.app.use(ExpressApp.rejectRequestWithBodyMiddleware);

        this.handleRoutes();

        this.handleStatic();

        this.app.use(ExpressApp.preventFloodMiddleware);

        this.endPoint();
    }

    /** Убираем www из адреса. */
    private static wwwMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void
    {
        if (req.hostname?.slice(0, 4) === 'www.')
        {
            const newHost: string = req.hostname.slice(4);
            res.redirect(301, req.protocol + '://' + newHost + req.originalUrl);
        }
        else
        {
            next();
        }
    }
    /** Перенаправляем на https. */
    private static httpsMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void
    {
        if (!req.secure)
        {
            res.redirect(301, ['https://', req.hostname, req.originalUrl].join(''));
        }
        else
        {
            next();
        }
    }

    public static requestHasNotBody(req: express.Request): boolean
    {
        const contentLength = req.headers["content-length"];
        return ((!contentLength || Number(contentLength) == 0) && req.readableLength == 0);
    }

    public static sendCodeAndDestroySocket(req: express.Request, res: express.Response, httpCode: number): void
    {
        // экспериментальным путем установлено, что чтение 13 чанков по 16 кб (208 кб) и последующее уничтожение сокета реквеста
        // с большой вероятностью возвращает код http респонса для Chrome и Postman,
        // причем Postman сам отправляет 13 чанков и после сразу принимает код реквеста (судя по логу, если отслеживать event 'data' у реквеста),
        // а Chrome, если ничего не делать, отправляет данные пока не кончится файл и только потом отображает код респонса
        // Firefox тоже отправляет данные пока не кончится файл и только потом отображает код респонса
        // однако 13 чанков и последующий destroy реквеста ему не особо помогают, он просто у себя фиксирует, что реквест оборвался, но без кода ответа
        let i = 0;

        req.on("data", () =>
        {
            if (i++ == 12) req.socket.destroy();
        });

        res.status(httpCode).end();
    }

    /** Отвергаем запросы GET, HEAD и OPTIONS с телом в запросе. */
    private static rejectRequestWithBodyMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void
    {
        const methodWithoutBody = (req.method == "GET" || req.method == "HEAD" || req.method == "OPTIONS");
        if (methodWithoutBody && !ExpressApp.requestHasNotBody(req))
        {
            ExpressApp.sendCodeAndDestroySocket(req, res, 405);
        }
        else
        {
            next();
        }
    }

    /** Защищаемся от флуд-атаки через body в реквесте. */
    private static preventFloodMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void
    {
        if (ExpressApp.requestHasNotBody(req))
        {
            next();
        }
        else
        {
            ExpressApp.sendCodeAndDestroySocket(req, res, 405);
        }
    }

    /** Обрабатываем маршруты. */
    private handleRoutes()
    {
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
    }

    private adminRoute(
        req: express.Request,
        res: express.Response
    ): void
    {
        if ((req.ip == process.env.ALLOW_ADMIN_IP) ||
            (process.env.ALLOW_ADMIN_EVERYWHERE === 'true'))
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
            res.sendStatus(404);
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
        return res.sendStatus(404);
    }

    /** Обрабатываем маршруты, связанные с файлами. */
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
            this.fileHandler.downloadFile(req, res);
        });
    }

    /** Открываем доступ к статике. */
    private handleStatic()
    {
        this.app.use('/admin', (req: express.Request, res: express.Response, next: express.NextFunction) =>
        {
            if ((req.ip == process.env.ALLOW_ADMIN_IP)
                || (process.env.ALLOW_ADMIN_EVERYWHERE === 'true'))
            {
                express.static(frontend_dirname + "/static/admin/")(req, res, next);
            }
            else
            {
                next();
            }
        });

        this.app.use('/rooms', (req: express.Request, res: express.Response, next: express.NextFunction) =>
        {
            if (req.session.auth)
            {
                express.static(frontend_dirname + "/static/rooms/")(req, res, next);
            }
            else
            {
                next();
            }
        });

        this.app.use('/', express.static(frontend_dirname + "/static/public/"));
    }

    /** Самый последний обработчик запросов. */
    private endPoint()
    {
        this.app.use((req: express.Request, res: express.Response) =>
        {
            let statusCode = 405;
            if (req.method == "GET" || req.method == "HEAD")
            {
                statusCode = 404;
            }
            res.sendStatus(statusCode);
        });
    }
}
