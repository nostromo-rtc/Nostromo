# Nostromo (English)

# Description

## Short description

**Nostromo** - platform for video conferencing, built on `WebRTC`. Absolutely free, standalone, open-source, without any artificial limits or restrictions.

**Nostromo** consists of several components:
Repository                                   | Description
-------------                                | -------------
[Nostromo Server](/SgAkErRu/nostromo)        | Nostromo Server (backend), built on `Node.js`
[Nostromo Web](/SgAkErRu/nostromo-web)       | Nostromo Web-Client (frontend), written on pure `HTML` and `TypeScript`
[Nostromo Shared](/SgAkErRu/nostromo-shared) | Component with shared types and structures for backend and frontend

## Features

- ♾️ Absolutely **free** without any limits or restrictions (for example, by time or number of participants).

- 🏢 Completely **standalone** - can work both in a private network without the Internet, and in a public network via the Internet.

- 🛡️ Security is ensured through the use of technologies that support data encryption: `DTLS-SRTP` for media streams and `HTTPS` for any text and file data.

- 🤨 **The maximum number of participants** depends on the technical capabilites of the server (check [perfomanse](#perfomance)).

- 🖥️ **Connect** using your smartphone or computer via a browser. In the near future - a desktop client for a computer. In the long-term plans - an Android application.

- 🕵️ **Guest support** - you do not need to register an account. You can just click on the link and you can already participate in the conference.

- 🔒 Rooms (conferences) can be protected with **password**. You can join the room by entering the password manually, but you can join by using a special link with the hash password included.

- 🎙️ You can capture **the microphone**, **webcam** or **computer/window screen** (if it's Chrome, you can also capture a tab in the browser and, if desired, you can capture the sound of the computer or tab). Please note that you can select **the resolution or frame rate** of the video stream when capturing a webcam or screen (from 240p to 1440p).

- 📋 During the conference, you can write in **chat**, as well as send **files** (you can send several files at a time).

- 📎 File uploading is implemented based on the `TUS` protocol, so it **resumes** when the upload is interrupted, moreover, you can stop the upload, and then **continue it from the same place** even after a few hours.

- 🔨 **Admin functions** - you can create, edit and delete rooms. Also you can disable video or audio coming from a conference participant, change the user name, kick the user from the room, block the user by IP address.

- ⏸️ The captured microphone can be **paused and unpaused** without recapturing the microphone.

- 🔊 **Sound notifications** when participants enter or exit, when video stream are captured, when the sounds of the participants are turned on or off, as well as when the microphone is paused/unpaused. You can also disable these notifications.

- 🎚️ You can adjust the level of **the sound volume** of the participants, as well as pause and unpause the media streams of another user (for example to save resources).

- 📷 Picture-in-picture support for videos coming from users.


## Perfomance

We have tested on **40** users for serveral hours and in general everything went well. **All** had their microphones captured, and **15** of them also showed screens of computer or captured webcams.

All this was on an 10-year-old server and with a network bandwith (Internet) of about 15 **MBit/s**.

Try it yourself and share your results in any way you like (via Issues or email).

# Setup, settings, requirements

Setup, settings and requirements can be found [here](/docs/SETUP-EN.md).

# Demo screenshot
![Nostromo demo screenshot](nostromo-demo-screenshot.png)
