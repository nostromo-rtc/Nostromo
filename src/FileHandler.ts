import express = require("express");
import formidable = require("formidable");
import path = require("path");
import { nanoid } from "nanoid";
import fs = require('fs');

type FileId = string;

interface FileInfo
{
    name: string | null;
    type: string | null;
    extension?: string;
    roomId: string;
}

// класс - обработчик файлов
export class FileHandler
{
    private readonly FILES_PATH = path.join(process.cwd(), "/files");
    private fileStorage = new Map<FileId, FileInfo>();
    public handleFileDownload(
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
    public handleFileUpload(
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ): void
    {
        const form = formidable({
            maxFileSize: 10 * 1024 * 1024 * 1024
        });

        let fileId: string = nanoid(32);

        form.on("fileBegin", (formName, file) =>
        {
            const extension: string = express.static.mime.extension(file.type!)!;

            fileId += `.${extension}`;

            // проверяем, существует ли папка для файлов
            if (!fs.existsSync(this.FILES_PATH))
                fs.mkdirSync(this.FILES_PATH);

            // указываем путь и название
            file.path = path.join(this.FILES_PATH, fileId);

            const { name, type } = file;
            const roomId = req.session.joinedRoomId!;
            this.fileStorage.set(fileId, { name, type, extension, roomId });
        });

        form.on("error", (err) =>
        {
            this.fileStorage.delete(fileId);
            return next(err);
        });

        form.parse(req, (err) =>
        {
            if (err) return next(err);
        });

        form.once("end", () =>
        {
            return res.send(fileId);
        });
    }
}