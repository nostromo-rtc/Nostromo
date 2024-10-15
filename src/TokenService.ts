import jose = require("jose");
import crypto = require("crypto");
import express = require("express");
import cookie = require("cookie");
import { Socket } from "socket.io/dist/socket";
import { SocketNextFunction } from "./SocketService/SocketManager";
import { IUserAccountRepository } from "./User/UserAccountRepository";

// Данные, хранящиеся внутри токена.
export interface TokenData
{
    userId?: string;
}

// Расширяю класс Request у Express, добавляя в него данные из токена.
declare global
{
    namespace Express
    {
        interface Request
        {
            token: TokenData;
        }
    }
}

// Расширяю класс Handshake у Socket.IO, добавляя в него данные из токена.
declare module "socket.io/dist/socket-types" {
    interface Handshake
    {
        token: TokenData;
    }
}

type TokenExpressMiddleware = (req: express.Request, res: unknown, next: express.NextFunction) => Promise<void>;
export type TokenSocketMiddleware = (req: Socket, next: SocketNextFunction) => Promise<void>;

export interface ITokenService
{
    /**
     * Middlware для Express.
     * Парсит cookie с токеном и помещает содержимое в 'req.token'.
     */
    tokenExpressMiddleware: TokenExpressMiddleware;

    /**
     * Middlware для Socket.IO.
     * Парсит cookie с токеном и помещает содержимое в 'handshake.token'.
     */
    tokenSocketMiddleware: TokenSocketMiddleware;

    /**
     * Создать токен.
     * @returns string - токен.
     */
    create(data: TokenData, exp: number): Promise<string>;

    /**
     * Проверить токен.
     * @returns string - Id пользователя, если токен валиден.
     * @returns undefined - если токен не валиден.
     */
    verify(jwt: string): Promise<string | undefined>;
}

export class TokenService implements ITokenService
{
    private secret = crypto.createSecretKey(Buffer.from(process.env.TOKEN_SECRET_KEY!));

    private userAccountRepository: IUserAccountRepository;

    constructor(userAccountRepository: IUserAccountRepository)
    {
        this.userAccountRepository = userAccountRepository;
    }

    public tokenExpressMiddleware: TokenExpressMiddleware = async (req, res, next) =>
    {
        // Инициализируем пустой объект.
        req.token = {};

        // Парсим куки.
        const cookies = cookie.parse(req.headers.cookie ?? "");

        // Считываем токен из куки.
        const jwt = cookies.token;

        if (jwt)
        {
            const userId = await this.verify(jwt);

            // Если на сервере есть информация о пользователе userId.
            if (userId && this.userAccountRepository.has(userId))
            {
                req.token.userId = userId;
            }
        }

        next();
    };

    public tokenSocketMiddleware: TokenSocketMiddleware = async (socket, next) =>
    {
        const handshake = socket.handshake;

        // Инициализируем пустой объект.
        handshake.token = {};

        // Парсим куки.
        const cookies = cookie.parse(handshake.headers.cookie ?? "");

        // Считываем токен из куки.
        const jwt = cookies.token;

        if (jwt)
        {
            const userId = await this.verify(jwt);

            // Если на сервере есть информация о пользователе userId.
            if (userId && this.userAccountRepository.has(userId))
            {
                handshake.token.userId = userId;
            }
        }

        next();
    };

    public async create(data: TokenData, exp: number): Promise<string>
    {
        const jwt = await new jose.SignJWT({ "userId": data.userId })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime(exp)
            .sign(this.secret);

        return jwt;
    }

    public async verify(jwt: string): Promise<string | undefined>
    {
        try
        {
            const { payload } = await jose.jwtVerify(jwt, this.secret);
            return payload.userId as string;
        }
        catch (error)
        {
            return undefined;
        }
    }
}