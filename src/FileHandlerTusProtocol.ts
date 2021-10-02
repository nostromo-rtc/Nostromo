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
        if (req.headers["Tus-Resumable"] != FileHandlerConstants.TUS_VERSION)
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
        // проверяем версию Tus
        if (req.headers["Tus-Resumable"] != FileHandlerConstants.TUS_VERSION)
        {
            this.statusCode = 412;
        }

        // проверяем content-type
        else if (req.headers["content-type"] != "application/offset+octet-stream")
        {
            this.statusCode = 415;
        }

        // если нет файла
        else if (!fileInfo)
        {
            this.statusCode = 404;
        }

        // проверяем offset
        else if (Number(req.headers["Upload-Offset"]) != fileInfo.bytesWritten)
        {
            this.statusCode = 409;
        }

        // если все в порядке
        else
        {
            this.headers["Upload-Length"] = fileInfo.size.toString();
            this.statusCode = 204;
        }
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
    public statusCode = 201;

    public fileInfo: FileInfo | undefined;

    constructor(req: express.Request, fileId: string, ownerId: string, roomId: string)
    {
        const metadata = req.headers["Upload-Metadata"]?.toString();
        const metadataPairsArr = metadata?.split(",");
        const metadataMap = new Map<string, string>();
        if (metadataPairsArr)
        {
            for (const pair of metadataPairsArr)
            {
                const keyValue = pair.split(" ");
                metadataMap.set(keyValue[0], keyValue[1]);
            }

            const fileSize = req.headers["Upload-Length"];

            if (!fileSize || Number(fileSize) <= 0)
            {
                this.statusCode = 403;
            }
            else
            {
                this.fileInfo = {
                    name: metadataMap.get("filename") ?? fileId,
                    type: btoa(metadataMap.get("filetype") ?? "application/offset+octet-stream"),
                    size: Number(fileSize),
                    bytesWritten: 0,
                    ownerId,
                    roomId
                };
            }
        }
    }
}