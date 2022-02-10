import { FileServiceConstants, FileServiceResponse, OutgoingHttpHeaders } from "nostromo-shared/types/FileServiceTypes";
import { FileInfo } from "./FileService";
import express = require("express");
import fs = require("fs");
export class TusHeadResponse implements FileServiceResponse
{
    public headers: OutgoingHttpHeaders = {
        "Tus-Resumable": FileServiceConstants.TUS_VERSION,
        "Cache-Control": "no-store"
    };
    public statusCode: number;
    public successful = false;
    constructor(req: express.Request, fileInfo: FileInfo | undefined)
    {
        // проверяем версию Tus
        if (req.header("Tus-Resumable") != FileServiceConstants.TUS_VERSION)
        {
            this.statusCode = 412;
        }

        // если нет файла
        else if (!fileInfo)
        {
            this.statusCode = 404;
        }

        // если это не владелец файла
        // то есть этот пользователь не вызывал post creation запрос
        else if (fileInfo.ownerId != req.session.id)
        {
            this.statusCode = 403;
        }

        else
        {
            this.headers["Upload-Offset"] = fileInfo.bytesWritten.toString();
            this.headers["Upload-Length"] = fileInfo.size.toString();

            if (fileInfo.originalMetadata)
                this.headers["Upload-Metadata"] = fileInfo.originalMetadata;

            this.statusCode = 204;
            this.successful = true;
        }
    }
}

export class TusPatchResponse implements FileServiceResponse
{
    public headers: OutgoingHttpHeaders = {
        "Tus-Resumable": FileServiceConstants.TUS_VERSION,
        "Cache-Control": "no-store"
    };
    public statusCode: number;
    public successful = false;
    constructor(req: express.Request, fileInfo: FileInfo | undefined)
    {
        const contentLength = Number(req.header("Content-Length"));

        // проверяем версию Tus
        if (req.header("Tus-Resumable") != FileServiceConstants.TUS_VERSION)
        {
            this.statusCode = 412;
        }

        // если нет файла
        else if (!fileInfo)
        {
            this.statusCode = 404;
        }

        // если это не владелец файла
        // то есть этот пользователь не вызывал post creation запрос
        else if (fileInfo.ownerId != req.session.id)
        {
            this.statusCode = 403;
        }

        // проверяем content-type
        else if (req.header("Content-Type") != "application/offset+octet-stream")
        {
            this.statusCode = 415;
        }

        // проверяем offset
        else if (Number(req.header("Upload-Offset")) != fileInfo.bytesWritten)
        {
            this.statusCode = 409;
        }

        // проверяем, есть ли content-length
        else if (isNaN(contentLength))
        {
            this.statusCode = 411;
        }

        // проверяем загружаемый размер
        // чтобы был > 0 и <= чем разница между размером и оффсетом (чтобы не вылезти за границу)
        else if (contentLength <= 0 || contentLength > (fileInfo.size - fileInfo.bytesWritten))
        {
            this.statusCode = 400;
        }

        // если все в порядке
        else
        {
            this.statusCode = 204;
            this.successful = true;
        }
    }
}

export class TusOptionsResponse implements FileServiceResponse
{
    public headers: OutgoingHttpHeaders = {
        "Tus-Extension": "creation",
        "Tus-Version": FileServiceConstants.TUS_VERSION,
        "Tus-Resumable": FileServiceConstants.TUS_VERSION,
        "Tus-Max-Size": process.env.FILE_MAX_SIZE
    };
    public statusCode = 204;
    public successful = true;
}

export class TusPostCreationResponse implements FileServiceResponse
{
    public headers: OutgoingHttpHeaders = {
        "Tus-Resumable": FileServiceConstants.TUS_VERSION
    };
    public statusCode: number;

    public successful = false;

    public fileInfo: FileInfo | undefined;

    private parseMetadata(metadata: string | undefined): Map<string, string>
    {
        const metadataPairsArr = metadata?.split(",");
        const metadataMap = new Map<string, string>();
        if (metadataPairsArr)
        {
            for (const pair of metadataPairsArr)
            {
                const keyValue = pair.split(" ");
                metadataMap.set(keyValue[0], keyValue[1]);
            }
        }
        return metadataMap;
    }

    constructor(req: express.Request, fileId: string, ownerId: string, roomId: string)
    {
        // проверяем версию Tus
        if (req.header("Tus-Resumable") != FileServiceConstants.TUS_VERSION)
        {
            this.statusCode = 412;
            return;
        }

        // проверяем заголовок с размером файла
        const fileSize = req.header("Upload-Length");
        if (!fileSize || Number(fileSize) <= 0)
        {
            this.statusCode = 400;
            return;
        }

        // проверяем, не превышает ли размер файла максимально допустимый
        if (Number(fileSize) > Number(process.env.FILE_MAX_SIZE))
        {
            this.statusCode = 413;
            return;
        }

        // считываем метаданные из заголовка
        const originalMetadata = req.header("Upload-Metadata")?.toString();
        // парсим метаданные
        const metadataMap = this.parseMetadata(originalMetadata);

        // достаем имя и тип из метаданных
        const filename = metadataMap.get("filename");
        const filetype = metadataMap.get("filetype");

        this.fileInfo = {
            id: fileId,
            name: filename ? Buffer.from(filename, "base64").toString("utf-8") : fileId,
            type: filetype ? Buffer.from(filetype, "base64").toString("utf-8") : "application/offset+octet-stream",
            size: Number(fileSize),
            bytesWritten: 0,
            ownerId,
            roomId,
            originalMetadata
        };

        this.statusCode = 201;
        this.successful = true;
    }
}

export class GetResponse implements FileServiceResponse
{
    public statusCode: number;
    public statusMsg?: string;
    public successful = false;

    constructor(req: express.Request, fileInfo: FileInfo | undefined, filePath: string)
    {
        // если файла не существует
        if (!fileInfo || !fs.existsSync(filePath))
        {
            this.statusCode = 404;
            return;
        }

        // если пользователь не авторизован в комнате
        // и не имеет права качать этот файл
        if (!req.session.auth ||
            !req.session.authRoomsId?.includes(fileInfo.roomId)
        )
        {
            this.statusCode = 403;
            return;
        }

        // если файл ещё не закачался на сервер
        if (fileInfo.bytesWritten != fileInfo.size)
        {
            this.statusCode = 202;
            this.statusMsg = "File is not ready";
            return;
        }

        this.statusCode = 200;
        this.successful = true;
    }
}