import express = require("express");
import path = require("path");
import { nanoid } from "nanoid";
import fs = require('fs');

type FileId = string;

interface FileInfo
{
    name: string;
    type: string;
    size: number;
    roomId: string;
}

// класс - обработчик файлов
export class FileHandler
{
    private readonly FILES_PATH = path.join(process.cwd(), "/files");
    private fileStorage = new Map<FileId, FileInfo>();

    public getFileInfo(fileId: string): FileInfo | undefined
    {
        return this.fileStorage.get(fileId);
    }
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
        const fileId: string = nanoid(32);

        // проверяем, существует ли папка для файлов
        if (!fs.existsSync(this.FILES_PATH))
            fs.mkdirSync(this.FILES_PATH);

        // указываем путь и название
        const filePath = path.join(this.FILES_PATH, fileId);
        const outStream = fs.createWriteStream(filePath);

        // TODO: поменять на номер из заголовка
        const roomId = req.session.joinedRoomId!;
        if (!req.session.authRoomsId?.includes(roomId))
        {
            return res.status(403).end();
        }

        this.fileStorage.set(fileId, { name: "test", type: "image", size: 10, roomId });

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