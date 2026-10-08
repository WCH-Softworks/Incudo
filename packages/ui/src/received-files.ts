/**
 * Files handed to the app from outside it — ADR 0099.
 *
 * A phone receives a file three ways: the user picks one ("Add a character file…"), another app shares one to it, or a
 * file manager opens one with it. All three come here, so they answer alike. What a file is decides by its contents, not
 * its name: a sender may give no name, or one without the extension (a mail provider's attachment id).
 *
 * A character is added to the library unchanged (`CharacterLibrary.add`, ADR 0083), under a free name, never over a file
 * already there. An Aurora save is recognised and not imported here: importing needs content loaded, so it is offered
 * for import and imported only on a tap (`received-saves.ts`, ADR 0101). Anything else is refused with a sentence and
 * nothing is written.
 */

import { readCharacterContainer, type ContainerFiles, type LibraryEntryRef, type ZipCodec } from '@incudo/core';

import { suggestedFileName, type CharacterLibrary } from './character-library.ts';

/**
 * One file as the platform hands it over. `name` is what the sender called it, when it said; `unreadable` is why the
 * platform could not read its bytes (a grant withdrawn, a provider gone), and then `bytes` is empty.
 */
export interface ReceivedFile {
  name?: string;
  bytes: Uint8Array;
  unreadable?: string;
}

/** What became of one received file. `title` is the character's name when one was added. */
export type ReceivedOutcome =
  | { status: 'added'; entry: LibraryEntryRef; title: string; message: string }
  | { status: 'aurora-save'; file: ReceivedFile; message: string }
  | { status: 'refused'; message: string };

/**
 * What the shell shows: a title, a line per file, the one character to open when exactly one was added, and the Aurora
 * saves to offer for import, with the button's words (ADR 0101).
 */
export interface ReceivedView {
  title: string;
  lines: string[];
  open?: { name: string; title: string };
  saves?: { files: ReceivedFile[]; label: string };
}

type Library = Pick<CharacterLibrary, 'add' | 'getState' | 'restore'>;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function isZip(bytes: Uint8Array): boolean {
  return ZIP_MAGIC.every((byte, i) => bytes[i] === byte);
}

/**
 * Is this an Aurora save? An XML document whose root element is `character`, read from its first bytes only.
 *
 * Aurora writes UTF-8 with a byte order mark (all thirty samples); a UTF-16 one is read too by dropping its zero bytes,
 * since a phone's JavaScript engine has no UTF-16 decoder (ADR 0083) and only the ASCII of the root's name matters.
 */
export function isAuroraSave(bytes: Uint8Array): boolean {
  let head = '';
  for (const byte of bytes.subarray(0, 2048)) if (byte !== 0 && byte < 0x80) head += String.fromCharCode(byte);
  // Skip the declaration, comments and processing instructions; what follows is the root element.
  const rest = head.replace(/^\s*(?:<\?[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*/i, '');
  return /^<character[\s>/]/.test(rest);
}

/**
 * The name the sender gave, for a sentence: at its start, or inside it. A name with no extension is not the file's name
 * as the user knows it but a provider's id for it ("msf:44" from Android's Recent files, "1000034" from a mail), so it
 * is not quoted.
 */
export function shown(file: { name?: string }, inside = false): string {
  const name = file.name?.trim();
  return name && /\.[^.\s]+$/.test(name) ? `"${name}"` : inside ? 'the file' : 'The file';
}

/**
 * Add what was received to the library, one file at a time, and say what became of each.
 *
 * The library is read in full first when it is not yet: a share can start the app, and a free name chosen before the
 * first scan has finished would be chosen against an empty folder.
 */
export async function receiveFiles(library: Library, zip: Pick<ZipCodec, 'unzip'>, files: readonly ReceivedFile[]): Promise<ReceivedOutcome[]> {
  if (files.length && library.getState().status !== 'ready') await library.restore();
  const outcomes: ReceivedOutcome[] = [];
  for (const file of files) outcomes.push(await receiveOne(library, zip, file));
  return outcomes;
}

async function receiveOne(library: Library, zip: Pick<ZipCodec, 'unzip'>, file: ReceivedFile): Promise<ReceivedOutcome> {
  if (file.unreadable !== undefined) return { status: 'refused', message: `Could not read ${shown(file, true)}: ${file.unreadable}` };
  if (!isZip(file.bytes)) {
    if (isAuroraSave(file.bytes)) {
      return { status: 'aurora-save', file, message: `${shown(file)} is an Aurora save.` };
    }
    return { status: 'refused', message: `${shown(file)} is not an Incudo character file (.incu).` };
  }

  let files: ContainerFiles;
  try {
    files = await zip.unzip(file.bytes);
  } catch {
    return { status: 'refused', message: `${shown(file)} is not an Incudo character file (.incu): it could not be unpacked.` };
  }
  const { container } = readCharacterContainer(files);
  if (!container) return { status: 'refused', message: `${shown(file)} is not an Incudo character file (.incu).` };

  const title = container.character.name.trim() || 'Unnamed character';
  // The sender's name when it is a .incu file's; otherwise the character's, as a save is named.
  const fileName = file.name && /\.incu$/i.test(file.name.trim()) ? file.name.trim() : suggestedFileName(title);
  let added: Awaited<ReturnType<Library['add']>>;
  try {
    added = await library.add(files, fileName);
  } catch (error) {
    return { status: 'refused', message: `Could not add ${shown(file, true)}: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!added.ok) return { status: 'refused', message: added.message };

  // `add` slugs the name and makes it free; the slug of the name it was given is what it wrote when nothing was taken.
  const wanted = suggestedFileName(fileName.replace(/\.incu$/i, ''));
  const message =
    added.entry.name === wanted
      ? `Added ${title}.`
      : `Added ${title} as ${added.entry.name}; the library already had a file called ${wanted}.`;
  return { status: 'added', entry: added.entry, title, message };
}

/** The outcome as the shell shows it. */
export function receivedView(outcomes: readonly ReceivedOutcome[]): ReceivedView {
  const added = outcomes.filter((outcome) => outcome.status === 'added');
  const saves = outcomes.flatMap((outcome) => (outcome.status === 'aurora-save' ? [outcome.file] : []));
  const title =
    added.length === outcomes.length
      ? 'Added to your characters'
      : saves.length === outcomes.length
        ? saves.length === 1
          ? 'An Aurora save'
          : 'Aurora saves'
        : added.length
          ? 'Some files were not added'
          : 'Not added';
  const view: ReceivedView = { title, lines: outcomes.map((outcome) => outcome.message) };
  if (added.length === 1 && added[0]!.status === 'added') view.open = { name: added[0]!.entry.name, title: added[0]!.title };
  if (saves.length) view.saves = { files: saves, label: saves.length === 1 ? 'Import' : `Import ${saves.length} saves` };
  return view;
}
