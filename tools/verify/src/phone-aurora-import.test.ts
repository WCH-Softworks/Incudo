/**
 * What importing an Aurora save on the phone needs — measured before ADR 0101 was written, report-only; and the phone's
 * import, held to the desktop's.
 *
 * The phone loads content only when something asks (ADR 0086), and a source's parts can be switched off (ADR 0055).
 * Every sample is imported through `importAuroraSaveIntoLibrary`, the desktop's function, three ways: with the whole
 * corpus, with only its core part (every other part switched off, as a phone user saving space would), and with nothing
 * loaded. A save is also handed over as UTF-16 and with a name that says nothing, as Android's Recent files does. The
 * figures are printed as `ℹ` lines; nothing here names a character.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { MapElementIndex, sha256Hex, type CharacterStore, type GameSystem, type LibraryEntryRef } from '@incudo/core';
import { CharacterBuilder, CharacterLibrary, importAuroraSaveIntoLibrary, importReceivedSaves, sheetDocument, sheetMarkdown } from '@incudo/ui';

import { corpusSource, loadCorpus } from './corpus.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, requireCorpus } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

function memoryLibrary(): CharacterLibrary {
  const entries = new Map<string, Map<string, Uint8Array>>();
  const store: CharacterStore = {
    available: true,
    location: async () => 'library',
    choose: async () => 'library',
    list: async (): Promise<LibraryEntryRef[]> => [...entries.keys()].map((name) => ({ name, form: 'zip' as const })),
    read: async (entry) => new Map(entries.get(entry.name)),
    write: async (entry, files) => void entries.set(entry.name, new Map(files)),
    remove: async (entry) => void entries.delete(entry.name),
  };
  return new CharacterLibrary(store);
}

test('importing the samples with the whole corpus, its core part only, and nothing', { skip: corpusSkip }, async (t) => {
  const system = await loadShippedSystem('dnd5e');
  const location = requireCorpus();
  const whole = await realElements();
  const top = await corpusSource(location).loadIndex(location.index);
  const parts = top.files.filter((ref) => ref.isIndex).map((ref) => ref.url);
  const core = parts.find((url) => /\/core\.index$/i.test(url));
  assert.ok(core, 'the top index names a core part');
  const coreOnly = (await loadCorpus(location, { excluded: parts.filter((url) => url !== core) })).library.elements;
  t.diagnostic(corpusProvenance());

  const samples = readManifest().samples;
  for (const [label, elements] of [
    ['whole corpus', whole],
    ['core part only', coreOnly],
  ] as const) {
    const library = memoryLibrary();
    await library.restore();
    let ok = 0;
    let unresolvedSaves = 0;
    let unresolved = 0;
    let diagnosed = 0;
    const levels = new Map<string, number>();
    const times: number[] = [];
    for (const sample of samples) {
      const path = samplePath(sample);
      const started = performance.now();
      const report = await importAuroraSaveIntoLibrary(library, { name: basename(path), bytes: new Uint8Array(readFileSync(path)) }, { system, elements });
      times.push(performance.now() - started);
      if (report.ok) ok++;
      if (report.unresolved.length) unresolvedSaves++;
      unresolved += report.unresolved.length;
      if (report.diagnostics.length) diagnosed++;
      for (const d of report.diagnostics) levels.set(d.level, (levels.get(d.level) ?? 0) + d.count);
    }
    times.sort((a, b) => a - b);
    t.diagnostic(
      `${label}: ${ok} of ${samples.length} import; ${unresolvedSaves} with ids nothing loaded declares (${unresolved} in all); ` +
        `${diagnosed} with diagnostics (${[...levels].map(([level, n]) => `${n} ${level}`).join(', ') || 'none'}); ` +
        `median ${times[times.length >> 1]!.toFixed(0)} ms, slowest ${times[times.length - 1]!.toFixed(0)} ms in Node`,
    );
  }

  const first = samplePath(samples[0]!);
  const bytes = new Uint8Array(readFileSync(first));
  const library = memoryLibrary();
  await library.restore();

  const none = await importAuroraSaveIntoLibrary(library, { name: basename(first), bytes }, { system, elements: new MapElementIndex() });
  t.diagnostic(`nothing loaded: ok ${none.ok}: ${none.message}`);

  const nameless = await importAuroraSaveIntoLibrary(library, { name: 'msf:44', bytes }, { system, elements: whole });
  t.diagnostic(`a provider id for a name: ok ${nameless.ok}: ${nameless.message}`);

  // UTF-16LE with its byte order mark, from the UTF-8 text without its own.
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, '').replace('encoding="utf-8"', 'encoding="utf-16"');
  const utf16 = new Uint8Array(2 + text.length * 2);
  utf16[0] = 0xff;
  utf16[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    utf16[2 + i * 2] = text.charCodeAt(i) & 0xff;
    utf16[3 + i * 2] = text.charCodeAt(i) >> 8;
  }
  const wide = await importAuroraSaveIntoLibrary(library, { name: basename(first), bytes: utf16 }, { system, elements: whole });
  t.diagnostic(`UTF-16: ok ${wide.ok}: ${wide.message ?? ''} ${wide.diagnostics.map((d) => d.message).join(' | ')}`);
});

/** A library entry's sheet as the phone opens it (`openSheet` in `apps/mobile/src/App.tsx`), as text and its checksum. */
async function sheetOf(library: CharacterLibrary, system: GameSystem, name: string): Promise<{ length: number; sha256: string }> {
  const opened = await library.open(name);
  assert.ok(opened, `${name} opens`);
  const markdown = sheetMarkdown(sheetDocument(new CharacterBuilder(opened.character, system, opened.elements).getState()));
  return { length: markdown.length, sha256: sha256Hex(new TextEncoder().encode(markdown)) };
}

test("the phone's import of every sample, named by a provider id, opens to the desktop's sheet", { skip: corpusSkip }, async (t) => {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const desktop = memoryLibrary();
  const phone = memoryLibrary();
  await desktop.restore();
  await phone.restore();
  for (const [i, sample] of readManifest().samples.entries()) {
    const path = samplePath(sample);
    const bytes = new Uint8Array(readFileSync(path));
    const report = await importAuroraSaveIntoLibrary(desktop, { name: basename(path), bytes }, { system, elements });
    assert.ok(report.ok && report.entry, `${basename(path)} imports on the desktop`);
    // As Android's Recent files hands a picked file over: a provider id, no extension. The user said which game.
    const [outcome] = await importReceivedSaves({ library: phone, systems: [system], load: async () => elements }, [{ name: `msf:${i}`, bytes }], 'dnd5e');
    assert.equal(outcome!.status, 'imported', `${basename(path)} imports on the phone`);
    if (outcome!.status !== 'imported') continue;
    const expected = await sheetOf(desktop, system, report.entry.name);
    // Fails if the phone's import differs from the desktop's in anything the sheet shows.
    assert.deepEqual(await sheetOf(phone, system, outcome!.entry.name), expected, basename(path));
    if (i < 3) t.diagnostic(`${basename(path)}: sheet ${expected.length} characters, sha256 ${expected.sha256}`);
  }
});
