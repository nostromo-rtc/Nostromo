import { FileHandlerConstants, FileHandlerResponse, OutgoingHttpHeaders } from "nostromo-shared/types/FileHandlerTypes";
import { FileInfo } from "./FileHandler";
import express = require("express");
export class TusHeadResponse implements FileHandlerResponse
{
    public headers: OutgoingHttpHeaders = {
        "Tus-Resumable": FileHandlerConstants.TUS_VERSION,
        "Cache-Control": "no-store"
    };
    public statusCode: number;
    constructor(req: express.Request, fileInfo: FileInfo | undefined)
    {
        // проверяем версию Tus
        if (req.header("Tus-Resumable") != FileHandlerConstants.TUS_VERSION)
        {
            this.statusCode = 412;
        }
        else if (!fileInfo)
        {
            this.statusCode = 404;
        }
        else
        {
            this.headers["Upload-Offset"] = fileInfo.bytesWritten.toString();
            this.headers["Upload-Length"] = fileInfo.size.toString();
            this.statusCode = 204;
        }
    }
}

export class TusPatchResponse implements FileHandlerResponse
{
    public headers: OutgoingHttpHeaders = {
        "Tus-Resumable": FileHandlerConstants.TUS_VERSION,
        "Cache-Control": "no-store"
    };
    public statusCode: number;
    constructor(req: express.Request, fileInfo: FileInfo | undefined)
    {
        const contentLength = Number(req.header("Content-Length"));

        // проверяем версию Tus
        if (req.header("Tus-Resumable") != FileHandlerConstants.TUS_VERSION)
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

        // проверяем загружаемый размер
        // чтобы был > 0 и < чем разница между размером и оффсетом (чтобы не вылезти за границу)
        else if (contentLength <= 0 || contentLength > (fileInfo.size - fileInfo.bytesWritten))
        {
            this.statusCode = 403;
        }

        // если все в порядке
        else this.statusCode = 204;
    }
}

export class TusOptionsResponse implements FileHandlerResponse
{
    public headers: OutgoingHttpHeaders = {
        "Tus-Extension": "creation",
        "Tus-Version": FileHandlerConstants.TUS_VERSION,
        "Tus-Resumable": FileHandlerConstants.TUS_VERSION
    };
    public statusCode = 204;
}

export class TusPostCreationResponse implements FileHandlerResponse
{
    public headers: OutgoingHttpHeaders = {
        "Tus-Resumable": FileHandlerConstants.TUS_VERSION
    };
    public statusCode: number;

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
        if (req.header("Tus-Resumable") != FileHandlerConstants.TUS_VERSION)
        {
            this.statusCode = 412;
            return;
        }

        // проверяем заголовок с размером файла
        const fileSize = req.header("Upload-Length");
        if (!fileSize || Number(fileSize) <= 0)
        {
            this.statusCode = 412;
            return;
        }

        // парсим метаданные
        const metadataMap = this.parseMetadata(req.header("Upload-Metadata")?.toString());

        const filename = metadataMap.get("filename");
        const filetype = metadataMap.get("filetype");

        this.fileInfo = {
            name: filename ? Buffer.from(filename, "base64").toString("utf-8") : fileId,
            type: filetype ? Buffer.from(filetype, "base64").toString("utf-8") : "application/offset+octet-stream",
            size: Number(fileSize),
            bytesWritten: 0,
            ownerId,
            roomId
        };

        console.log(this.fileInfo);

        this.statusCode = 201;
    }
}