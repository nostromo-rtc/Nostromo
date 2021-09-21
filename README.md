# Nostromo Server (Russian)

> Откройте директорию с программой в терминале и напишите:

Для установки всех пакетов (необходимые и для запуска, и для сборки проекта) -> `npm install`

Для установки пакетов необходимых ТОЛЬКО для запуска -> `npm install --production`

Для сборки проекта -> `npm run build`

Для запуска программы -> `npm start`

>Не забудьте положить файлы `SSL` в папку `config/ssl` and настроить под себя файл `server.conf`.

>Чтобы сгенерировать `самоподписный` SSL сертификат используйте команду (должен быть установлен `OpenSSL`):

    openssl req -newkey rsa:2048 -nodes -keyout private.key -new -x509 -days 365 -out public.crt


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

    sudo iptables -A PREROUTING -t nat -p tcp --dport 80 -j REDIRECT --to-port 5000
    sudo iptables -A PREROUTING -t nat -p tcp --dport 443 -j REDIRECT --to-port 5001

***

# Nostromo Server (English)

> Open this folder in terminal and write:

To install (for launch and build project) -> `npm install`

To install without dev deps (ONLY for launch) -> `npm install --production`

To build project -> `npm run build`

To start app -> `npm start`

>Don't forget place `SSL` files to `config/ssl` folder and configure `server.conf` file.

>To generate `self-signed` SSL certificate:

    openssl req -newkey rsa:2048 -nodes -keyout private.key -new -x509 -days 365 -out public.crt


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

    sudo iptables -A PREROUTING -t nat -p tcp --dport 80 -j REDIRECT --to-port 5000
    sudo iptables -A PREROUTING -t nat -p tcp --dport 443 -j REDIRECT --to-port 5001
