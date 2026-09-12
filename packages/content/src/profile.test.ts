import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, type SourceRef } from '@incudo/core';

import { SourceProfile, SOURCE_PROFILE_KEY, compareSourceRefs } from './profile.ts';

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
