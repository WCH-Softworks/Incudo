/**
 * User-authored systems — ADR 0011's promise, and the rules that keep it from biting.
 *
 * The point of these tests is not that a good file loads. It is the four ways a bad or awkward
 * one is handled: not JSON, not a valid definition, an id the app already ships, and a file that
 * validated when it was added and does not any more.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, type GameSystem, type PickedFile } from '@incudo/core';
import { UserSystemStore, USER_SYSTEM_PREFIX } from '@incudo/ui';

import { loadSchemas } from './node-system.ts';

// The repository's real schemas, through the same loader the other tests use. A stub would test the
// store's plumbing and not the thing that matters, which is that a user's file goes through
// exactly the validation ADR 0011 promises it does.
const schemas = await loadSchemas();

function definition(id: string, patch: Partial<GameSystem> = {}): GameSystem {
  return {
    formatVersion: 1,
    id,
    name: `System ${id}`,
    version: '1.0.0',
    elementTypes: [{ name: 'Widget' }],
    stats: [{ name: 'vigour', default: 10 }],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'level', min: 1, max: 5 },
        elementTypes: ['Widget'],
        buildSteps: [],
        sheet: { sections: [] },
      },
    ],
    ...patch,
  } as GameSystem;
}

function file(name: string, body: unknown | string): PickedFile {
  const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  return { name, bytes: new TextEncoder().encode(text) };
}

test('a valid definition is kept, and comes back on the next load', async () => {
  const storage = new MemoryStorage();
  const store = new UserSystemStore(storage, schemas, ['dnd5e']);

  const added = await store.add(file('mine.json', definition('mine')));
  assert.equal(added.ok, true);
  assert.equal(added.ok && added.replaced, false);

  const { systems, failures } = await new UserSystemStore(storage, schemas).load();
  assert.deepEqual(failures, []);
  assert.deepEqual(systems.map((s) => s.id), ['mine']);
});

test('the file is stored verbatim, not round-tripped through the parser', async () => {
  // Key order and spacing are the author's. A re-serialise is a change nobody asked for, and it
  // would make "the file I gave you" and "the file you kept" different things.
  const storage = new MemoryStorage();
  const store = new UserSystemStore(storage, schemas);
  const text = JSON.stringify(definition('mine'), null, 4);
  await store.add(file('mine.json', text));
  assert.equal(await storage.read(`${USER_SYSTEM_PREFIX}mine.json`), text);
});

test('adding the same id again replaces it, because that is what editing your file means', async () => {
  const storage = new MemoryStorage();
  const store = new UserSystemStore(storage, schemas);
  await store.add(file('mine.json', definition('mine', { name: 'First' })));
  const again = await store.add(file('mine.json', definition('mine', { name: 'Second' })));

  assert.equal(again.ok && again.replaced, true);
  const { systems } = await store.load();
  assert.deepEqual(systems.map((s) => s.name), ['Second']);
});

/**
 * The rule that matters most, because breaking it is unrecoverable rather than annoying: a
 * character records its system by id and nothing else (ADR 0012). Two systems answering to one
 * id makes "which rules is this character's?" unanswerable, in a file the user already saved.
 */
test('a definition claiming an id the app ships is refused, and says what to do instead', async () => {
  const store = new UserSystemStore(new MemoryStorage(), schemas, ['dnd5e', 'cairn']);
  const result = await store.add(file('mine.json', definition('dnd5e')));

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.message, /cannot share an id/);
  assert.match(result.ok ? '' : result.message, /extends/);
  assert.deepEqual((await store.load()).systems, [], 'and nothing was kept');
});

test(`a file that is not JSON is refused with the parser's complaint, not a stack trace`, async () => {
  const store = new UserSystemStore(new MemoryStorage(), schemas);
  const result = await store.add(file('broken.json', '{ "id": '));
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.message, /is not valid JSON/);
});

test('a file that is JSON but not a system is refused with the schema errors', async () => {
  const store = new UserSystemStore(new MemoryStorage(), schemas);
  const result = await store.add(file('notasystem.json', { id: 'x', name: 'X' }));

  assert.equal(result.ok, false);
  assert.ok(!result.ok && (result.errors?.length ?? 0) > 0, 'the errors are carried, not summarised away');
});

/**
 * The reason `load` revalidates rather than trusting the add-time verdict. Incudo's schema moves
 * under a file the user wrote months ago; a system that no longer validates has to be reported,
 * not half-loaded. Simulated by writing straight past `add`, which is also what someone editing
 * the storage by hand does.
 */
test('a stored definition that no longer validates is reported, not loaded', async () => {
  const storage = new MemoryStorage();
  await storage.write(`${USER_SYSTEM_PREFIX}stale.json`, JSON.stringify({ id: 'stale', name: 'Stale' }));

  const { systems, failures } = await new UserSystemStore(storage, schemas).load();
  assert.deepEqual(systems, []);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.id, 'stale');
  assert.ok(failures[0]!.errors.length > 0);
});

test('one broken definition does not stop the others loading', async () => {
  const storage = new MemoryStorage();
  const store = new UserSystemStore(storage, schemas);
  await store.add(file('good.json', definition('good')));
  await storage.write(`${USER_SYSTEM_PREFIX}bad.json`, 'not json at all');

  const { systems, failures } = await store.load();
  assert.deepEqual(systems.map((s) => s.id), ['good']);
  assert.equal(failures.length, 1);
});

test('removing one leaves the rest', async () => {
  const storage = new MemoryStorage();
  const store = new UserSystemStore(storage, schemas);
  await store.add(file('a.json', definition('alpha')));
  await store.add(file('b.json', definition('beta')));

  await store.remove('alpha');
  assert.deepEqual((await store.load()).systems.map((s) => s.id), ['beta']);
  assert.equal(await store.has('alpha'), false);
  assert.equal(await store.has('beta'), true);
});

/**
 * `remove` and `has` take an id from a *caller*, not from a definition the schema has already
 * constrained to `^[a-z0-9][a-z0-9-]*$`. That matters because a storage key becomes a file path
 * under `NodeStorage`, whose sanitiser permits `.` and `/` — so an id of `../../something`
 * would reach outside the app's own directory. The key is encoded, so it cannot.
 */
test('an id from a caller cannot escape the storage prefix', async () => {
  const storage = new MemoryStorage();
  const store = new UserSystemStore(storage, schemas);
  await store.add(file('good.json', definition('good')));

  await store.remove('../../elsewhere');
  assert.equal(await store.has('../../elsewhere'), false);

  const keys = await storage.list('');
  assert.deepEqual(keys, [`${USER_SYSTEM_PREFIX}good.json`], 'nothing was written outside the prefix');
  assert.ok(
    keys.every((key) => !key.slice(USER_SYSTEM_PREFIX.length).includes('/')),
    'and no key contains a separator the id put there',
  );
});

test('an id is matched case-insensitively, so one system cannot be stored twice', async () => {
  // The schema already forbids an uppercase id in a definition, but `has` and `remove` are
  // reached with whatever a caller holds — a system id read back off a character, say.
  const storage = new MemoryStorage();
  const store = new UserSystemStore(storage, schemas);
  await store.add(file('mine.json', definition('mine')));

  assert.equal(await store.has('MINE'), true);
  await store.remove('Mine');
  assert.deepEqual((await store.load()).systems, []);
});
