import fs = require("fs");
import path = require("path");
export async function writeToFile(filepath: string, values: Iterable<unknown> | ArrayLike<unknown>): Promise<void>
{
    return new Promise((resolve, reject) =>
    {
        const folder = path.dirname(filepath);

        // Проверяем, существует ли папка, в которую сохраняется файл.
        if (!fs.existsSync(folder))
        {
            fs.mkdirSync(folder);
        }

        // Создаём новый стрим для того, чтобы полностью перезаписать файл.
        const writeStream = fs.createWriteStream(filepath, { encoding: "utf8" });

        writeStream.write(JSON.stringify(values, null, 2));

        writeStream.on("finish", () =>
        {
            resolve();
        });

        writeStream.on("error", (err: Error) =>
        {
            reject(err);
        });

        writeStream.end();
    });
}

export function readFromFileSync(path: string): string | undefined
{
    if (fs.existsSync(path))
    {
        return fs.readFileSync(path, 'utf-8');
    }
    return undefined;
}

export async function readFromFile(path: string): Promise<string | undefined>
{
    return new Promise((resolve, reject) =>
    {
        if (fs.existsSync(path))
        {
            fs.readFile(path, 'utf-8', (err, data) =>
            {
                if (err != null)
                {
                    reject(err);
                }
                else
                {
                    resolve(data);
                }
            });
        }
        else
        {
            resolve(undefined);
        }
    });
}

export async function removeFile(path: string): Promise<void>
{
    return new Promise((resolve, reject) =>
    {
        fs.unlink(path, (err) =>
        {
            if (err)
            {
                reject(err);
            }
            else
            {
                resolve();
            }
        });
    });
}

export function encodeRfc8187ValueChars(str: string)
{
    const hexEscape = (c: string) =>
    {
        return '%' + String(c)
            .charCodeAt(0)
            .toString(16)
            .toUpperCase();
    };

    return encodeURIComponent(str).
        replace(/['()*]/g, hexEscape);
}