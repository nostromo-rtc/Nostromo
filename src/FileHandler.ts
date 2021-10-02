import express = require("express");
import path = require("path");
import { nanoid } from "nanoid";
import fs = require('fs');
import { FileHandlerResponse, FileHandlerConstants } from "nostromo-shared/types/FileHandlerTypes";
import { TusHeadResponse, TusOptionsResponse } from "./FileHandlerTusProtocol";

/** Случайный Id + расширение */
type FileId = string;

export type FileInfo = {
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

    private assignHeaders(fromTus: FileHandlerResponse, toExpress: express.Response)
    {
        for (const header in fromTus.headers)
        {
            const value = fromTus.headers[header];
            toExpress.header(header, value);
        }
    }

    public tusHeadInfo(
        req: express.Request,
        res: express.Response
    ): void
    {
        const fileId = req.params["fileId"];
        const fileInfo = this.fileStorage.get(fileId);
        const tusRes = new TusHeadResponse(fileInfo);
        this.assignHeaders(tusRes, res);

        res.status(tusRes.statusCode).end();
    }

    public tusOptionsInfo(
        req: express.Request,
        res: express.Response
    ): void
    {
        const tusRes = new TusOptionsResponse();
        this.assignHeaders(tusRes, res);
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