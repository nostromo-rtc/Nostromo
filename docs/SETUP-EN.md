# Setup

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
>`Node.js LTS` (tested on v12.22.11).

>`npm 8` (testen on 8.5.5).

### Windows (tested on Win10-v21H2)
> `Microsoft Visual C++ 2015-2022 Redist`.

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
* python version >= 3.6 with PIP (tested on 3.9.2-3)
* make
* gcc and g++ >= 4.9 or clang (with C++11 support) (tested on gcc 10.2.1-1)
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