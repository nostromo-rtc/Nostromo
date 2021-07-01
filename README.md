# WebRTC Server

Open this folder in terminal and write:

To install -> `npm install`

To build from .ts to .js -> `npm run build`

To start app -> `npm start`

# Requirements

>`Node.js LTS` (tested on v14.17.1)

In order to [build](https://mediasoup.org/documentation/v3/mediasoup/installation/) the `mediasoup` C/C++ components the following packages must be available on the target host:

## Windows (tested on Win10-v2004)
* python version 2 (tested on 2.7.18)
    *  python version 3 has problem with MSBuild and .sln (check [this issue](https://bugs.chromium.org/p/gyp/issues/detail?id=556) for details)
* Visual C++ Build Environment >= 2015
    * Visual Studio Build Tools, individual components:
        * MSVC v142 - VS 2019 C++ Build Tools for x64/x86 (latest version)
        * Windows 10 SDK (tested on 10.0.19041.0)
    * Append the path of MSBuild.exe folder to the Windows PATH environment variable (e.g. "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin")
    * Create a new Windows environment variable GYP_MSVS_VERSION with the version of Visual Studio as value (e.g. "2019" for Visual Studio 2019).