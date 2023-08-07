import express = require('express');
import path = require('path');
import proxyAddr = require("proxy-addr");

import { ITokenService } from "./TokenService";
import { IFileService } from "./FileService/FileService";
import { IRoomRepository } from "./Room/RoomRepository";
import { FileServiceConstants } from "nostromo-shared/types/FileServiceTypes";
import { IUserBanRepository } from "./User/UserBanRepository";
import { IUserAccountRepository } from "./User/UserAccountRepository";
import { IAuthRoomUserRepository } from "./User/AuthRoomUserRepository";
import { ProxyAddrTrust } from ".";

const frontend_dirname = process.cwd() + "/node_modules/nostromo-web/build";

// Расширяю класс Request у Express, добавляя в него клиентский ip-адрес.
declare global
{
    namespace Express
    {
        interface Request
        {
            clientIp: string;
        }
    }
}

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

    /** Список IP-адресов, которым разрешено заходить в админку / в форму авторизации в админку. */
    private adminAllowlist: Set<string>;

    /** Скомпилированная функция проверки списка доверенных прокси адресов. */
    private trustProxyAddrFunc?: ProxyAddrTrust;

    constructor(
        fileService: IFileService,
        tokenService: ITokenService,
        roomRepository: IRoomRepository,
        userAccountRepository: IUserAccountRepository,
        userBanRepository: IUserBanRepository,
        authRoomUserRepository: IAuthRoomUserRepository,
        adminAllowlist: Set<string>,
        trustProxyAddrFunc: ProxyAddrTrust | undefined
    )
    {
        this.fileService = fileService;
        this.tokenService = tokenService;

        this.roomRepository = roomRepository;
        this.userAccountRepository = userAccountRepository;
        this.userBanRepository = userBanRepository;
        this.authRoomUserRepository = authRoomUserRepository;

        this.adminAllowlist = adminAllowlist;

        this.trustProxyAddrFunc = trustProxyAddrFunc;

        this.app.use(this.getClientIpMiddleware);

        this.app.use(this.checkBanMiddleware);

        this.app.use(WebService.wwwMiddleware);
        this.app.use(WebService.httpsMiddleware);

        this.app.use(this.tokenService.tokenExpressMiddleware);

        this.app.disable('x-powered-by');

        this.app.use(WebService.rejectRequestWithBodyMiddleware);

        this.handleStatic();
        this.handleRoutes();

        this.app.use(WebService.preventFloodMiddleware);

        this.endPoint();
    }

    private getClientIpMiddleware: express.RequestHandler = (req: express.Request, res: express.Response, next: express.NextFunction) =>
    {
        let clientIp = "";

        if (this.trustProxyAddrFunc !== undefined)
        {
            clientIp = proxyAddr(req, this.trustProxyAddrFunc);
        }
        else
        {
            clientIp = req.ip.substring(7);
        }

        req.clientIp = clientIp;

        next();
    };

    /** Проверяем на наличие блокировки по ip-адресу пользователя. */
    private checkBanMiddleware: express.RequestHandler = (req: express.Request, res: express.Response, next: express.NextFunction) =>
    {
        if (!this.userBanRepository.has(req.clientIp))
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
        // Маршруты для админки
        this.app.get('/admin', this.adminRoute);

        // Маршруты для файлов
        this.handleFilesRoutes();

        // Маршруты для главной страницы
        this.app.get('/*', (req: express.Request, res: express.Response) =>
        {
            res.sendFile(path.join(frontend_dirname, '/', 'index.html'));
        });
    }

    /**
     * Создать для клиента JWT-токен и прикрепить его к ответу в виде httpOnly cookie.
     * @returns string - userId.
     */
    private async createAuthToken(
        res: express.Response,
        role: string
    ): Promise<string>
    {
        const expTimeInSec = (process.env.TOKEN_EXP_TIME != undefined) ? Number(process.env.TOKEN_EXP_TIME) : (14 * 24 * 60 * 60); // по умолчанию 2 недели.
        const expTime = new Date(Date.now() + (expTimeInSec * 1000));

        const userId = await this.userAccountRepository.create({ role });

        const jwt = await this.tokenService.create({ userId }, Math.round(expTime.getTime() / 1000));

        res.cookie("token", jwt, {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            expires: expTime
        });

        return userId;
    }

    /** Маршруты для комнаты. */
    private roomRoute: express.RequestHandler = async (req, res, next) =>
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

        // Пароль из query.
        const passFromQuery = req.query.p as string | undefined;

        // Пароль из HTTP-заголовка.
        let passFromHeader = req.header("Authorization");
        if (passFromHeader)
        {
            passFromHeader = Buffer.from(passFromHeader, "base64").toString("utf-8");
        }

        // Берем пароль HTTP-заголовка,
        // а если его нет, то из query,
        // а если и его нет, то берем как пустой пароль.
        const pass = passFromHeader ?? passFromQuery ?? "";

        // Проверяем пароль.
        const isPassCorrect = await this.roomRepository.checkPassword(room.id, pass);

        // IP-адрес пользователя.
        const userIp = req.clientIp;

        // Корректный пароль?
        if (isPassCorrect)
        {
            // Забудем все неудачные попытки авторизации в этой комнате.
            this.userBanRepository.clearFailedAuthAttempts(userIp, roomId);

            let userId = req.token.userId;

            // Если у пользователя не было токена.
            if (!userId)
            {
                userId = await this.createAuthToken(res, "user");
            }

            // Запоминаем для этого пользователя авторизованную комнату.
            await this.authRoomUserRepository.create(roomId, userId);
            res.sendFile(ROOM_PAGE_PATH);
        }
        else
        {
            // Запомним неудачную попытку авторизации.
            if (pass != "")
            {
                const attemptsCount = await this.userBanRepository.saveFailedAuthAttempts(userIp, roomId);
                if (attemptsCount > 0)
                {
                    console.log(`[WebService] User [${req.token.userId ?? "guest"}, ${userIp}] failed authorization in the Room [${roomId}]: ${attemptsCount} times.`);
                }
            }

            res.status(401).sendFile(ROOM_AUTH_PAGE_PATH);
        }
    };

    /** Маршруты для администратора. */
    private adminRoute: express.RequestHandler = async (req, res) =>
    {
        if ((process.env.ADMIN_ALLOW_EVERYWHERE !== "true") &&
            !this.adminAllowlist.has(req.clientIp))
        {
            return res.sendStatus(403);
        }

        // Запрещаем кешировать страницу с админкой.
        res.setHeader('Cache-Control', 'no-store');

        // Пароль из HTTP-заголовка.
        let passFromHeader = req.header("Authorization") ?? "";
        if (passFromHeader)
        {
            passFromHeader = Buffer.from(passFromHeader, "base64").toString("utf-8");
        }

        let userId = req.token.userId;

        // Если пароль верный.
        if (passFromHeader == process.env.ADMIN_PASS)
        {
            // Если токен уже есть, то повысим роль для пользователя userId.
            if (userId)
            {
                await this.userAccountRepository.setRole(userId, "admin");
            }
            else // Иначе выдадим токен с админской ролью.
            {
                userId = await this.createAuthToken(res, "admin");
            }
        }

        const userIp = req.clientIp;

        if (!userId || !this.userAccountRepository.isAdmin(userId))
        {
            if (passFromHeader != "")
            {
                // Запомним неудачную попытку авторизации в панели администратора.
                const attemptsCount = await this.userBanRepository.saveFailedAuthAttempts(userIp, "admin");
                if (attemptsCount > 0)
                {
                    console.log(`[WebService] User [${req.token.userId ?? "guest"}, ${userIp}] failed authorization in the admin panel: ${attemptsCount} times.`);
                }
            }

            res.status(401).sendFile(path.join(frontend_dirname, '/pages/admin', 'adminAuth.html'));
        }
        else
        {
            // Забудем все неудачные попытки авторизации в панели администратора.
            this.userBanRepository.clearFailedAuthAttempts(userIp, "admin");

            res.sendFile(path.join(frontend_dirname, '/pages/admin', 'admin.html'));
        }
    };

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
        this.app.get(`${FileServiceConstants.FILES_ROUTE}/:fileId`, async (req: express.Request, res: express.Response) =>
        {
            await this.fileService.downloadFile(req, res);
        });
    }

    /** Открываем доступ к статике. */
    private handleStatic(): void
    {
        this.app.use('/', express.static(frontend_dirname));
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
