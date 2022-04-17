import express = require("express");
import path = require("path");
import { nanoid } from "nanoid";
import fs = require('fs');
import { FileServiceResponse, FileServiceConstants } from "nostromo-shared/types/FileServiceTypes";
import { TusHeadResponse, TusPatchResponse, TusOptionsResponse, TusPostCreationResponse, GetResponse } from "./FileServiceTusProtocol";
import { WebService } from "../WebService";
import { IAuthRoomUserRepository } from "../User/AuthRoomUserRepository";
import { IRoomRepository } from "../Room/RoomRepository";

/** Случайный Id + расширение */
type FileId = string;

export type FileInfo = {
    /** id файла */
    id: string;
    /** Оригинальное название файла. */
    name: string;
    /** Тип файла. */
    type: string;
    /** Размер файла в байтах. */
    size: number;
    /** Сколько байт уже было получено сервером. */
    bytesWritten: number;
    /** Id аккаунта пользователя, загружающего файл. */
    ownerId: string;
    /** Id комнаты, в которой загружали файл. */
    roomId: string;
    /** Оригинальные метаданные, которые указал пользователь. */
    originalMetadata?: string;
};

/** Сервис для работы с файлами. */
export interface IFileService
{
    /** Получить информацию о файле (метаданные). */
    getFileInfo(fileId: string): FileInfo | undefined;

    /** Обработка запроса Head. */
    tusHeadInfo(
        req: express.Request,
        res: express.Response
    ): void;

    /** Обработка запроса Patch. */
    tusPatchFile(
        req: express.Request,
        res: express.Response
    ): Promise<void>;

    /** Обработка запроса Options. */
    tusOptionsInfo(
        req: express.Request,
        res: express.Response
    ): void;

    /** Обработка запроса Post. */
    tusPostCreateFile(
        req: express.Request,
        res: express.Response
    ): void;

    /** Обработка запроса Get (скачивание файла клиентом). */
    downloadFile(
        req: express.Request,
        res: express.Response
    ): void;
}

export class FileService implements IFileService
{
    private readonly FILES_PATH = path.join(process.cwd(), FileServiceConstants.FILES_ROUTE);
    private fileStorage = new Map<FileId, FileInfo>();
    private authRoomUserRepository: IAuthRoomUserRepository;
    private roomRepository: IRoomRepository;

    constructor(
        authRoomUserRepository: IAuthRoomUserRepository,
        roomRepository: IRoomRepository
    )
    {
        this.authRoomUserRepository = authRoomUserRepository;
        this.roomRepository = roomRepository;

        if (!process.env.FILE_MAX_SIZE)
        {
            process.env.FILE_MAX_SIZE = String(20 * 1024 * 1024 * 1024);
        }
    }

    public getFileInfo(fileId: string): FileInfo | undefined
    {
        return this.fileStorage.get(fileId);
    }

    /** Присвоить HTTP-заголовки ответу Response. */
    private assignHeaders(fromTus: FileServiceResponse, toExpress: express.Response)
    {
        for (const header in fromTus.headers)
        {
            const value = fromTus.headers[header];
            toExpress.header(header, value);
        }
    }

    /** Отправить HTTP код-ответа. */
    private sendStatus(res: express.Response, statusCode: number, statusMsg?: string): void
    {
        if (statusMsg)
        {
            res.status(statusCode).end(statusMsg);
        }
        else
        {
            res.sendStatus(statusCode);
        }
    }

    /** Отправить HTTP код-ответа с учетом флудовой атаки. */
    private sendStatusWithFloodPrevent(
        conditionForPrevent: boolean,
        req: express.Request,
        res: express.Response,
        statusCode: number,
        statusMsg?: string
    ): void
    {
        if (conditionForPrevent)
        {
            WebService.sendCodeAndDestroySocket(req, res, statusCode);
        }
        else
        {
            this.sendStatus(res, statusCode, statusMsg);
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

        this.sendStatus(res, tusRes.statusCode);
    }

    /** Непосредственно записываем поток в файл на сервере для Patch. */
    private async writeFile(
        fileInfo: FileInfo,
        fileId: string,
        req: express.Request
    ): Promise<void>
    {
        return new Promise((resolve, reject) =>
        {
            console.log(`[FileHandler] User (${req.ip}) uploading file:`, fileInfo);

            // offset до patch
            const oldBytesWritten = fileInfo.bytesWritten;

            // указываем путь и название
            const filePath = path.join(this.FILES_PATH, fileId);
            const outStream = fs.createWriteStream(filePath, { start: oldBytesWritten, flags: "a" });

            // если закрылся реквест, то закроем стрим
            req.on("close", () => outStream.end());

            // если стрим закрылся по любой причине,
            // то запишем сколько успели загрузить байт
            outStream.on("close", () =>
            {
                fileInfo.bytesWritten += outStream.bytesWritten;
                resolve();
            });

            // если ошибки
            outStream.on("error", (err) => reject(err));
            req.on("error", (err) => reject(err));

            // перенаправляем стрим из реквеста в файловый стрим
            req.pipe(outStream);
        });
    }

    public async tusPatchFile(
        req: express.Request,
        res: express.Response
    ): Promise<void>
    {
        // проверяем, существует ли папка для файлов
        if (!fs.existsSync(this.FILES_PATH))
        {
            fs.mkdirSync(this.FILES_PATH);
        }

        const fileId = req.params["fileId"];
        const fileInfo = this.fileStorage.get(fileId);
        const tusRes = new TusPatchResponse(req, fileInfo);

        try
        {
            // если корректный запрос, то записываем в файл
            if (tusRes.successful)
            {
                await this.writeFile(fileInfo!, fileId, req);
                tusRes.headers["Upload-Offset"] = String(fileInfo!.bytesWritten);
            }

            this.assignHeaders(tusRes, res);

            const conditionForPrevent = (!tusRes.successful && !WebService.requestHasNotBody(req));
            this.sendStatusWithFloodPrevent(conditionForPrevent, req, res, tusRes.statusCode);
        }
        catch (error)
        {
            console.error(`[Error] [FileService] Error while uploading file [${fileId}] |`, (error as Error));
        }
    }

    public tusOptionsInfo(
        req: express.Request,
        res: express.Response
    ): void
    {
        const tusRes = new TusOptionsResponse();
        this.assignHeaders(tusRes, res);

        this.sendStatus(res, tusRes.statusCode);
    }

    public downloadFile(
        req: express.Request,
        res: express.Response
    ): void
    {
        // получаем из запроса Id файла
        // и информацию о файле из этого Id
        const fileId: FileId = req.params.fileId;
        const fileInfo = this.fileStorage.get(fileId);
        console.log(`[FileHandler] User (${req.ip}) downloading file:`, fileInfo);
        const filePath = path.join(this.FILES_PATH, fileId);

        const customRes = new GetResponse(
            req, fileInfo, filePath,
            this.authRoomUserRepository,
            this.roomRepository
        );

        if (!customRes.successful)
        {
            this.sendStatus(res, customRes.statusCode, customRes.statusMsg);
        }
        else
        {
            res.download(filePath, fileInfo!.name);
        }
    }

    public tusPostCreateFile(
        req: express.Request,
        res: express.Response
    ): void
    {
        const conditionForPrevent = !WebService.requestHasNotBody(req);

        // Проверяем, имеет ли право пользователь userId
        // выкладывать файл в комнату с номером Room-Id.
        const roomId = req.header("Room-Id")?.toString();
        const userId = req.session.userId;
        if (!roomId || !userId || !this.authRoomUserRepository.has(roomId, userId))
        {
            this.sendStatusWithFloodPrevent(conditionForPrevent, req, res, 403);
            return;
        }

        // запоминаем владельца файла
        const ownerId = userId;

        // Генерируем уникальный Id для файла.
        // Этот Id и является названием файла на сервере.
        const fileId: string = nanoid(32);

        const tusRes = new TusPostCreationResponse(req, fileId, ownerId, roomId);
        this.assignHeaders(tusRes, res);

        // если проблем не возникло
        if (tusRes.successful)
        {
            this.fileStorage.set(fileId, tusRes.fileInfo!);
            res.location(fileId);
        }

        this.sendStatusWithFloodPrevent(conditionForPrevent, req, res, tusRes.statusCode);
    }
}