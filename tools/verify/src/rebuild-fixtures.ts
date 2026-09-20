/**
 * Regenerate the committed golden container under `tools/verify/fixtures/aelin/`.
 *
 *   npm run fixtures:rebuild
 *
 * That folder is a real `.incu` in its unpacked form, checked into git on purpose. It is
 * the regression guard on the container format itself: a change to what a save contains
 * shows up as a reviewable JSON diff rather than as a silently different file, which is
 * exactly the property ADR 0012 claims for the folder form. Run this when the change was
 * deliberate, and read the diff before committing it.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectCharacterContent, MapElementIndex, packCharacterContainer } from '@incudo/core';
import { parseAuroraElements } from '@incudo/aurora-import';

import { GOLDEN_DIR, fixtureCharacter } from './fixture-character.ts';
import { writeContainer } from './node-save.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

const xml = await readFile(join(FIXTURES, 'content.xml'), 'utf8');
const index = new MapElementIndex();
index.addAll(parseAuroraElements(xml, { sourceId: 'fixture', fileUrl: 'fixture/content.xml' }).elements);

const character = fixtureCharacter();
const files = packCharacterContainer(character, collectCharacterContent(character, index), {
  generator: 'incudo-fixtures',
});

await writeContainer(GOLDEN_DIR, files, 'folder');
process.stdout.write(`Rebuilt ${GOLDEN_DIR} (${files.size} entries)\n`);
