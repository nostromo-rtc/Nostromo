# Nostromo Server (Russian)

For [english version click here](#nostromo-server-english).

# Запуск

## Если вы хотите запустить релизную версию (из бинарников)

> Убедитесь, что вы установили **ВСЕ** [необходимые программы и зависимости](#требования-для-запуска-программы), необходимые для запуска программы.

1. Скачайте релиз и распакуйте архив.
2. Откройте директорию с программой в терминале.

> Не забудьте, что перед запуском необходимо изменить [настройки](#настройки).

3. Запустите программу.

```
$ npm start
```

## Если вы хотите запустить dev версию (из исходников)

В данном случае вам придется **собрать** проект.

**Сборка** состоит из двух этапов:
1. Сборка `C/C++` компонентов.
2. Сборка `npm` компонентов.

Чтобы **собрать** проект, следуйте инструкции:
1. Склонируйте репозиторий (скачав архив с сайта или с помощью Git).
```
$ git clone https://gitlab.com/sgakerru/nostromo.git
```
2. Откройте директорию с программой в терминале.

> Убедитесь, что вы установили **ВСЕ** [необходимые программы и зависимости](#требования-для-сборки-проекта), необходимые для сборки проекта.

> Если вы не хотите компилировать `C++` компоненты, такие как `mediasoup`, то есть пропустить первый этап, то вы можете попробовать скопировать папку `node_modules/mediasoup` из релизной версии, перед выполнением следующей команды.

> Для того, чтобы компонент `mediasoup` пропустил этап компиляции, можно установить параметр окружения `MEDIASOUP_WORKER_BIN`, и указать в качестве значения этой переменной путь до скомпилированного бинарного файла `mediasoup-worker.exe`
(Например: "C:\nostromo\node_modules\mediasoup\worker\out\Release\mediasoup-worker.exe"). Для Linux данный параметр работает аналогичным образом.

3. Теперь, когда все требования были удовлетворены, установите все `npm` пакеты (необходимые и для запуска, и для сборки проекта).
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

# Настройки

> Подготовьте файл "`server.conf`".

Изначально в папке `"config/"` лежит файл `"server.default.conf"` - **конфигурация по умолчанию**.

Чтобы изменить настройки, скопируйте файл с конфигурацией по умолчанию, переименуйте в `"server.conf"` и внесите необходимые изменения.

Программа будет искать настройки в файле `"server.conf"`, а в случае, если этого файла не существует - в файле `"server.default.conf"`.

Если отсутствуют и `"server.conf"` и `"server.default.conf"`, то программа сообщит о соответствующей ошибке.

>Не забудьте положить файлы `SSL` в папку `"config/ssl"`.

>Чтобы сгенерировать `самоподписный` SSL сертификат используйте команду (должен быть установлен `OpenSSL`):
```
openssl req -newkey rsa:2048 -nodes -keyout private.key -new -x509 -days 365 -out public.crt
```

# Требования

## Требования для запуска программы
Данное требование обязательно, поскольку необходимо для запуска:
>`Node.js LTS` (тестировалось на v16.13.2).

## Требования для сборки проекта
Если вы решили собрать проект из исходников, должна быть установлена программа (пакет):
>`Git` (тестировалось на версии 2.35.1).

## Требования для компиляции C/C++ компонентов
Для того, чтобы [скомпилировать](https://mediasoup.org/documentation/v3/mediasoup/installation/) C/C++ компоненты библиотеки `mediasoup` должны быть установлены следующие программы (пакеты):

### Windows (тестировалось на Win10-v21H2)
* python версии >= 3.6 с PIP (тестировалось на 3.10.2)
    * Необходимо в настройках системы `Управление псевдонимами выполнения приложения` отключить все галки, связанные с Python.
* Visual C++ Build Environment with C++11 support (тестировалось на VS Build Tools 2019 - 16.11.9)
    * Пакет - `разработка классических приложений на C++`.
* make
    * GNU make необходимо установить из MSYS из пакета [MinGW](https://sourceforge.net/projects/mingw/). Убедитесь, что путь до папки с бинарным файлом `make` прописан в параметре окружения `PATH` (например C:\MinGW\msys\1.0\bin).

### Linux (тестировалось на Debian 11 Bullseye)
* python версии >= 3.6 с PIP (тестировалось на 3.10.2)
* make
* gcc и g++ >= 4.9 или clang (с поддержкой C++11) (тестировалось на gcc 8.3.0-6)
* команды (symlinks) cc и c++ указывающие на соответствущие исполняемые файлы gcc/g++ или clang/clang++.

> В `Debian` и `Ubuntu` установите `build-essential` .deb пакет. Он включает в себя и make и gcc/g++.
> В `Debian` и `Ubuntu` установите `python3-pip` .deb пакет, иначе пакетный менеджер PIP может быть недоступен.

* `Перебросьте порты` для Http и Https сервера на порты больше чем 1024.
    * Вы можете поменять `порт приложения` в файле `server.conf`.
    * Непривелигированные пользователи (не root) не могут открыть сокет на порте ниже чем 1024.

> Для примера на `Debian`:
```
sudo iptables -A PREROUTING -t nat -p tcp --dport 80 -j REDIRECT --to-port 5000
sudo iptables -A PREROUTING -t nat -p tcp --dport 443 -j REDIRECT --to-port 5001
```

# Трюки

## Windows

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

# Launch

## If you want to launch release (from binaries)

> Be sure, that you have installed **ALL** [necessary programs and dependencies](#requirements-for-launching-program) before launching program.

1. Download release and extract archive.
2. Open directory with program in terminal.

> Don't forget, that you have edit [settings](#settings) before launch.

3. Launch the program.

```
$ npm start
```

## If you want to launch dev version (from sources)

In that case you have to build a project.

Build consists in two steps:
1. Build `C/C++` components.
2. Build `npm` components.

To build a project, lead this guide:

1. Clone repository (via downloading archive from site or via Git).
```
$ git clone https://gitlab.com/sgakerru/nostromo.git
```
2. Open directory with program in terminal.

> Be sure, that you have installed **ALL** [necessary programs and dependencies](#requirements-for-building-project) to build a project.

> If you don't want to build `C++` components, like `mediasoup`, that is, skip the first step, so you can try copy folder `node_modules/mediasoup` from release, before installation other npm packages.

> Component `mediasoup` will avoid build stage, if you set `MEDIASOUP_WORKER_BIN` environment variable with path to compiled binary file `mediasoup-worker.exe`
(For example: "C:\nostromo\node_modules\mediasoup\worker\out\Release\mediasoup-worker.exe"). For Linux that env variable works too.

3. Now, when all requirements were met, install all `npm` packages (they are needed to launch and build project).

```
$ npm install
```

4. Launch the program.

> Don't forget, that you have edit [settings](#settings) before launch.

```
$ npm start
```

If you have edited `.ts` files from `src` folder and want to rebuild project, try command:
```
npm run build
```

# Settings

> Configurate "`server.conf`" file.

Initially `"config/"` folder has a `"server.default.conf"` file - **default configuration**.

In order to change settings, you should copy a file with default configuration, rename a file in `"server.conf"` and make the necessary changes.

Application will search settings in a `"server.conf"` file, but in case that file is not exist - in a `"server.default.conf"` file.

Application will inform about error, if `"server.conf"` or `"server.default.conf"` files are not exist.

>Don't forget place `SSL` files in `"config/ssl"` folder.

>To generate `self-signed` SSL cert use command (you need to have `OpenSSL` for that):
```
openssl req -newkey rsa:2048 -nodes -keyout private.key -new -x509 -days 365 -out public.crt
```

# Requirements

## Requirements for launching program
This requirement is mandatory, since it is necessary for launching program:
>`Node.js LTS` (tested on v16.13.2).

## Requirements for building project
If you decided to build project from sources, you have to install program (package):
>`Git` (tested on v2.35.1).

## Requirements for building C/C++ components
In order to [build](https://mediasoup.org/documentation/v3/mediasoup/installation/) the `mediasoup` C/C++ components the following packages must be available on the target host:

### Windows (tested on Win10-v21H2)
* python version >= 3.6 with PIP (tested on 3.10.2)
    * If you have Python-related errors, search for “App execution aliases” in system settings and disable everything Python-related from there.
* Visual C++ Build Environment with C++11 support (tested on VS Build Tools 2019 - 16.11.9)
    * Package - `C++ Build Tools`.
* make
    * GNU make have to be installed with MSYS from [MinGW](https://sourceforge.net/projects/mingw/) and make sure to append the path of folder containing make to the Windows Path environment variable (e.g. C:\MinGW\msys\1.0\bin).

### Linux (tested on Debian 11 Bullseye)
* python version >= 3.6 with PIP (tested on 3.10.2)
* make
* gcc and g++ >= 4.9 or clang (with C++11 support) (tested on gcc 8.3.0-6)
* cc and c++ commands (symlinks) pointing to the corresponding gcc/g++ or clang/clang++ executables.

> On `Debian` and `Ubuntu` install the `build-essential` .deb package. It includes both make and gcc/g++.

> On `Debian` and `Ubuntu` install the `python3-pip` DEB package, otherwise PIP package manager might be unavailable.

* `Forward ports` for Http and Https servers to ports > 1024.
    * You can change `port of application` in `server.conf` file.
    * Non-privileged user (not root) can't open a listening socket on ports below 1024.

> On `Debian` for example:
```
sudo iptables -A PREROUTING -t nat -p tcp --dport 80 -j REDIRECT --to-port 5000
sudo iptables -A PREROUTING -t nat -p tcp --dport 443 -j REDIRECT --to-port 5001
```

# Tricks

## Windows

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