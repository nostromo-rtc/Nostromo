import express = require("express");
import path = require("path");
import { nanoid } from "nanoid";
import fs = require('fs');
import { FileHandlerConstants, FileHandlerResponse, IncomingHttpHeaders } from "nostromo-shared/types/FileHandlerTypes";

/** Случайный Id + расширение */
type FileId = string;

class TusHeadResponse implements FileHandlerResponse
{
    public headers: IncomingHttpHeaders = {
        "Tus-Resumable": FileHandlerConstants.TUS_VERSION,
        "Cache-Control": "no-store"
    };
    public statusCode: number;
    constructor(fileInfo: FileInfo | undefined)
    {
        if (!fileInfo)
        {
            this.statusCode = 404;
        }
        else
        {
            this.headers["Upload-Offset"] = fileInfo.bytesWritten.toString();
            this.headers["Upload-Length"] = fileInfo.size.toString();
            this.statusCode = 200;
        }
    }
}

type FileInfo = {
    /** Оригинальное название файла. */
    name: string;
    /** Тип файла. */
    type: string;
    /** Размер файла в байтах. */
    size: number;
    /** Сколько байт уже было получено сервером. */
    bytesWritten: number;
    /** Id сессии пользователя, загружающего файл. */
    ownerId: string;
    /** Id комнаты, в которой загружали файл. */
    roomId: string;
};

// класс - обработчик файлов
export class FileHandler
{
    private readonly FILES_PATH = path.join(process.cwd(), FileHandlerConstants.FILES_ROUTE);
    private fileStorage = new Map<FileId, FileInfo>();

    public getFileInfo(fileId: string): FileInfo | undefined
    {
        return this.fileStorage.get(fileId);
    }

    public fileUploadOffsetInfo(
        req: express.Request,
        res: express.Response
    ): void
    {
        const fileId = req.params["fileId"];
        const fileInfo = this.fileStorage.get(fileId);
        const tusRes = new TusHeadResponse(fileInfo);

        for (const header in tusRes.headers)
        {
            const value = tusRes.headers[header];
            res.header(header, value);
        }

        res.status(tusRes.statusCode).end();
    }

    public fileDownload(
        req: express.Request,
        res: express.Response
    ): void
    {
        const fileId: FileId = req.params.fileId;
        const fileInfo = this.fileStorage.get(fileId);

        const error404 = () => { res.status(404).end('404 Error: page not found'); };

        if (!fileInfo ||
            !req.session.auth ||
            !req.session.authRoomsId?.includes(fileInfo.roomId)
        )
        {
            return error404();
        }
        //res.set("Content-Type", fileInfo.type!);
        //res.set("Content-Disposition", `inline; filename="${fileInfo.name!}"`)
        //res.sendFile(path.join(this.FILES_PATH, fileId));
        return res.download(path.join(this.FILES_PATH, fileId), fileInfo.name ?? fileId);
    }
    public fileUpload(
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ): void
    {
        const fileId: string = nanoid(32);

        // проверяем, существует ли папка для файлов
        if (!fs.existsSync(this.FILES_PATH))
            fs.mkdirSync(this.FILES_PATH);

        // указываем путь и название
        const filePath = path.join(this.FILES_PATH, fileId);
        const outStream = fs.createWriteStream(filePath);

        // TODO: поменять на номер из заголовка
        const roomId = req.session.joinedRoomId!;
        const ownerId = req.session.id;
        if (!req.session.authRoomsId?.includes(roomId))
        {
            return res.status(403).end();
        }

        this.fileStorage.set(fileId, { name: "test", type: "image", bytesWritten: 0, size: 10, roomId, ownerId });

        outStream.on("finish", () =>
        {
            console.log("finish");
            return res.status(201).end(fileId);
        });

        req.on("close", () =>
        {
            console.log(outStream.bytesWritten);
        });

        req.pipe(outStream);
    }
}