# Incudo's privacy policy

Effective 2026-11-19. This covers the Incudo app for Android and for desktop computers. It describes what the app does,
read from its source code, which is public: <https://github.com/WCH-Softworks/Incudo>.

## The short version

Incudo collects nothing about you and sends nothing about you anywhere. It has no account, no analytics, no crash
reporting and no advertising. Your characters stay on your device.

## What the app requests over the network

Only the content sources you add. Incudo ships no game content: you add a source on the Content screen, and the app
downloads that source's files from the address it names. When you add the source Incudo suggests, AuroraLegacy, those
files come from GitHub (`raw.githubusercontent.com`). A download is an ordinary request for a file. It carries nothing
about you or your characters, though the server you download from sees your device's network address, as any server
does. Checking a source for updates, refreshing it and loading it again ask the same server for the same files.

Nothing else is requested. The app does not check whether you are online by contacting anyone: on Android it asks the
operating system whether the connection is metered, so that it can ask you before a large download.

## What the app keeps on your device

- Your characters, as `.incu` files in the app's own folder.
- Features you saved to your feature library, in a file beside them.
- The content sources you added, downloaded and converted, in the app's own folder.
- Your settings: which sources are added and switched on, and how you like the build screen laid out.

Uninstalling the app deletes all of it. Incudo has no copy anywhere else, so there is nothing for us to delete or hand
over.

## Backups

On Android, the system's backup may copy your characters, your feature library and your settings to your own Google
account, as it does for other apps, if you have backup switched on. Downloaded sources are left out (they can be
downloaded again). Incudo never sees that backup.

## What leaves your device

Only what you send: a character file you share through Android's share sheet or save to a folder you choose, and a
sheet you export or print on the desktop. Where it goes is your choice and the receiving app's business.

## Permissions (Android)

| Permission | Why |
|---|---|
| Internet | To download the content sources you add. |
| Network state, Wi-Fi state | To tell whether the connection is metered, so the app asks before a large download. |

The app asks for no access to your storage, contacts, location, camera or microphone. Files come in and go out through
the system's own picker and share sheet, which you operate.

## Links

The About screen links to Incudo's source code and to the project's donation page. A link opens in your browser, and
nothing is sent until you follow it.

## Children

Incudo is a tool for building tabletop role-playing characters. It collects nothing from anyone, children included.

## Changes and contact

A change to this policy is a change to this file, and its history is public. Questions: open an issue at
<https://github.com/WCH-Softworks/Incudo/issues>.
