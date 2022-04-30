import path = require('path');
import fs = require('fs');
import { nanoid } from "nanoid";

/** Случайный Id. */
export type FileId = string;

export interface NewFileInfo
{
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
}

export interface FileInfo extends NewFileInfo
{
    /** Id файла. */
    id: string;
}

export interface IFileRepository
{
    /** Создать запись о файле. */
    create(info: NewFileInfo): Promise<string>;

    /** Удалить запись о файле. */
    remove(id: string): Promise<void>;

    /** Изменить информацию о файле. */
    update(info: FileInfo): Promise<void>;

    /** Получить запись о файле. */
    get(id: string): FileInfo | undefined;

    /** Есть ли запись о таком файле? */
    has(id: string): boolean;
}

export class PlainFileRepository implements IFileRepository
{
    private readonly FILES_INFO_FILE_PATH = path.resolve(process.cwd(), "data", "files.json");
    private files = new Map<FileId, FileInfo>();

    constructor()
    {
        this.init();
    }

    /** Полностью обновить содержимое файла с записями о комнатах. */
    private async rewriteFilesInfoToFile(): Promise<void>
    {
        return new Promise((resolve, reject) =>
        {
            // Создаём новый стрим для того, чтобы полностью перезаписать файл.
            const writeStream = fs.createWriteStream(this.FILES_INFO_FILE_PATH, { encoding: "utf8" });

            writeStream.write(JSON.stringify(Array.from(this.files.values()), null, 2));

            writeStream.on("finish", () =>
            {
                resolve();
            });

            writeStream.on("error", (err: Error) =>
            {
                reject(err);
            });

            writeStream.end();
        });
    }

    public init(): void
    {
        if (fs.existsSync(this.FILES_INFO_FILE_PATH))
        {
            const fileContent = fs.readFileSync(this.FILES_INFO_FILE_PATH, 'utf-8');
            if (fileContent)
            {
                const filesFromJson = JSON.parse(fileContent) as FileInfo[];

                for (const fileInfo of filesFromJson)
                {
                    this.files.set(fileInfo.id, fileInfo);
                }

                if (this.files.size > 0)
                {
                    console.log(`[PlainFileRepository] Info about ${this.files.size} files has been loaded from the 'files.json' file.`);
                }
            }
        }
    }

    public async create(newFileInfo: NewFileInfo): Promise<string>
    {
        // Генерируем уникальный Id для файла.
        // Этот Id и является названием файла в папке на сервере.
        let id: string = nanoid(32);
        while (this.files.has(id))
        {
            id = nanoid(32);
        }

        // Если названия у файла не было передано в метаданных
        // укажем в качестве названия Id файла.
        if (newFileInfo.name.length == 0)
        {
            newFileInfo.name = id;
        }

        const info: FileInfo = { id, ...newFileInfo };

        this.files.set(id, info);

        await this.rewriteFilesInfoToFile();

        console.log(`[PlainFileRepository] FileInfo [${id}, '${info.name}', ${info.size}] in Room [${info.roomId}] by User [${info.ownerId}] was created.`);

        return id;
    }

    public async update(info: FileInfo): Promise<void>
    {
        this.files.set(info.id, info);

        await this.rewriteFilesInfoToFile();

        console.log(`[PlainFileRepository] FileInfo [${info.id}, '${info.name}', ${info.size}] in Room [${info.roomId}] was updated.`);
    }

    public async remove(id: string): Promise<void>
    {
        const info = this.files.get(id);

        if (!info)
        {
            console.error(`[ERROR] [PlainFileRepository] Can't delete FileInfo [${id}], because it's not exist.`);
            return;
        }

        this.files.delete(id);
        await this.rewriteFilesInfoToFile();

        console.log(`[PlainFileRepository] FileInfo [${id}, '${info.name}', ${info.size}] in Room [${info.roomId}] was deleted.`);
    }

    public get(id: string): FileInfo | undefined
    {
        return this.files.get(id);
    }

    public has(id: string): boolean
    {
        return this.files.has(id);
    }
}