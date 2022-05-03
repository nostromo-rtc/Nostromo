import express = require("express");
import path = require("path");
import fs = require('fs');
import { FileServiceResponse, FileServiceConstants } from "nostromo-shared/types/FileServiceTypes";
import { TusHeadResponse, TusPatchResponse, TusOptionsResponse, TusPostCreationResponse, GetResponse } from "./FileServiceTusProtocol";
import { WebService } from "../WebService";
import { IAuthRoomUserRepository } from "../User/AuthRoomUserRepository";
import { IRoomRepository } from "../Room/RoomRepository";
import { FileId, IFileRepository } from "./FileRepository";

/** Сервис для работы с файлами. */
export interface IFileService
{
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
    ): Promise<void>;

    /** Обработка запроса Get (скачивание файла клиентом). */
    downloadFile(
        req: express.Request,
        res: express.Response
    ): void;
}

export class FileService implements IFileService
{
    private readonly FILES_PATH = path.join(process.cwd(), "data", FileServiceConstants.FILES_ROUTE);

    private fileRepository: IFileRepository;
    private authRoomUserRepository: IAuthRoomUserRepository;
    private roomRepository: IRoomRepository;

    constructor(
        fileRepository: IFileRepository,
        authRoomUserRepository: IAuthRoomUserRepository,
        roomRepository: IRoomRepository
    )
    {
        this.fileRepository = fileRepository;
        this.authRoomUserRepository = authRoomUserRepository;
        this.roomRepository = roomRepository;

        if (!process.env.FILE_MAX_SIZE)
        {
            process.env.FILE_MAX_SIZE = String(20 * 1024 * 1024 * 1024);
        }
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
        const fileInfo = this.fileRepository.get(fileId);

        const tusRes = new TusHeadResponse(req, fileInfo);
        this.assignHeaders(tusRes, res);

        this.sendStatus(res, tusRes.statusCode);
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
        const fileInfo = this.fileRepository.get(fileId);
        const tusRes = new TusPatchResponse(req, fileInfo);

        try
        {
            // Если корректный запрос, то записываем в файл.
            if (tusRes.successful)
            {
                console.log(`[FileService] User [${fileInfo!.ownerId}, ${req.ip.substring(7)}] uploading file: ${fileInfo!.id}.`);

                // Запишем поток в файл и получим новое значение offset.
                fileInfo!.bytesWritten = await this.fileRepository.writeFile(req, fileInfo!.id, fileInfo!.bytesWritten);

                tusRes.headers["Upload-Offset"] = String(fileInfo!.bytesWritten);

                // Обновим информацию о файле (а именно количество загруженных байтов).
                await this.fileRepository.update(fileInfo!);
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
        const fileInfo = this.fileRepository.get(fileId);
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
            console.log(`[FileService] User [${fileInfo!.id}, ${req.ip.substring(7)}] downloading file: ${fileInfo!.id}.`);

            const fileType = fileInfo!.type;
            res.contentType(fileType);

            const inlineTypes = ["audio", "video", "image"];
            const isInlineFile = inlineTypes.some((str) => fileType.includes(str));

            const disposition = (isInlineFile) ? "inline" : "attachment";
            res.header("Content-Disposition", `${disposition}; filename="${fileInfo!.name}"`);

            res.sendFile(filePath);
        }
    }

    public async tusPostCreateFile(
        req: express.Request,
        res: express.Response
    ): Promise<void>
    {
        const conditionForPrevent = !WebService.requestHasNotBody(req);

        // Проверяем, имеет ли право пользователь userId
        // выкладывать файл в комнату с номером Room-Id.
        const roomId = req.header("Room-Id")?.toString();
        const userId = req.token.userId;
        if (!roomId || !userId || !this.authRoomUserRepository.has(roomId, userId))
        {
            this.sendStatusWithFloodPrevent(conditionForPrevent, req, res, 403);
            return;
        }

        // запоминаем владельца файла
        const ownerId = userId;

        const tusRes = new TusPostCreationResponse(req, ownerId, roomId);
        this.assignHeaders(tusRes, res);

        // если проблем не возникло
        if (tusRes.successful)
        {
            const fileId = await this.fileRepository.create(tusRes.fileInfo!);
            res.location(fileId);
        }

        this.sendStatusWithFloodPrevent(conditionForPrevent, req, res, tusRes.statusCode);
    }
}