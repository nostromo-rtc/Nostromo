import path = require('path');
import fs = require('fs');
import http = require('http');
import https = require('https');
import dotenv = require('dotenv');
import os = require('os');

// Express
import { ExpressApp } from './ExpressApp';
import { FileHandler } from "./FileHandler";

// сокеты
import { SocketHandler } from './SocketHandler';

// mediasoup
import { Mediasoup } from './Mediasoup';

// комната
import { RoomId, Room } from './Room';
import { VideoCodec } from "nostromo-shared/types/RoomTypes";

// логи
import { prepareLogs } from "./Logger";

// для ввода в консоль
import readline = require('readline');

const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), 'config', 'server.default.conf');
const CUSTOM_CONFIG_PATH = path.resolve(process.cwd(), 'config', 'server.conf');

// загрузка значений из конфигурационного файла
function prepareConfig(): boolean
{
    let config_path = CUSTOM_CONFIG_PATH;

    if (!fs.existsSync(config_path) && fs.existsSync(DEFAULT_CONFIG_PATH))
    {
        config_path = DEFAULT_CONFIG_PATH;
    }
    else if (!fs.existsSync(config_path) && !fs.existsSync(DEFAULT_CONFIG_PATH))
    {
        return false;
    }

    dotenv.config({ path: config_path });
    return true;
}

// инициализация приложения
function initApplication()
{
    // загрузка значений из конфигурационного файла
    // выполняем первым делом, так как в конфиге написано название файла для лога
    const configLoadSuccess = prepareConfig();

    // добавление временных меток в лог и сохранения лога в файл
    prepareLogs();

    // считываем название и версию программы
    // именно таким способом, чтобы не были нужны переменные окружения npm
    const packageJson: unknown = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
    const { name, version } = packageJson as { name: string; version: string; };

    // выводим шапку
    process.title = `${name}-${version}`;
    console.log(`Version: ${version}`);

    // если конфиг не удалось загрузить
    if (!configLoadSuccess)
        throw new Error(`Отсутствует конфигурационный файл: ${DEFAULT_CONFIG_PATH}`);

}

// инициализация тестовой комнаты
async function initTestRoom(
    mediasoup: Mediasoup,
    socketHandler: SocketHandler,
    rooms: Map<RoomId, Room>,
    fileHandler: FileHandler
): Promise<void>
{
    rooms.set('0',
        await Room.create(
            '0',
            process.env.DEV_TESTROOM_NAME ?? 'Тестовая',
            process.env.DEV_TESTROOM_PASS ?? 'testik1',
            VideoCodec.VP8,
            mediasoup,
            socketHandler,
            fileHandler
        )
    );

    /*for (let i = 0; i < 10000; ++i)
    {
        await Room.create(
            String(i),
            process.env.DEV_TESTROOM_NAME ?? 'Тестовая',
            process.env.DEV_TESTROOM_PASS ?? 'testik1',
            VideoCodec.VP8,
            mediasoup,
            socketHandler
        );
    }*/
}

// главная функция
async function main()
{
    try
    {
        // инициализируем приложение
        initApplication();

        // создание класса-обработчика mediasoup
        //const numWorkers = os.cpus().length;
        const numWorkers = 1;
        const mediasoup = await Mediasoup.create(numWorkers);

        // комнаты
        const rooms = new Map<RoomId, Room>();

        const fileHandler = new FileHandler();

        const Express = new ExpressApp(rooms, fileHandler);

        const httpServer: http.Server = http.createServer(Express.app);
        const httpPort = process.env.HTTP_PORT;

        httpServer.listen(httpPort, () =>
        {
            console.log(`Http server running on port: ${httpPort!}`);
        });

        // настройки https-сервера (сертификаты)
        const httpsOptions: https.ServerOptions = {
            key: fs.readFileSync(path.resolve(process.cwd(), 'config', 'ssl', process.env.SSL_PRIVATE_KEY!), 'utf8'),
            cert: fs.readFileSync(path.resolve(process.cwd(), 'config', 'ssl', process.env.SSL_PUBLIC_CERT!), 'utf8')
        };

        const server: https.Server = https.createServer(httpsOptions, Express.app);
        const port = process.env.HTTPS_PORT;

        server.listen(port, () =>
        {
            console.log(`Https server running on port: ${port!}`);
        });

        const socketHandlerInstance = new SocketHandler(
            server,
            Express.sessionMiddleware,
            mediasoup,
            fileHandler,
            rooms, 0
        );

        // создаем тестовую комнату
        await initTestRoom(mediasoup, socketHandlerInstance, rooms, fileHandler);
    }
    catch (err)
    {
        console.error(`[ОШИБКА] ${(err as Error).message}`);
    }

    // для ввода в консоль сервера
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.on('line', (input_str) =>
    {
        console.log(input_str);
    });
    rl.on('SIGINT', () =>
    {
        process.exit();
    });
}

// вызов главной функции
main().catch((reason) => console.error(reason));