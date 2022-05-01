import jose = require("jose");
import crypto = require("crypto");

export interface TokenData
{
    userId?: string;
}

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

export interface ITokenService
{
    /** Создать токен. */
    create(data: TokenData): Promise<string>;
    /** Проверить токен. */
    verify(jwt: string): Promise<string | undefined>;
}

export class TokenService implements ITokenService
{
    private secret = crypto.createSecretKey(Buffer.from(process.env.EXPRESS_SESSION_KEY!));

    public async create(data: TokenData): Promise<string>
    {
        const jwt = await new jose.SignJWT({ "userId": data.userId })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('3d')
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