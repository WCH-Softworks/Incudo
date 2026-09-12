/**
 * Reading and writing a container on a real filesystem, in both of its forms.
 *
 * ADR 0012: *"Both representations, one layout. The app can also read and write the same
 * tree unpacked as a folder, for people who want their characters in git or edited by
 * hand."* The tree itself is built in `@incudo/core` (container.ts), so this file is only
 * ever choosing between "one zip" and "a directory of the same names" — which is what keeps
 * the two forms from drifting.
 *
 * The form is decided by what is on disk, not by a flag: a directory is the folder form,
 * anything else is a zip. Writing follows the extension, defaulting to a zip, because one
 * file is what people email.
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import type { ContainerFiles, ContainerForm } from '@incudo/core';
import { nodeZipCodec } from './node-zip.ts';

export type { ContainerForm };

/** Where a path would be written, given only its name. */
export function formOf(path: string): ContainerForm {
  return /\.(incu|incuset|zip)$/i.test(path) ? 'zip' : 'folder';
}

export async function readContainer(path: string): Promise<ContainerFiles> {
  const info = await stat(path);
  if (info.isDirectory()) return readFolder(path);
  return nodeZipCodec.unzip(new Uint8Array(await readFile(path)));
}

export async function writeContainer(
  path: string,
  files: ContainerFiles,
  form: ContainerForm = formOf(path),
): Promise<void> {
  if (form === 'zip') {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, await nodeZipCodec.zip(files));
    return;
  }
  await writeFolder(path, files);
}

async function readFolder(root: string): Promise<ContainerFiles> {
  const files: ContainerFiles = new Map();
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath ?? root, entry.name);
    // Container paths are always forward-slashed, whatever the platform separator is.
    const path = relative(root, absolute).split(sep).join('/');
    files.set(path, new Uint8Array(await readFile(absolute)));
  }
  return files;
}

/**
 * Write the tree, then remove files that used to be in it.
 *
 * The removal matters: a portrait the user deleted has to actually leave the folder, or the
 * next `writeContainer` picks it back up and the folder form stops matching the zip form.
 * Only files the container format owns are considered, so a README someone put beside their
 * character survives.
 */
async function writeFolder(root: string, files: ContainerFiles): Promise<void> {
  await mkdir(root, { recursive: true });

  for (const [path, bytes] of files) {
    const target = join(root, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  let existing: ContainerFiles;
  try {
    existing = await readFolder(root);
  } catch {
    return;
  }
  for (const path of existing.keys()) {
    if (files.has(path)) continue;
    if (path !== 'manifest.json' && path !== 'character.json' && path !== 'content.json') {
      if (!path.startsWith('assets/')) continue;
    }
    await rm(join(root, ...path.split('/')), { force: true });
  }
}
