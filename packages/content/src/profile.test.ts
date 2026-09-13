import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, type Element, type SourceRef } from '@incudo/core';

import {
  SourceProfile,
  SOURCE_PROFILE_KEY,
  compareSourceRefs,
  recordSourceRefs,
  sourcesForSystem,
  unassignedSources,
} from './profile.ts';

const CORE = 'https://example.test/core.index';

test('a source is named after its index when the user does not name it', async () => {
  const profile = new SourceProfile(new MemoryStorage());
  assert.equal(profile.add(CORE).name, 'core');
  assert.equal(profile.add('https://example.test/homebrew/dragons.index').name, 'dragons');
  assert.equal(profile.add('https://example.test/pack.incuset').name, 'pack');
});

test('adding the same url twice updates it rather than duplicating it', async () => {
  const profile = new SourceProfile(new MemoryStorage());
  profile.add(CORE, { name: 'Core' });
  profile.add(CORE, { mode: 'download' });

  assert.equal(profile.sources.length, 1);
  assert.equal(profile.sources[0]!.mode, 'download');
  assert.equal(profile.sources[0]!.name, 'Core', 'and it keeps what it was not asked to change');
});

test('a profile round-trips through storage', async () => {
  const storage = new MemoryStorage();
  const profile = new SourceProfile(storage);
  profile.add(CORE, { name: 'Core', mode: 'download', version: '1.2.0' });
  profile.add('https://example.test/extra.index', { enabled: false });
  await profile.save();

  const back = await SourceProfile.load(storage);
  assert.equal(back.sources.length, 2);
  assert.equal(back.find(CORE)!.mode, 'download');
  assert.deepEqual(
    back.enabled.map((source) => source.id),
    [CORE],
  );
});

test('a profile that will not parse is replaced, not fatal', async () => {
  const storage = new MemoryStorage();
  await storage.write(SOURCE_PROFILE_KEY, '{ this was edited by hand');

  const profile = await SourceProfile.load(storage);
  assert.deepEqual(profile.sources, []);
});

test('removing a source removes it and reports whether it was there', async () => {
  const profile = new SourceProfile(new MemoryStorage());
  profile.add(CORE);
  assert.equal(profile.remove(CORE), true);
  assert.equal(profile.remove(CORE), false);
  assert.deepEqual(profile.sources, []);
});

// --- ADR 0028's three states ------------------------------------------------

function refs(...versions: Array<string | undefined>): SourceRef[] {
  return versions.map((version) => ({ id: CORE, name: 'Core', version }));
}

test('a character source the profile lacks is missing, and that is not an error', () => {
  const [status] = compareSourceRefs(refs('1.2.0'), []);
  assert.equal(status!.state, 'missing');
  assert.equal(status!.configured, undefined);
});

test('the same version is present and a different one has moved', () => {
  const profile = new SourceProfile(new MemoryStorage());
  const configured = profile.add(CORE, { version: '1.2.0' });

  assert.equal(compareSourceRefs(refs('1.2.0'), [configured])[0]!.state, 'present');
  assert.equal(compareSourceRefs(refs('1.3.0'), [configured])[0]!.state, 'moved');
  // Backwards counts too: the user rolled a source back and their character is ahead of it.
  assert.equal(compareSourceRefs(refs('1.1.0'), [configured])[0]!.state, 'moved');
});

/**
 * Plenty of homebrew indexes carry no version at all. Reporting every one of them as changed
 * would make the warning noise rather than news, which is the whole reason ADR 0028 has three
 * states and not two.
 */
test('an unknown version on either side reads as present, not as moved', () => {
  const profile = new SourceProfile(new MemoryStorage());
  const versioned = profile.add(CORE, { version: '1.2.0' });
  const unversioned = new SourceProfile(new MemoryStorage()).add(CORE);

  assert.equal(compareSourceRefs(refs(undefined), [versioned])[0]!.state, 'present');
  assert.equal(compareSourceRefs(refs('1.2.0'), [unversioned])[0]!.state, 'present');
});

test('a ref is matched on the url as well as on the id', () => {
  const profile = new SourceProfile(new MemoryStorage());
  const configured = profile.add(CORE, { version: '1.2.0' });
  configured.id = 'some-other-id';

  const [status] = compareSourceRefs([{ id: CORE, version: '1.2.0' }], [configured]);
  assert.equal(status!.state, 'present');
});

// --- recording what a character was built against ---------------------------

function element(id: string, sourceId: string): Element {
  return {
    id,
    name: id,
    type: 'Widget',
    source: 'Book',
    setters: {},
    rules: [],
    supports: [],
    origin: { sourceId, fileUrl: 'f.xml', format: 'aurora' },
  };
}

test('saving records the sources the embedded content actually came from', () => {
  const profile = new SourceProfile(new MemoryStorage());
  const core = profile.add(CORE, { version: '1.2.0', mode: 'download' });
  const unused = profile.add('https://example.test/unused.index', { version: '9.9.9' });

  const refs = recordSourceRefs([], [element('ID_A', CORE), element('ID_B', CORE)], [core, unused]);

  assert.deepEqual(refs, [{ id: CORE, name: 'core', version: '1.2.0', mode: 'download' }]);
});

/**
 * The alternative ADR 0028 rejected, as a test: re-stamping a recorded version with whatever
 * the profile says today makes the `moved` warning permanently impossible to fire.
 */
test('a version already recorded is never re-stamped from the profile', () => {
  const profile = new SourceProfile(new MemoryStorage());
  const core = profile.add(CORE, { version: '2.0.0' });

  const refs = recordSourceRefs([{ id: CORE, name: 'Core', version: '1.2.0' }], [element('ID_A', CORE)], [core]);

  assert.deepEqual(refs, [{ id: CORE, name: 'Core', version: '1.2.0' }]);
  assert.equal(compareSourceRefs(refs, [core])[0]!.state, 'moved');
});

test('a recorded source the profile no longer has survives a save', () => {
  // Saving a character in a profile that lost one of its sources must not quietly drop the
  // only record of where that content came from.
  const gone: SourceRef = { id: 'https://example.test/homebrew.index', name: 'Dragons', version: '3' };
  const refs = recordSourceRefs([gone], [element('ID_A', 'https://example.test/homebrew.index')], []);
  assert.deepEqual(refs, [gone]);
});

test('the Aurora overlay is not a configured source, so it records nothing', () => {
  // The 83 elements Aurora's app generates carry their own origin and belong to no index.
  const profile = new SourceProfile(new MemoryStorage());
  const core = profile.add(CORE, { version: '1.2.0' });
  assert.deepEqual(recordSourceRefs([], [element('ID_INTERNAL_X', 'aurora:generated')], [core]), []);
});

// --- which system a source serves (ADR 0031) -------------------------------

test('a source belongs to the system the user assigned it, and to no other', () => {
  const profile = new SourceProfile(new MemoryStorage());
  profile.add(CORE, { systemId: 'dnd5e', official: true });
  profile.add('https://example.test/cairn.incuset', { systemId: 'cairn' });

  assert.deepEqual(sourcesForSystem(profile.sources, 'dnd5e').map((s) => s.id), [CORE]);
  assert.deepEqual(sourcesForSystem(profile.sources, 'cairn').map((s) => s.name), ['cairn']);
  assert.deepEqual(sourcesForSystem(profile.sources, 'nothing'), []);
});

/**
 * The case that decides the shape. A profile written before ADR 0031 has no `systemId` on
 * anything, and counting those as the current system's would feed a Pathfinder index to a D&D
 * character the first time someone kept two. They are a question, not an answer.
 */
test('an untagged source belongs to no system, and is offered rather than hidden', () => {
  const profile = new SourceProfile(new MemoryStorage());
  profile.add(CORE);

  assert.deepEqual(sourcesForSystem(profile.sources, 'dnd5e'), []);
  assert.deepEqual(unassignedSources(profile.sources).map((s) => s.id), [CORE]);

  profile.update(CORE, { systemId: 'dnd5e' });
  assert.deepEqual(sourcesForSystem(profile.sources, 'dnd5e').map((s) => s.id), [CORE]);
  assert.deepEqual(unassignedSources(profile.sources), []);
});

test('the assignment survives a round trip through storage', async () => {
  const storage = new MemoryStorage();
  const profile = new SourceProfile(storage);
  profile.add(CORE, { systemId: 'dnd5e', official: true });
  await profile.save();

  const reloaded = await SourceProfile.load(storage);
  const source = reloaded.find(CORE);
  assert.equal(source?.systemId, 'dnd5e');
  assert.equal(source?.official, true);
});
