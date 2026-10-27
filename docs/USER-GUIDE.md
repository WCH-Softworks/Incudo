# Using Incudo

Incudo is a free character builder for tabletop games. This page explains how to install it, add content, build a
character, and get the character out as a file, a text sheet, a PDF or a print. It covers the desktop app for Windows.
The phone app comes after 1.0.

**Incudo ships no rulebook content.** It comes with a definition of how a D&D 5e character is built, but every race,
class, spell and item comes from a content source that you add yourself. Until you add one there is nothing to choose.

## Install

Download `Incudo_<version>_x64-setup.exe` from the [Releases page](https://github.com/WCH-Softworks/Incudo/releases)
and run it. It installs for your user only and does not ask for administrator rights.

**The installer is not signed.** Windows SmartScreen says the publisher is unknown. Choose **More info**, then **Run
anyway**. Signing costs more than a free project can justify for now. You can check the download against the source:
the release is built from the tagged commit by the repository's own release workflow.

## The first run

1. **Choose a game.** The launcher lists the game systems Incudo knows. For 1.0 that is D&D 5th Edition, plus any
   system you add yourself (see [Your own game system](#your-own-game-system)).
2. **Choose a library folder.** Incudo asks once where to keep your characters. A library is an ordinary folder: each
   character is one `.incu` file in it. You can copy, back up or delete those files yourself, and Incudo shows what is
   in the folder each time it opens. You can change the folder later in **Settings**. You can skip this question and
   build anyway; only saving needs a folder.
3. **Add a content source.** Open **Sources** (Ctrl+4). D&D 5e suggests the AuroraLegacy content indexes, a
   community-maintained collection. Choose **Add** beside it. The first download takes about half a minute, and the
   Build and Browse panes show its progress until it ends. After that the content is kept on your computer and
   loads in about a second, also offline.

You can also add a content source by its address, or drop an Aurora `.xml` file of your own on the Sources pane. A
source can be switched off without removing it, and **Choose parts** switches off parts of one, such as a book you do not
use.

## Build a character

Choose **New character** (Ctrl+N). Incudo asks the campaign's options first (feats, multiclassing and the like). You
can change them later.

**Build** (Ctrl+2) lists the decisions the character still needs, required ones first. There is no order to follow
and no Back button: every decision stays on screen, and a choice already made can be changed under **Choices already
made**. To take a level, use **Level up to …** at the top of the middle column. Spells have a tab of their own once the
character has any, and **Equipment & notes** holds starting equipment, the inventory, money, and what you write
about the character.

**Sheet** (Ctrl+3) shows the finished character: scores, saves, skills, attacks, features, spells, the inventory and your
notes. Its **Play** section tracks spent spell slots, uses of features, hit points and conditions during a game.

**Browse** (Ctrl+5) searches everything your content sources loaded, whether or not a character has it.

**Save to library** (Ctrl+S) writes the character to its file. A saved character opens even with every content
source switched off, or on another computer: the file carries what it uses. A character from an older version of a
source can be refreshed: **File > Review content updates…** shows the sheet it would make before anything changes.

## Bring characters from Aurora

**File > Import from Aurora…** reads an Aurora Builder `.dnd5e` save and adds it to the library as an Incudo
character. Add a content source first: the save records only which content it used, and the import looks each item up
in the content you have loaded. If something cannot be found, the import says what is missing. The Aurora file is not
changed.

## Get a character out

From the Sheet:

- **File > Export sheet as text…** (Ctrl+Shift+O) writes the sheet as plain text, which also reads as Markdown.
- **File > Print sheet…** (Ctrl+P) asks which parts to print, then opens Windows' print dialog. Choose **Microsoft
  Print to PDF** there to save the print as a PDF.
- **File > Export sheet as PDF…** writes the same pages to a PDF file without the print dialog.
- **File > Fill the official sheet…** fills your own copy of the official fillable 2014 character sheet. Incudo does
  not include that form: download it yourself and point Incudo at it.

From Build, **File > Save a copy…** (Ctrl+Shift+D) writes the character to any file you choose, outside the library.
The character on screen is unchanged.

## Your own game system

Incudo can build characters for games other than D&D. A game system is a single `.json` file that describes what a
character is made of. **New system…** on the launcher writes one for you to start from: a small starter, changes to the
5e system, or a copy of it. [How to write a system definition](./SYSTEM-GUIDE.md) explains the file step by step,
for someone who has not written JSON before.

## Where Incudo keeps things

- **Characters**: the library folder you chose, one `.incu` file each.
- **Your feature library**: `incudo-features.json` in the same folder, holding features you wrote once to give to many
  characters.
- **Content sources, settings and the draft** of the character on screen: Incudo's own app data, under your Windows user
  profile. Uninstalling Incudo leaves your library folder alone.

## When something goes wrong

Please [open an issue](https://github.com/WCH-Softworks/Incudo/issues/new/choose). The bug report asks for the version,
which is under **Help > About Incudo** (also at the foot of Settings), your Windows version, and the steps that lead
to the problem. Questions about content or game systems have a form of their own. Incudo cannot supply rulebook text,
so please do not paste any into an issue.

## Licences

Incudo's code is MIT licensed. Content you add is under its publisher's licence. The D&D 5e system definition uses
material from the System Reference Document 5.2.1 under CC-BY-4.0, and About shows that notice. See
[LICENSING.md](./LICENSING.md).
