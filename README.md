# Nostromo Server (Russian)

For [english version](#nostromo-server-english).

## Запуск

### Если вы хотите запустить релизную версию

1. Скачайте релиз и распакуйте архив.
2. Откройте директорию с программой в терминале.
3. Запустите программу.

> Не забудьте, что перед запуском необходимо изменить [настройки](#настройки).

```
$ npm start
```

### Если вы хотите запустить dev версию

1. Склонируйте репозиторий (скачав архив с сайта или с помощью Git).
```
$ git clone https://gitlab.com/sgakerru/nostromo.git
```
2. Откройте директорию с программой в терминале.
3. Установите все `npm` пакеты (необходимые и для запуска, и для сборки проекта).

> Убедитесь, что вы установили **ВСЕ** [необходимые программы и зависимости](#требования) перед сборкой проекта.

> Если вы не хотите компилировать C++ компоненты, такие как `mediasoup`, можете попробовать скопировать папку `node_modules/mediasoup` из релизной версии, перед выполнением следующей команды.
```
$ npm install
```


4. Запустите программу.

> Не забудьте, что перед запуском необходимо изменить [настройки](#настройки).

```
$ npm start
```

Если вы внесли изменения в `.ts` файлы из папки `src` и хотите пересобрать проект, используйте команду:
```
npm run build
```

## Настройки

>Не забудьте положить файлы `SSL` в папку `config/ssl` and настроить под себя файл `server.conf`.

>Чтобы сгенерировать `самоподписный` SSL сертификат используйте команду (должен быть установлен `OpenSSL`):
```
openssl req -newkey rsa:2048 -nodes -keyout private.key -new -x509 -days 365 -out public.crt
```

## Требования

>`Node.js LTS` (тестировалось на v14.17.1).

Для того, чтобы [скомпилировать](https://mediasoup.org/documentation/v3/mediasoup/installation/) C/C++ компоненты библиотеки `mediasoup` должны быть установлены следующие программы (пакеты):

### Windows (тестировалось на Win10-v2004)
* python версии 2 (тестировалось на 2.7.18)
    *  python версии 3 имеет проблему с MSBuild и .sln (смотреть [эту проблему](https://bugs.chromium.org/p/gyp/issues/detail?id=556) для подробностей)
* Visual C++ Build Environment >= 2015
    * Visual Studio Build Tools, individual components:
        * MSVC v142 - VS 2019 C++ Build Tools for x64/x86 (latest version)
        * Windows 10 SDK (тестировалось на 10.0.19041.0)
    * Поместить путь до файла MSBuild.exe в параметр окружения PATH (например "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin")
    * Создайте новый параметр окружения GYP_MSVS_VERSION и укажите версию Visual Studio (например "2019" для Visual Studio 2019).

### Linux (тестировалось на Debian 10 Buster)
* python версии 2 или 3 (тестировалось на on 2.7.16)
* make
* gcc и g++ >= 4.9 или clang (с поддержкой C++11) (тестировалось на gcc 8.3.0-6)
* команды (symlinks) cc и c++ указывающие на соответствущие исполняемые файлы gcc/g++ или clang/clang++.

> В `Debian` и `Ubuntu` установите `build-essential` .deb пакет. Он включает в себя и make и gcc/g++.

* `Перебросьте порты` для Http и Https сервера на порты больше чем 1024.
    * Вы можете поменять `порт приложения` в файле `server.conf`.
    * Непривелигированные пользователи (не root) не могут открыть сокет на порте ниже чем 1024.

> Для примера на `Debian`:
```
sudo iptables -A PREROUTING -t nat -p tcp --dport 80 -j REDIRECT --to-port 5000
sudo iptables -A PREROUTING -t nat -p tcp --dport 443 -j REDIRECT --to-port 5001
```

## Трюки

### Windows

После компиляции `mediasoup`, исполняемый файл `mediasoup-worker.exe` при запуске создает процесс `conhost.exe` (каждый потребляет по 5 Мб) соответственно при создании четырёх `Mediasoup.Worker` создадутся и четыре `conhost.exe`. `conhost.exe` нужен для drag-n-drop в консоли и оформления (темы), но поскольку процесс `worker` фоновый, ему это ни к чему.
Поэтому есть трюк, как отключить `conhost.exe`. Для этого нужно изменить у `mediasoup-worker.exe` тип с консольного приложения на обычное.
> Это можно сделать с помощью утилиты `binedit.exe`, которая входит в состав `Visual C++ Build Environment`:
```bat
"path to editbin.exe" /SUBSYSTEM:WINDOWS "path to mediasoup-worker.exe"
```

> И пример:
```bat
"C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Tools\MSVC\14.29.30037\bin\Hostx64\x64\editbin.exe" /SUBSYSTEM:WINDOWS "C:\nostromo\node_modules\mediasoup\worker\out\Release\mediasoup-worker.exe"
```

***

# Nostromo Server (English)

## Launch

### If you want to launch release

1. Download release and extract archive.
2. Open directory with programm in terminal.
3. Launch the programm.

> Don't forget, that you have edit [settings](#settings) before launch.

```
$ npm start
```

### If you want to launch dev version

1. Clone repository (via downloading archive from site or via Git).
```
$ git clone https://gitlab.com/sgakerru/nostromo.git
```
2. Open directory with programm in terminal.
3. Install all `npm` packages (they are needed to launch and build project).

> Be sure, that you have installed **ALL** [necessary programms and dependencies](#requirements) before building project.

> If you don't want to build C++ components, like `mediasoup`, you can try copy folder `node_modules/mediasoup` from release, before installation other npm packages.
```
$ npm install
```

4. Launch the programm.

> Don't forget, that you have edit [settings](#settings) before launch.

```
$ npm start
```

If you have edited `.ts` files from `src` folder and want to rebuild project, try command:
```
npm run build
```

## Settings

>Don't forget place `SSL` files in `config/ssl` folder and configurate project settings `server.conf`.

>To generate `self-signed` SSL cert use command (you need to have `OpenSSL` for that):
```
openssl req -newkey rsa:2048 -nodes -keyout private.key -new -x509 -days 365 -out public.crt
```

## Requirements

>`Node.js LTS` (tested on v14.17.1).

In order to [build](https://mediasoup.org/documentation/v3/mediasoup/installation/) the `mediasoup` C/C++ components the following packages must be available on the target host:

### Windows (tested on Win10-v2004)
* python version 2 (tested on 2.7.18)
    *  python version 3 has problem with MSBuild and .sln (check [this issue](https://bugs.chromium.org/p/gyp/issues/detail?id=556) for details)
* Visual C++ Build Environment >= 2015
    * Visual Studio Build Tools, individual components:
        * MSVC v142 - VS 2019 C++ Build Tools for x64/x86 (latest version)
        * Windows 10 SDK (tested on 10.0.19041.0)
    * Append the path of MSBuild.exe folder to the Windows PATH environment variable (e.g. "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin")
    * Create a new Windows environment variable GYP_MSVS_VERSION with the version of Visual Studio as value (e.g. "2019" for Visual Studio 2019).

### Linux (tested on Debian 10 Buster)
* python version 2 or 3 (tested on 2.7.16)
* make
* gcc and g++ >= 4.9 or clang (with C++11 support) (tested on gcc 8.3.0-6)
* cc and c++ commands (symlinks) pointing to the corresponding gcc/g++ or clang/clang++ executables.

> In `Debian` and `Ubuntu` install the `build-essential` .deb package. It includes both make and gcc/g++.

* `Forward ports` for Http and Https servers to ports > 1024.
    * You can change `port of application` in `server.conf` file.
    * Non-privileged user (not root) can't open a listening socket on ports below 1024.

> On `Debian` for example:
```
sudo iptables -A PREROUTING -t nat -p tcp --dport 80 -j REDIRECT --to-port 5000
sudo iptables -A PREROUTING -t nat -p tcp --dport 443 -j REDIRECT --to-port 5001
```

## Tricks

### Windows

After compilation of `mediasoup`, binary file `mediasoup-worker.exe` with launch creates `conhost.exe` (each consumes 5 Mb), so with creating four `Mediasoup.Worker` will be created four `conhost.exe`. `conhost.exe` is needed to drag-n-drop in console and for console themes, but `worker` is background process, so it is not necessary.
So there is a trick, how to disable `conhost.exe`. To do so, you need to edit type of `mediasoup-worker.exe` from console application to normal.
> You can do that with `binedit.exe`, that is included in `Visual C++ Build Environment`:
```bat
"path to editbin.exe" /SUBSYSTEM:WINDOWS "path to mediasoup-worker.exe"
```

> And example:
```bat
"C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Tools\MSVC\14.29.30037\bin\Hostx64\x64\editbin.exe" /SUBSYSTEM:WINDOWS "C:\nostromo\node_modules\mediasoup\worker\out\Release\mediasoup-worker.exe"
```