import express = require("express");
import path = require("path");
import { nanoid } from "nanoid";
import fs = require('fs');
import { FileHandlerResponse, FileHandlerConstants } from "nostromo-shared/types/FileHandlerTypes";
import { TusHeadResponse, TusPatchResponse, TusOptionsResponse, TusPostCreationResponse } from "./FileHandlerTusProtocol";

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

        const tusRes = new TusHeadResponse(req, fileInfo);
        this.assignHeaders(tusRes, res);

        res.status(tusRes.statusCode).end();
    }

    public async tusPatchFile(
        req: express.Request,
        res: express.Response
    ): Promise<void>
    {
        // проверяем, существует ли папка для файлов
        if (!fs.existsSync(this.FILES_PATH))
            fs.mkdirSync(this.FILES_PATH);

        const fileId = req.params["fileId"];
        const fileInfo = this.fileStorage.get(fileId);

        const tusRes = new TusPatchResponse(req, fileInfo);

        // не возникло проблем с заголовками
        if (tusRes.statusCode == 204)
        {
            await this.writeFile(fileInfo!, fileId, req);
            tusRes.headers["Upload-Offset"] = String(fileInfo!.bytesWritten);
        }

        this.assignHeaders(tusRes, res);

        res.status(tusRes.statusCode).end();
    }

    private async writeFile(fileInfo: FileInfo, fileId: string, req: express.Request)
        : Promise<void>
    {
        return new Promise((resolve, reject) =>
        {
            // offset до patch
            const oldBytesWritten = fileInfo.bytesWritten;

            // указываем путь и название
            const filePath = path.join(this.FILES_PATH, fileId);
            const outStream = fs.createWriteStream(filePath, { start: oldBytesWritten, flags: "a" });

            // если закрылся реквест, то закроем стрим
            req.on("close", () =>
            {
                outStream.end();
            });

            // если стрим закрылся по любой причине,
            // то запишем сколько успели загрузить байт
            outStream.on("close", () =>
            {
                fileInfo.bytesWritten += outStream.bytesWritten;
                resolve();
            });

            // если ошибки
            outStream.on("error", (err) =>
            {
                reject(err);
            });

            req.on("error", (err) =>
            {
                reject(err);
            });

            // перенаправляем стрим из реквеста в файловый стрим
            req.pipe(outStream);
        });
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

        if (!fileInfo) return res.status(404).end("404 Not Found");

        if (!req.session.auth ||
            !req.session.authRoomsId?.includes(fileInfo.roomId)
        )
        {
            return res.status(403).end("403 Forbidden");
        }

        if (fileInfo.bytesWritten != fileInfo.size)
        {
            return res.status(202).end("202 Accepted: File is not ready");
        }

        return res.download(path.join(this.FILES_PATH, fileId), fileInfo.name);
    }
    public tusPostCreateFile(
        req: express.Request,
        res: express.Response
    ): void
    {
        const roomId = req.header("Room-Id")?.toString();
        if (!roomId || !req.session.authRoomsId?.includes(roomId))
            return res.status(403).end();

        const ownerId = req.session.id;
        const fileId: string = nanoid(32);

        const tusRes = new TusPostCreationResponse(req, fileId, ownerId, roomId);
        this.assignHeaders(tusRes, res);

        if (tusRes.fileInfo)
        {
            this.fileStorage.set(fileId, tusRes.fileInfo);
            res.location(fileId);
        }

        res.status(tusRes.statusCode).end();
    }
}