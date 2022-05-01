import express = require('express');
import path = require('path');

import { ITokenService } from "./TokenService";
import { IFileService } from "./FileService/FileService";
import { IRoomRepository } from "./Room/RoomRepository";
import { FileServiceConstants } from "nostromo-shared/types/FileServiceTypes";
import { IUserBanRepository } from "./User/UserBanRepository";
import { IUserAccountRepository } from "./User/UserAccountRepository";
import { IAuthRoomUserRepository } from "./User/AuthRoomUserRepository";

const frontend_dirname = process.cwd() + "/node_modules/nostromo-web";

/** HTTP веб-сервис. */
export class WebService
{
    /** Приложение Express. */
    public app: express.Express = express();

    /** Обработчик файлов. */
    private fileService: IFileService;

    /** Сервис для работы с токенами. */
    private tokenService: ITokenService;

    /** Комнаты. */
    private roomRepository: IRoomRepository;

    /** Аккаунты пользователей. */
    private userAccountRepository: IUserAccountRepository;

    /** Блокировки пользователей. */
    private userBanRepository: IUserBanRepository;

    /** Авторизованные пользователи в комнатах. */
    private authRoomUserRepository: IAuthRoomUserRepository;

    constructor(
        fileService: IFileService,
        tokenService: ITokenService,
        roomRepository: IRoomRepository,
        userAccountRepository: IUserAccountRepository,
        userBanRepository: IUserBanRepository,
        authRoomUserRepository: IAuthRoomUserRepository
    )
    {
        this.fileService = fileService;
        this.tokenService = tokenService;

        this.roomRepository = roomRepository;
        this.userAccountRepository = userAccountRepository;
        this.userBanRepository = userBanRepository;
        this.authRoomUserRepository = authRoomUserRepository;

        this.app.use(this.checkBanMiddleware);
        this.app.use(WebService.wwwMiddleware);
        this.app.use(WebService.httpsMiddleware);
        this.app.use(this.tokenService.tokenExpressMiddleware);

        this.app.disable('x-powered-by');

        this.app.use(WebService.rejectRequestWithBodyMiddleware);

        this.handleRoutes();
        this.handleStatic();

        this.app.use(WebService.preventFloodMiddleware);

        this.endPoint();
    }

    /** Проверяем на наличие блокировки по ip-адресу пользователя. */
    private checkBanMiddleware: express.RequestHandler = (req: express.Request, res: express.Response, next: express.NextFunction) =>
    {
        if (!this.userBanRepository.has(req.ip.substring(7)))
        {
            next();
        }
        else
        {
            WebService.sendCodeAndDestroySocket(req, res, 403);
        }
    };

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

    /** Есть ли тело у запроса? */
    public static requestHasNotBody(req: express.Request): boolean
    {
        const contentLength = req.headers["content-length"];
        return ((!contentLength || Number(contentLength) == 0) && req.readableLength == 0);
    }

    /** Отправить код ошибки и разорвать соединение с клиентом. */
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
        if (methodWithoutBody && !WebService.requestHasNotBody(req))
        {
            WebService.sendCodeAndDestroySocket(req, res, 405);
        }
        else
        {
            next();
        }
    }

    /** Защищаемся от флуд-атаки через body в реквесте. */
    private static preventFloodMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void
    {
        if (WebService.requestHasNotBody(req))
        {
            next();
        }
        else
        {
            WebService.sendCodeAndDestroySocket(req, res, 405);
        }
    }

    /** Обрабатываем маршруты. */
    private handleRoutes(): void
    {
        // [главная страница]
        this.app.get('/', (req: express.Request, res: express.Response) =>
        {
            res.sendFile(path.join(frontend_dirname, '/pages', 'index.html'));
        });

        // [комната]
        this.app.get('/rooms/:roomId', async (
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ) =>
        {
            await this.roomRoute(req, res, next);
        });

        this.app.get('/r/:roomId', async (
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ) =>
        {
            await this.roomRoute(req, res, next);
        });

        // [админка]
        this.app.get('/admin', (req: express.Request, res: express.Response) =>
        {
            this.adminRoute(req, res);
        });

        // [файлы]
        this.handleFilesRoutes();
    }

    /** Маршруты для администратора. */
    private adminRoute(
        req: express.Request,
        res: express.Response
    ): void
    {
        const userId = req.token.userId;

        if ((req.ip == process.env.ALLOW_ADMIN_IP) ||
            (process.env.ALLOW_ADMIN_EVERYWHERE === 'true'))
        {
            if (!userId || !this.userAccountRepository.isAdmin(userId))
            {
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

    /** Маршруты для комнаты. */
    private async roomRoute(
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ): Promise<void | express.Response>
    {
        // Запрещаем кешировать страницу с комнатой.
        res.setHeader('Cache-Control', 'no-store');

        const ROOM_AUTH_PAGE_PATH = path.join(frontend_dirname, '/pages/rooms', 'roomAuth.html');
        const ROOM_PAGE_PATH = path.join(frontend_dirname, '/pages/rooms', 'room.html');

        // проверяем наличие запрашиваемой комнаты
        const roomId: string = req.params.roomId;
        const room = this.roomRepository.get(roomId);

        if (!room)
        {
            return next();
        }

        const userId = req.token.userId;

        // Если пользователь авторизован в этой комнате.
        if (userId && this.authRoomUserRepository.has(roomId, userId))
        {
            return res.sendFile(ROOM_PAGE_PATH);
        }

        // Берем пароль из query, а если его нет, то берем его как пустой пароль.
        const pass = req.query.p as string ?? "";

        // Проверяем пароль.
        const isPassCorrect = await this.roomRepository.checkPassword(room.id, pass);

        // Корректный пароль в query.
        if (isPassCorrect)
        {
            let userId = req.token.userId;

            // Если у пользователя не было токена.
            if (!userId)
            {
                userId = this.userAccountRepository.create({ role: "user" });
                const jwt = await this.tokenService.create({ userId });

                res.cookie("token", jwt, {
                    httpOnly: true,
                    secure: true,
                    sameSite: "lax"
                });
            }

            // Запоминаем для этого пользователя авторизованную комнату.
            this.authRoomUserRepository.create(roomId, userId);
            res.sendFile(ROOM_PAGE_PATH);
        }
        else
        {
            res.sendFile(ROOM_AUTH_PAGE_PATH);
        }
    }

    /** Обрабатываем маршруты, связанные с файлами. */
    private handleFilesRoutes(): void
    {
        // Tus Head Request (узнать, сколько осталось докачать)
        this.app.head(`${FileServiceConstants.FILES_ROUTE}/:fileId`, (req: express.Request, res: express.Response) =>
        {
            this.fileService.tusHeadInfo(req, res);
        });

        // Tus Patch Request (заливка файла)
        this.app.patch(`${FileServiceConstants.FILES_ROUTE}/:fileId`, async (req: express.Request, res: express.Response) =>
        {
            await this.fileService.tusPatchFile(req, res);
        });

        // Tus Options Request (узнать информацию о конфигурации Tus на сервере)
        this.app.options(`${FileServiceConstants.FILES_ROUTE}`, (req: express.Request, res: express.Response) =>
        {
            this.fileService.tusOptionsInfo(req, res);
        });

        // Tus Post Request - Creation Extension (создать адрес файла на сервере и получить его)
        this.app.post(`${FileServiceConstants.FILES_ROUTE}`, async (req: express.Request, res: express.Response) =>
        {
            await this.fileService.tusPostCreateFile(req, res);
        });

        // скачать файл
        this.app.get(`${FileServiceConstants.FILES_ROUTE}/:fileId`, (req: express.Request, res: express.Response) =>
        {
            this.fileService.downloadFile(req, res);
        });
    }

    /** Открываем доступ к статике. */
    private handleStatic(): void
    {
        this.app.use('/admin', (req: express.Request, res: express.Response, next: express.NextFunction) =>
        {
            express.static(frontend_dirname + "/static/admin/")(req, res, next);
        });

        this.app.use('/rooms', (req: express.Request, res: express.Response, next: express.NextFunction) =>
        {
            express.static(frontend_dirname + "/static/rooms/")(req, res, next);
        });

        this.app.use('/r', (req: express.Request, res: express.Response, next: express.NextFunction) =>
        {
            express.static(frontend_dirname + "/static/rooms/")(req, res, next);
        });

        this.app.use('/', express.static(frontend_dirname + "/static/public/"));
    }

    /** Самый последний обработчик запросов. */
    private endPoint(): void
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
