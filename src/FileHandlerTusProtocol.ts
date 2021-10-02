import { FileHandlerConstants, FileHandlerResponse, IncomingHttpHeaders, OutgoingHttpHeaders } from "nostromo-shared/types/FileHandlerTypes";
import { FileInfo } from "./FileHandler";
export class TusHeadResponse implements FileHandlerResponse
{
    public headers: OutgoingHttpHeaders = {
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
            this.statusCode = 204;
        }
    }
}

export class TusOptionsResponse implements FileHandlerResponse
{
    public headers: OutgoingHttpHeaders = {
        "Tus-Extension" : "",
        "Tus-Version" : FileHandlerConstants.TUS_VERSION,
        "Tus-Resumable" : FileHandlerConstants.TUS_VERSION
    };
    public statusCode = 204;
}