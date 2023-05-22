import path = require("path");
import fs = require("fs");

import { ChatMessage } from "nostromo-shared/types/RoomTypes";
import { readFromFile, removeFile, writeToFile } from "../Utils";

/** Authorized Room Users. */
export interface IRoomChatRepository
{
    /** Добавить сообщение в историю чата для roomId. */
    addMessage(roomId: string, msg: ChatMessage): Promise<void>;

    /** Удалить историю чата для roomId. */
    removeAll(roomId: string): Promise<void>;

    /** Получить список сообщений в чате комнаты roomId. */
    getAll(roomId: string): Promise<ChatMessage[] | undefined>;

    /** Есть ли история чата для комнаты roomId? */
    has(roomId: string): boolean;
}

export class PlainRoomChatRepository implements IRoomChatRepository
{
    private readonly className = "PlainRoomChatRepository";

    private readonly CHATS_FOLDER_PATH = path.resolve("data", "chats");

    private getPathForRoomChatFile(roomId: string)
    {
        return path.resolve(this.CHATS_FOLDER_PATH, `${roomId}.json`);
    }

    public async addMessage(roomId: string, msg: ChatMessage): Promise<void>
    {
        try
        {
            const filepath = this.getPathForRoomChatFile(roomId);
            const fileContent = await readFromFile(filepath);

            let msgArr = [msg];

            if (fileContent)
            {
                msgArr = JSON.parse(fileContent) as ChatMessage[];
                msgArr.push(msg);
            }

            // Проверяем, существует ли папка для чатов.
            if (!fs.existsSync(this.CHATS_FOLDER_PATH))
            {
                fs.mkdirSync(this.CHATS_FOLDER_PATH);
            }

            await writeToFile(filepath, msgArr);
        }
        catch (error)
        {
            console.error(`[ERROR] [${this.className}] Can't write data to file.`);
        }
    }

    public async removeAll(roomId: string): Promise<void>
    {
        const filepath = this.getPathForRoomChatFile(roomId);

        try
        {
            await removeFile(filepath);
            console.log(`[${this.className}] Chat history of room [${roomId}] was removed.`);
        }
        catch (error)
        {
            console.error(`[ERROR] [${this.className}] Can't delete File with chat history of Room [${roomId}}] on server.`);
        }
    }

    public async getAll(roomId: string): Promise<ChatMessage[] | undefined>
    {
        const filepath = this.getPathForRoomChatFile(roomId);
        const fileContent = await readFromFile(filepath);
        if (fileContent)
        {
            const msgArr = JSON.parse(fileContent) as ChatMessage[];
            return msgArr;
        }
        return undefined;
    }

    public has(roomId: string): boolean
    {
        const filepath = this.getPathForRoomChatFile(roomId);
        return fs.existsSync(filepath);
    }
}