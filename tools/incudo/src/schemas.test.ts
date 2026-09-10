/**
 * The system schema as a contract, not as documentation.
 *
 * ADR 0011 stakes the project's premise on one sentence: *"if it parses, the app should be
 * able to build in it."* These tests hold both ends of it — every shipped system passes the
 * validator the app runs, and the things that would make the app throw are caught by that
 * same validator rather than at runtime.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  deriveCharacter,
  createCharacter,
  formatSchemaErrors,
  MapElementIndex,
  resolveCharacterKind,
  validateCharacter,
  validateGameSystem,
  validateManifest,
  type GameSystem,
} from '@incudo/core';

import { loadSchemas, systemsDirectory } from './node-system.ts';

async function shippedSystems(): Promise<Array<[string, unknown]>> {
  const dir = systemsDirectory();
  const entries = await readdir(dir, { withFileTypes: true });
  const systems: Array<[string, unknown]> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name, 'system.json');
    systems.push([entry.name, JSON.parse(await readFile(path, 'utf8'))]);
  }
  return systems;
}

test('every shipped system validates', async () => {
  const schemas = await loadSchemas();
  const systems = await shippedSystems();
  assert.ok(systems.length >= 2, 'expected dnd5e and cairn at least');

  for (const [id, raw] of systems) {
    const result = validateGameSystem(raw, schemas);
    assert.deepEqual(result.errors, [], `systems/${id}:\n${formatSchemaErrors(result.errors).join('\n')}`);
  }
});

test('every kind of every shipped system can actually build', async () => {
  // The other half of "if it parses, the app can build in it": walk each declared kind the
  // way the app would, with no content loaded at all, and check nothing throws.
  const schemas = await loadSchemas();
  for (const [id, raw] of await shippedSystems()) {
    const system = validateGameSystem(raw, schemas).value!;
    for (const declared of system.characterKinds) {
      const kind = resolveCharacterKind(system, declared.id);
      assert.ok(kind.buildSteps.length > 0, `${id}/${declared.id} has no build steps`);
      assert.ok(kind.sheet.sections.length > 0, `${id}/${declared.id} has no sheet`);

      const character = createCharacter(system.id, kind.id);
      const derived = deriveCharacter(character, system, new MapElementIndex());
      assert.equal(derived.kind.id, kind.id);

      // Errors, not warnings. A kind whose `grants` name content this empty index does not
      // have warns and carries on, which is the point of that distinction: the system
      // definition is describing content, and "no content loaded" is not a broken system.
      const errors = derived.problems.filter((p) => p.level === 'error');
      assert.deepEqual(errors, [], `${id}/${declared.id} derives with errors`);
    }
  }
});

test('the 5e kinds are the ones ADR 0009 describes', async () => {
  const schemas = await loadSchemas();
  const raw = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8'));
  const system = validateGameSystem(raw, schemas).value!;

  assert.deepEqual(system.characterKinds.map((k) => k.id), ['pc', 'npc', 'legendary']);

  const pc = resolveCharacterKind(system, 'pc');
  assert.deepEqual(pc.progression, {
    kind: 'level',
    min: 1,
    max: 20,
    stat: 'level',
    // One ID_LEVEL_N element per level, which is what Aurora writes into every save and
    // what its content references. See baselineElementIds.
    elementIdPattern: 'ID_LEVEL_{n}',
    // `level:rogue`, `level:warlock` — read by 150-odd references in the corpus and written
    // by none of them, because Aurora computes class levels in application code. ADR 0015.
    trackStatPattern: 'level:{name}',
  });
  assert.equal(pc.default, true);

  const npc = resolveCharacterKind(system, 'npc');
  assert.equal(npc.progression.kind, 'rating');

  // "legendary" is a delta on "npc": it inherits the rating progression and adds three
  // element types, rather than repeating the whole kind.
  const legendary = resolveCharacterKind(system, 'legendary');
  assert.deepEqual(legendary.progression, npc.progression);
  for (const type of ['Legendary Action', 'Lair Action', 'Regional Effect']) {
    assert.ok(legendary.elementTypes.includes(type));
    assert.ok(!npc.elementTypes.includes(type));
  }

  // A monster's proficiency bonus comes from its challenge rating, not from a level it does
  // not have — the kind replaces the system's stat rather than adding a second one.
  const profs = npc.stats.filter((s) => s.name === 'proficiency');
  assert.equal(profs.length, 1);
});

test('cairn is level-less, and that is a progression rather than a special case', async () => {
  const schemas = await loadSchemas();
  const raw = JSON.parse(await readFile(join(systemsDirectory(), 'cairn', 'system.json'), 'utf8'));
  const system = validateGameSystem(raw, schemas).value!;
  const kind = resolveCharacterKind(system, undefined);
  assert.deepEqual(kind.progression, { kind: 'none' });
});

// ---------------------------------------------------------------------------

function broken(patch: (system: GameSystem) => void): GameSystem {
  const system: GameSystem = {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Widget' }],
    stats: [{ name: 'vigour', default: 10 }],
    characterKinds: [
      {
        id: 'only',
        name: 'Only',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Widget'],
        buildSteps: [{ id: 'one', label: 'One', types: ['Widget'] }],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
      },
    ],
  };
  patch(system);
  return system;
}

async function errorsFor(system: unknown): Promise<string[]> {
  return formatSchemaErrors(validateGameSystem(system, await loadSchemas()).errors);
}

test('a system that would throw at load fails validation instead', async () => {
  // Each of these used to be discoverable only by running the app and watching it break.
  assert.deepEqual(
    await errorsFor(broken((s) => (s.characterKinds[0]!.extends = 'nope'))),
    ['characterKinds[0].extends: character kind "only" extends "nope", which this system does not declare.'],
  );

  assert.deepEqual(await errorsFor(broken((s) => (s.characterKinds = []))), [
    'characterKinds: must not be empty',
  ]);

  assert.deepEqual(
    await errorsFor(broken((s) => s.characterKinds.push({ ...s.characterKinds[0]! }))),
    [
      'characterKinds[1].id: is already used by another kind ("only" must be unique within a system)',
      'characterKinds: marks 2 kinds as default (only, only); only one may be',
    ],
  );

  assert.deepEqual(await errorsFor(broken((s) => (s.characterKinds[0]!.elementTypes = ['Gadget']))), [
    'characterKinds[0].elementTypes: names "Gadget", which the system\'s elementTypes does not declare',
  ]);

  assert.deepEqual(
    await errorsFor(broken((s) => (s.characterKinds[0]!.buildSteps![0]!.types = ['Gadget']))),
    ['characterKinds[0].buildSteps: step "one" picks "Gadget", which the system\'s elementTypes does not declare'],
  );

  assert.deepEqual(
    await errorsFor(
      broken((s) => (s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', stats: ['nope'] }] })),
    ),
    ['characterKinds[0].sheet: section "s" shows the stat "nope", which is not declared by the system or by this kind'],
  );
});

test('structural mistakes get messages a non-programmer can act on', async () => {
  assert.deepEqual(await errorsFor(broken((s) => ((s as unknown as Record<string, unknown>)['formatVersion'] = 2))), [
    'formatVersion: must be 1',
  ]);

  assert.deepEqual(await errorsFor(broken((s) => (s.id = 'Not An Id'))), [
    'id: must be lowercase letters, digits and hyphens, e.g. "dnd5e" or "my-house-rules"',
  ]);

  assert.deepEqual(
    await errorsFor(
      broken((s) => ((s.characterKinds[0] as unknown as Record<string, unknown>)['progression'] = { kind: 'levels', min: 1 })),
    ),
    ['characterKinds[0].progression.kind: must be one of level, rating, xp, none'],
  );

  assert.deepEqual(
    await errorsFor(
      broken((s) => ((s.characterKinds[0] as unknown as Record<string, unknown>)['progression'] = { kind: 'level', min: 1 })),
    ),
    ['characterKinds[0].progression.max: is required'],
  );

  assert.deepEqual(
    await errorsFor(broken((s) => ((s as unknown as Record<string, unknown>)['characterKind'] = []))),
    ['characterKind: is not a known field — did you mean "characterKinds"?'],
  );
});

test('a character and a manifest validate against their own schemas', async () => {
  const schemas = await loadSchemas();
  const character = createCharacter('dnd5e', 'pc', { name: 'Vigaro', progress: 3 });
  assert.deepEqual(validateCharacter(character, schemas).errors, []);

  // A roll is a number. Everything else about a character is a choice.
  assert.deepEqual(validateCharacter({ ...character, rolls: { 'hp:2': 'seven' } }, schemas).errors, [
    { path: 'rolls.hp:2', message: 'must be a number, not a string' },
  ]);

  // Assets are paths, never inline bytes (ADR 0007).
  assert.deepEqual(
    validateCharacter({ ...character, assets: { portrait: 'data:image/png;base64,iVBOR' } }, schemas)
      .errors,
    [
      {
        path: 'assets.portrait',
        message: 'must be a plain file name inside assets/, e.g. "assets/portrait.png"',
      },
    ],
  );

  assert.deepEqual(
    validateManifest({ formatVersion: 1, kind: 'character', created: 'now', systemId: 'dnd5e' }, schemas)
      .errors,
    [],
  );
  assert.deepEqual(
    validateManifest({ formatVersion: 1, kind: 'character', created: 'now' }, schemas).errors,
    [{ path: 'systemId', message: 'is required for a character container' }],
  );
});
