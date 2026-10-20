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
  setAdded,
  setAdditionBlock,
  setSpellAttack,
  setMoney,
  setStartingEquipmentTaken,
  setReferenced,
  setCustomFeature,
  validateCharacter,
  validateGameSystem,
  validateManifest,
  type Character,
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
  // The systems this project ships, by name. Not "at least N": a folder count says nothing about
  // which ones are there, and adding a system must not touch this test.
  const shipped = systems.map(([id]) => id);
  for (const id of ['dnd5e', 'cairn']) assert.ok(shipped.includes(id), `systems/${id} is not shipped`);

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
    // The element type a lone track is rooted on, for a character with no advancement. ADR 0044.
    trackType: 'Class',
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

  // ADR 0074: what a row shows beside it must be declared as the row must be. Fails if the check is removed.
  assert.deepEqual(
    await errorsFor(
      broken((s) => (s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', stats: ['vigour'], beside: '{stat}:nope' }] })),
    ),
    ['characterKinds[0].sheet: section "s" shows "vigour:nope" beside "vigour", which is not declared by the system or by this kind'],
  );
  assert.deepEqual(
    await errorsFor(broken((s) => (s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', stats: ['vigour'], beside: '{stat}' }] }))),
    [],
  );

  // ADR 0079: a mark counts multiples of a declared stat, reads a stat per row, has a label, and marks rows a section
  // shows. Fails if the check is removed (the first), or `mark` is left out of the schema (the last: an unknown field).
  assert.deepEqual(
    await errorsFor(
      broken((s) => (s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', stats: ['vigour'], mark: { stat: 'vigour', per: 'nope', labels: [] } }] })),
    ),
    [
      'characterKinds[0].sheet.sections[0].mark.labels: must not be empty',
    ],
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => (s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', stats: ['vigour'], mark: { stat: 'vigour', per: 'nope', labels: ['x'] } }] })),
    ),
    [
      'characterKinds[0].sheet: section "s" counts its marks in "nope", which is not declared by the system or by this kind',
      `characterKinds[0].sheet: section "s" reads every row's mark from "vigour", which names no {stat}`,
    ],
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => (s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', stats: ['vigour'], mark: { stat: '{stat}:pb', per: 'vigour', labels: ['x'] } }] })),
    ),
    [],
  );

  // ADR 0076: a section that leaves hidden elements out must list some, and the flag is a boolean. Fails if the check
  // is removed (the first), or `omitHidden` is left out of the schema (every one: an unknown field).
  assert.deepEqual(
    await errorsFor(broken((s) => (s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', stats: ['vigour'], omitHidden: true }] }))),
    ['characterKinds[0].sheet: section "s" leaves out hidden elements and lists none'],
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => (s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', types: [s.characterKinds[0]!.elementTypes![0]!], omitHidden: true }] })),
    ),
    [],
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => (s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', types: [s.characterKinds[0]!.elementTypes![0]!], omitHidden: 'yes' as unknown as boolean }] })),
    ),
    ['characterKinds[0].sheet.sections[0].omitHidden: must be a boolean, not a string'],
  );

  // ADR 0081: `gatedOnHeld` is a boolean on an equip step. Fails if it is left out of the schema (both: an unknown field).
  const equipStep = (gatedOnHeld: unknown) =>
    broken((s) => (s.characterKinds[0]!.buildSteps = [{ id: 'one', label: 'One', types: ['Widget'], equip: { setter: 'kind', values: ['x'], gatedOnHeld: gatedOnHeld as boolean } }]));
  assert.deepEqual(await errorsFor(equipStep(true)), []);
  assert.deepEqual(await errorsFor(equipStep('yes')), ['characterKinds[0].buildSteps[0].equip.gatedOnHeld: must be a boolean, not a string']);

  // ADR 0080: what a new character starts with is an answer to a set, no id twice and none blank. Fails if the check is
  // removed (the first two), or `initial` is left out of the schema (the third: an unknown field).
  const step = (extra: Record<string, unknown>) =>
    broken((s) => (s.characterKinds[0]!.buildSteps = [{ id: 'one', label: 'One', types: ['Widget'], ...extra }]));
  assert.deepEqual(await errorsFor(step({ initial: ['A'] })), [
    'characterKinds[0].buildSteps: step "one" names what a new character starts with, and is not a set (multiple)',
  ]);
  assert.deepEqual(await errorsFor(step({ multiple: true, initial: ['A', 'A', ' '] })), [
    'characterKinds[0].buildSteps: step "one" starts a new character with "A" twice',
    'characterKinds[0].buildSteps: step "one" starts a new character with a blank id',
  ]);
  assert.deepEqual(await errorsFor(step({ multiple: true, initial: ['A', 'B'] })), []);

  // ADR 0079: a section writing a track's count lists elements, on a kind whose progression publishes one, and never in a
  // creature's stat block. Fails if either check is removed (the first), or `trackProgress` is left out of the schema
  // (every one: an unknown field).
  assert.deepEqual(
    await errorsFor(broken((s) => (s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', stats: ['vigour'], trackProgress: true }] }))),
    [
      `characterKinds[0].sheet: section "s" writes a track's count beside listed elements and lists none`,
      `characterKinds[0].sheet: section "s" writes a track's count, and this kind's progression publishes none (no trackStatPattern)`,
    ],
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.progression = { kind: 'level', min: 1, max: 20, trackStatPattern: 'level:{name}' };
        s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', types: ['Widget'], trackProgress: true }] };
      }),
    ),
    [],
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.progression = { kind: 'level', min: 1, max: 20, trackStatPattern: 'level:{name}' };
        s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', types: ['Widget'], trackProgress: 1 as unknown as boolean }] };
      }),
    ),
    ['characterKinds[0].sheet.sections[0].trackProgress: must be a boolean, not a number'],
  );
});

// ADR 0079: a section writing a track's dice writes its count, and never in a creature's stat block. Fails if either check
// is removed (its case reads no error), or `trackDie` is left out of the schema (every case: an unknown field) or allowed
// blank.
test("a section's track dice are checked before the app loads it (ADR 0079)", async () => {
  const tracked = (s: GameSystem, section: Record<string, unknown>) => {
    s.characterKinds[0]!.progression = { kind: 'level', min: 1, max: 20, trackStatPattern: 'level:{name}' };
    s.characterKinds[0]!.sheet = { sections: [{ id: 's', label: 'S', types: ['Widget'], ...section } as never] };
  };
  assert.deepEqual(await errorsFor(broken((s) => tracked(s, { trackProgress: true, trackDie: 'hd' }))), []);
  assert.deepEqual(await errorsFor(broken((s) => tracked(s, { trackDie: 'hd' }))), [
    `characterKinds[0].sheet: section "s" writes a track's dice and not its count (no trackProgress)`,
  ]);
  assert.deepEqual(await errorsFor(broken((s) => tracked(s, { trackProgress: true, trackDie: '' }))), [
    'characterKinds[0].sheet.sections[0].trackDie: must not be empty',
  ]);
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        tracked(s, { trackProgress: true });
        s.characterKinds[0]!.companions = { types: ['Widget'], sheet: [{ id: 'c', label: 'C', types: ['Widget'], trackDie: 'hd' }] };
      }),
    ),
    [`characterKinds[0].companions.sheet: the section "c" writes a track's dice, which a creature's stat block has no tracks for`],
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
  const character = createCharacter('dnd5e', 'pc', { name: 'Vesper', progress: 3 });
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

test('only format 3 may leave out progress or record a removal — ADR 0060, ADR 0061', async () => {
  // Fails if the schema still requires `progress`, or if the referential check stops refusing a file that
  // omits it and claims 2 (a reader of 2 would open it and read no challenge rating at all).
  const schemas = await loadSchemas();
  const npc = createCharacter('dnd5e', 'npc', { name: 'Vesper', progress: null });
  assert.equal(npc.formatVersion, 3);
  assert.equal(npc.progress, undefined);
  assert.deepEqual(validateCharacter(npc, schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...npc, formatVersion: 2 }, schemas).errors, [
    { path: 'progress', message: 'is required below format 3' },
  ]);
  assert.deepEqual(validateCharacter({ ...npc, formatVersion: 14 } as unknown as Character, schemas).errors.map((e) => e.path), ['formatVersion']);

  // ADR 0061: a removal is format 3 too, for the same reason — a reader of 2 would give the trait back.
  const pc = createCharacter('dnd5e', 'pc', { name: 'Vesper', progress: 3 });
  assert.deepEqual(validateCharacter({ ...pc, formatVersion: 3, removedGrants: ['ID_X'] }, schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...pc, removedGrants: ['ID_X'] }, schemas).errors, [
    { path: 'removedGrants', message: 'is recorded only from format 3' },
  ]);
});

test('a custom feature section that names no section of the sheet is caught before the app loads it — ADR 0063', async () => {
  // Fails if the referential check is removed: the picker would silently leave out what the author meant to allow.
  const schemas = await loadSchemas();
  const system = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8')) as GameSystem;
  assert.deepEqual(validateGameSystem(system, schemas).errors, []);
  const npc = system.characterKinds.find((k) => k.id === 'npc')!;
  npc.customFeatures = { ...npc.customFeatures!, sections: [...npc.customFeatures!.sections!, 'nowhere'] };
  // Once: the legendary kind declares its own (ADR 0065), where it used to inherit the NPC's and repeat the error.
  assert.deepEqual(validateGameSystem(system, schemas).errors.map((e) => e.message), [
    'names "nowhere", which is not a section of this kind\'s sheet',
  ]);
});

test('only format 4 may record custom features, each with its own id — ADR 0063', async () => {
  // Fails if the schema refuses the field or a line's shape, or if the referential check stops refusing a feature
  // in a file that claims 3 (a reader of 3 would drop it) or two features sharing one id.
  const schemas = await loadSchemas();
  const npc = createCharacter('dnd5e', 'npc', { name: 'Vesper', progress: 1 });
  const godspeed = { id: 'g', name: 'Godspeed', description: 'Fast.', stats: [{ stat: 'speed', mode: 'set' as const, value: 60 }] };
  const four = setCustomFeature(npc, godspeed);
  assert.equal(four.formatVersion, 4);
  assert.deepEqual(validateCharacter(four, schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...four, formatVersion: 3 }, schemas).errors, [
    { path: 'customFeatures', message: 'is recorded only from format 4' },
  ]);
  assert.deepEqual(validateCharacter({ ...four, customFeatures: [godspeed, godspeed] }, schemas).errors.map((e) => e.path), [
    'customFeatures[1].id',
  ]);
  const badMode = { ...four, customFeatures: [{ ...godspeed, stats: [{ stat: 'speed', mode: 'double', value: 2 }] }] };
  assert.notDeepEqual(validateCharacter(badMode as unknown as Character, schemas).errors, []);
});

test('only format 6 may record the type a custom feature is held as — ADR 0065', async () => {
  // Fails if the schema refuses the field, or if the referential check stops refusing a typed feature in a file that
  // claims 5 (a reader of 5 would hold a legendary action as a trait).
  const schemas = await loadSchemas();
  const npc = createCharacter('dnd5e', 'legendary', { name: 'Vesper', progress: 1 });
  const storm = { id: 's', name: 'Storm Bolt', type: 'Legendary Action', stats: [] };
  const six = setCustomFeature(npc, storm);
  assert.equal(six.formatVersion, 6);
  assert.deepEqual(validateCharacter(six, schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...six, formatVersion: 5 }, schemas).errors, [
    { path: 'customFeatures[0].type', message: 'is recorded only from format 6' },
  ]);
  assert.notDeepEqual(validateCharacter({ ...six, customFeatures: [{ ...storm, type: '' }] }, schemas).errors, []);
});

test('only format 9 may record a custom feature line that marks a row — ADR 0094', async () => {
  // Fails if the schema refuses the mode, if setCustomFeature stops raising to 9, or if the referential check stops
  // refusing a mark in a file that claims 8 (a reader of 8 refuses the mode, so the number must say why).
  const schemas = await loadSchemas();
  const npc = createCharacter('dnd5e', 'npc', { name: 'Vesper', progress: 1 });
  const keen = { id: 'k', name: 'Keen Eyes', stats: [{ stat: 'perception', mode: 'mark' as const, value: 1 }] };
  const nine = setCustomFeature(npc, keen);
  assert.equal(nine.formatVersion, 9);
  assert.deepEqual(validateCharacter(nine, schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...nine, formatVersion: 8 }, schemas).errors, [
    { path: 'customFeatures[0].stats[0].mode', message: '"mark" is recorded only from format 9' },
  ]);
  assert.equal(setCustomFeature(npc, { ...keen, stats: [{ stat: 'speed', mode: 'set', value: 60 }] }).formatVersion, 4);
});

test('only format 12 may record where a custom feature was copied from — ADR 0106', async () => {
  // Fails if the schema leaves `library` out (an unknown field), if setCustomFeature stops raising to 12, or if the
  // referential check stops refusing it in a file that claims 11 (a reader of 11 refuses the field).
  const schemas = await loadSchemas();
  const npc = createCharacter('dnd5e', 'npc', { name: 'Vesper', progress: 1 });
  const godspeed = { id: 'g', name: 'Godspeed', stats: [{ stat: 'speed', mode: 'set' as const, value: 60 }], library: { id: 'f-1', revision: 2 } };
  const twelve = setCustomFeature(npc, godspeed);
  assert.equal(twelve.formatVersion, 12);
  assert.deepEqual(validateCharacter(twelve, schemas).errors, []);
  assert.deepEqual(validateCharacter(setCustomFeature(npc, { ...godspeed, library: { id: 'f-1', revision: 2, edited: true } }), schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...twelve, formatVersion: 11 }, schemas).errors, [
    { path: 'customFeatures[0].library', message: 'is recorded only from format 12' },
  ]);
  assert.equal(validateCharacter(setCustomFeature(npc, { ...godspeed, library: { id: 'f-1', revision: 0 } }), schemas).valid, false);
});

test('a type a custom feature may be held as is one the system declares, and the default is among them — ADR 0065', async () => {
  // Fails if either referential check is removed: a type nothing declares is listed under no section, and a default
  // the list leaves out is a type the picker never offers back.
  const schemas = await loadSchemas();
  const system = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8')) as GameSystem;
  const legendary = system.characterKinds.find((k) => k.id === 'legendary')!;
  legendary.customFeatures = { ...legendary.customFeatures!, types: [...legendary.customFeatures!.types!, 'Mythic Action'] };
  assert.deepEqual(validateGameSystem(system, schemas).errors, [
    { path: 'characterKinds[2].customFeatures', message: `names "Mythic Action", which the system's elementTypes does not declare` },
  ]);
  legendary.customFeatures = { ...legendary.customFeatures, types: ['Legendary Action'] };
  assert.deepEqual(validateGameSystem(system, schemas).errors, [
    { path: 'characterKinds[2].customFeatures.types', message: 'leaves out "Companion Trait", the type a feature is held as by default' },
  ]);
});

test('only format 5 may record additions, each once — ADR 0064', async () => {
  // Fails if the schema refuses the field or accepts an id twice, or if the referential check stops refusing an
  // addition in a file that claims 4 (a reader of 4 would drop it).
  const schemas = await loadSchemas();
  const npc = createCharacter('dnd5e', 'npc', { name: 'Vesper', progress: 1 });
  const five = setAdded(setAdded(npc, 'ID_A', true), 'ID_B', true);
  assert.equal(five.formatVersion, 5);
  assert.deepEqual(validateCharacter(five, schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...five, formatVersion: 4 }, schemas).errors, [
    { path: 'additions', message: 'is recorded only from format 5' },
  ]);
  assert.deepEqual(validateCharacter({ ...five, additions: ['ID_A', 'ID_A'] }, schemas).errors.map((e) => e.path), ['additions']);
});

test('only format 10 may record the block an addition is cast through, and only for an addition — ADR 0097', async () => {
  // Fails if the schema refuses the field, if the referential check stops refusing it in a file that claims 9 (a reader
  // of 9 would drop it), or stops refusing a record on an element that is not added.
  const schemas = await loadSchemas();
  const pc = setAdded(createCharacter('dnd5e', 'pc', { name: 'Sample', progress: 1 }), 'ID_A', true);
  const ten = setAdditionBlock(pc, 'ID_A', 'Wizard');
  assert.equal(ten.formatVersion, 10);
  assert.deepEqual(ten.additionBlocks, { ID_A: 'wizard' });
  assert.deepEqual(validateCharacter(ten, schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...ten, formatVersion: 9 }, schemas).errors, [
    { path: 'additionBlocks', message: 'is recorded only from format 10' },
  ]);
  assert.deepEqual(validateCharacter({ ...ten, additionBlocks: { ID_B: 'wizard' } }, schemas).errors, [
    { path: 'additionBlocks.ID_B', message: '"ID_B" is not an element added to this character' },
  ]);
});

test("only format 13 may record what the user chose about a cantrip's attack — ADR 0111", async () => {
  // Fails if the schema refuses the field or its shape, or if the check stops refusing it in a file that claims 12 (a
  // reader of 12 would drop it), or the schema accepts a die of one side or three dice.
  const schemas = await loadSchemas();
  const pc = createCharacter('dnd5e', 'pc', { name: 'Sample', progress: 1 });
  const chose = setSpellAttack(pc, 'ID_A', { sides: [8, 12], damageType: 'necrotic', ability: 'Wisdom', block: 'Cleric' });
  assert.equal(chose.formatVersion, 13);
  assert.deepEqual(validateCharacter(chose, schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...chose, formatVersion: 12 }, schemas).errors, [
    { path: 'spellAttacks', message: 'is recorded only from format 13' },
  ]);
  assert.notDeepEqual(validateCharacter({ ...chose, spellAttacks: { ID_A: { sides: [1] } } }, schemas).errors, []);
  assert.notDeepEqual(validateCharacter({ ...chose, spellAttacks: { ID_A: { sides: [4, 6, 8] } } }, schemas).errors, []);
  assert.deepEqual(validateCharacter(setSpellAttack(pc, 'ID_A', { sides: [] }), schemas).errors, []);
});

test('only format 11 may record money or a starting package, and money only in the units the system declares — ADR 0087', async () => {
  // Fails if the schema refuses either field, if the referential check stops refusing them in a file that claims 10 (a
  // reader of 10 drops them), stops refusing a unit the system does not declare, or a package recorded twice for one class.
  const schemas = await loadSchemas();
  const system = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8')) as GameSystem;
  const pc = createCharacter('dnd5e', 'pc', { name: 'Sample', progress: 1 });
  const eleven = setStartingEquipmentTaken(setMoney(pc, { gp: 15, sp: 3 }), 'ID_A', { for: 'ID_A', option: 'a', coins: { gp: 15 } });
  assert.equal(eleven.formatVersion, 11);
  assert.deepEqual(validateCharacter(eleven, schemas, system).errors, []);
  assert.deepEqual(validateCharacter({ ...eleven, formatVersion: 10 }, schemas).errors, [
    { path: 'money', message: 'is recorded only from format 11' },
    { path: 'startingEquipment', message: 'is recorded only from format 11' },
  ]);
  assert.deepEqual(validateCharacter({ ...eleven, money: { gp: 1, doubloon: 2 } }, schemas, system).errors, [
    { path: 'money.doubloon', message: '"doubloon" is not a unit of money this system declares' },
  ]);
  // With no system to hold it to, a unit is not judged.
  assert.deepEqual(validateCharacter({ ...eleven, money: { doubloon: 2 } }, schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...eleven, money: { gp: 1.5 } }, schemas).errors.map((e) => e.path), ['money.gp']);
  const twice = { ...eleven, startingEquipment: [...eleven.startingEquipment!, { for: 'ID_A', option: 'b' }] };
  assert.deepEqual(validateCharacter(twice, schemas).errors.map((e) => e.path), ['startingEquipment[1].for']);
});

test('a coinage whose rates disagree is refused when the system loads — ADR 0087', async () => {
  // Fails if the referential check is removed: an electrum piece worth both 50 and 30 copper would price one thing twice.
  const schemas = await loadSchemas();
  const system = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8')) as GameSystem;
  assert.deepEqual(validateGameSystem(system, schemas).errors, []);
  system.currency = { ...system.currency!, ep: { label: 'Electrum', exchangeRate: { sp: 3 } } };
  assert.deepEqual(validateGameSystem(system, schemas).errors.map((e) => e.path), ['currency']);
});

test('a type cast through a block that cannot be added is caught before the app loads it — ADR 0097', async () => {
  // Fails if the referential check is removed: the choice of block would be offered for a type no row ever shows.
  const schemas = await loadSchemas();
  const system = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8')) as GameSystem;
  const pc = system.characterKinds.find((k) => k.id === 'pc')!;
  assert.deepEqual(validateGameSystem(system, schemas).errors, []);
  pc.additions = { ...pc.additions!, blocks: { ...pc.additions!.blocks!, types: ['Spell', 'Item'] } };
  assert.deepEqual(validateGameSystem(system, schemas).errors, [
    { path: 'characterKinds[0].additions.blocks.types', message: `names "Item", which is not among the kind's additions types` },
  ]);
});

test('an addable type the system does not declare is caught before the app loads it — ADR 0064', async () => {
  // Fails if the referential check is removed: the picker would offer nothing of that type and say nothing.
  const schemas = await loadSchemas();
  const system = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8')) as GameSystem;
  const pc = system.characterKinds.find((k) => k.id === 'pc')!;
  pc.additions = { types: [...pc.additions!.types, 'Contition'] };
  assert.deepEqual(validateGameSystem(system, schemas).errors, [
    { path: 'characterKinds[0].additions.types', message: `names "Contition", which the system's elementTypes does not declare` },
  ]);
});

test('a type a picker marks that the system does not declare is caught before the app loads it', async () => {
  // Fails if the referential check is removed: no candidate would ever be marked with it, and nothing would say why.
  // Fails too if the schema refuses the field, or the shipped declaration stops validating.
  const schemas = await loadSchemas();
  const system = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8')) as GameSystem;
  assert.deepEqual(validateGameSystem(system, schemas).errors, [], 'the shipped declaration is valid');
  const pc = system.characterKinds.find((k) => k.id === 'pc')!;
  pc.candidateOverlaps = { types: [...pc.candidateOverlaps!.types, 'Proficiancy'] };
  assert.deepEqual(validateGameSystem(system, schemas).errors, [
    { path: 'characterKinds[0].candidateOverlaps.types', message: `names "Proficiancy", which the system's elementTypes does not declare` },
  ]);
});

test('only format 7 may record references, each once — ADR 0068', async () => {
  // Fails if the schema refuses the field or accepts an id twice, or if the referential check stops refusing a
  // reference in a file that claims 6 (a reader of 6 would drop it, and the NPC would lose its stat block).
  const schemas = await loadSchemas();
  const npc = createCharacter('dnd5e', 'npc', { name: 'Vesper', progress: 1 });
  const seven = setReferenced(setReferenced(npc, 'ID_A', true), 'ID_B', true);
  assert.equal(seven.formatVersion, 7);
  assert.deepEqual(validateCharacter(seven, schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...seven, formatVersion: 6 }, schemas).errors, [
    { path: 'references', message: 'is recorded only from format 7' },
  ]);
  assert.deepEqual(validateCharacter({ ...seven, references: ['ID_A', 'ID_A'] }, schemas).errors.map((e) => e.path), ['references']);
});

test('a reference type the system does not declare is caught before the app loads it — ADR 0068', async () => {
  // Fails if the referential check is removed: the picker would offer nothing of that type and say nothing.
  const schemas = await loadSchemas();
  const system = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8')) as GameSystem;
  const npc = system.characterKinds.find((k) => k.id === 'npc')!;
  npc.references = { ...npc.references!, types: [...npc.references!.types, 'Informaton'] };
  // For the NPC and for the legendary creature, which inherits the NPC's.
  const message = `names "Informaton", which the system's elementTypes does not declare`;
  assert.deepEqual(validateGameSystem(system, schemas).errors, [
    { path: 'characterKinds[1].references.types', message },
    { path: 'characterKinds[2].references.types', message },
  ]);
});

test('a play declaration naming a rest, a section or a source it does not have is caught before the app loads it — ADR 0084', async () => {
  // Fails if `checkPlay` is removed or loses a check: each broken name below would track or give back nothing, silently.
  const schemas = await loadSchemas();
  const system = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8')) as GameSystem;
  assert.deepEqual(validateGameSystem(system, schemas).errors, [], 'the shipped declaration is valid');
  const pc = system.characterKinds.find((k) => k.id === 'pc')!;
  const play = pc.play!;
  pc.play = {
    ...play,
    rests: [...play.rests!, { id: 'long', label: 'Again' }, { id: 'nap', label: 'Nap', includes: ['siesta'] }],
    trackers: [
      ...play.trackers!,
      { id: 'hp', stat: 'hp' },
      { id: 'both', stat: 'hp', max: 3 },
      { id: 'nowhere', rows: 'slotz' },
      { id: 'no-dice', dice: 'abilities' },
      { id: 'when', stat: 'hp', restoresWhen: { stat: 'x', restores: [] } },
      { id: 'used', uses: ['features'], restores: [{ rest: 'long' }] },
      { id: 'dawn', max: 1, restores: [{ rest: 'dawn' }, { rest: 'long', amount: 1, fraction: 0.5 }] },
    ],
  };
  const at = 'characterKinds[0].play';
  assert.deepEqual(validateGameSystem(system, schemas).errors, [
    { path: `${at}.rests`, message: 'declares the rest "long" twice' },
    { path: `${at}.rests`, message: '"nap" includes "siesta", which is not a declared rest' },
    { path: `${at}.trackers`, message: 'declares the tracker "hp" twice' },
    { path: `${at}.trackers`, message: '"both" names 2 of stat, rows, dice, uses and max, and must name one' },
    { path: `${at}.trackers`, message: '"nowhere" reads the sheet section "slotz", which the kind does not declare' },
    { path: `${at}.trackers`, message: '"no-dice" reads dice from "abilities", which writes none (trackDie)' },
    { path: `${at}.trackers`, message: '"when" has restoresWhen, which only a rows tracker over a perBlock section reads' },
    { path: `${at}.trackers`, message: '"used" reads uses, which the rest their usage names gives back; it takes no restores' },
    { path: `${at}.trackers`, message: '"dawn" is given back by "dawn", which is not a declared rest' },
    { path: `${at}.trackers`, message: '"dawn" gives back both an amount and a fraction on "long"' },
  ]);
});

test('an inventory validates as instances, and a duplicate instance id does not', async () => {
  const schemas = await loadSchemas();
  const character = createCharacter('dnd5e', 'pc', { name: 'Vesper', progress: 3 });

  const bag = [
    {
      instanceId: 'one',
      elementId: 'ID_WOTC_PHB_WEAPON_GREATSWORD',
      equipped: true,
      attuned: true,
      adorners: [{ elementId: 'ID_WOTC_DMG_MAGIC_ITEM_FROST_BRAND' }],
    },
    { instanceId: 'two', elementId: 'ID_WOTC_PHB_WEAPON_GREATSWORD', quantity: 2 },
  ];
  assert.deepEqual(validateCharacter({ ...character, inventory: bag }, schemas).errors, []);

  // A character written before ADR 0024 still opens.
  assert.deepEqual(validateCharacter({ ...character, formatVersion: 1 }, schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...character, formatVersion: 14 } as unknown as Character, schemas).errors, [
    { path: 'formatVersion', message: 'must be one of 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13' },
  ]);
  // Play state (ADR 0084) is recorded only from format 8, whole positive counts only. Fails if the format check in
  // `checkCharacterReferences` is removed, or if the schema's `minimum` is.
  const play = { spent: { hp: 7, 'uses/ID_X': 1 }, temporary: { hp: 5 }, conditions: ['Prone'] };
  assert.deepEqual(validateCharacter({ ...character, formatVersion: 8, play }, schemas).errors, []);
  assert.deepEqual(validateCharacter({ ...character, play }, schemas).errors, [{ path: 'play', message: 'is recorded only from format 8' }]);
  assert.equal(validateCharacter({ ...character, formatVersion: 8, play: { spent: { hp: 0 } } }, schemas).valid, false);

  // The check no JSON Schema can express: an instance id is an address, so two entries
  // sharing one is a file where editing an item changes a different item (ADR 0024).
  assert.deepEqual(
    validateCharacter(
      { ...character, inventory: [bag[0], { ...bag[1], instanceId: 'one' }] },
      schemas,
    ).errors,
    [
      {
        path: 'inventory[1].instanceId',
        message: '"one" is already used by another item — instance ids must be unique',
      },
    ],
  );

  // An adornment has no identity of its own, on purpose — Aurora gives it none.
  assert.deepEqual(
    validateCharacter(
      { ...character, inventory: [{ ...bag[0], adorners: [{ elementId: 'X', instanceId: 'y' }] }] },
      schemas,
    ).errors,
    [{ path: 'inventory[0].adorners[0].instanceId', message: 'is not a known field' }],
  );

  // A stack is a count, and half an arrow is not a thing.
  assert.deepEqual(
    validateCharacter({ ...character, inventory: [{ ...bag[1], quantity: 1.5 }] }, schemas).errors,
    [{ path: 'inventory[0].quantity', message: 'must be an integer, not a number' }],
  );

  // A skipped decision, by id (ADR 0033) — an input in the same family as rolls and
  // baseStats, and not a formatVersion bump: a reader blind to it just shows the decision
  // again, which is the pre-existing behaviour this field improves on.
  assert.deepEqual(
    validateCharacter({ ...character, declinedDecisions: ['build/options'] }, schemas).errors,
    [],
  );
});

test('a requires or budget that points nowhere is caught before the app loads it', async () => {
  assert.deepEqual(
    await errorsFor(broken((s) => (s.characterKinds[0]!.buildSteps![0]!.requires = ['ghost']))),
    ['characterKinds[0].buildSteps: step "one" requires "ghost", which this kind has no step for'],
  );

  assert.deepEqual(
    await errorsFor(broken((s) => (s.characterKinds[0]!.buildSteps![0]!.requires = ['one']))),
    ['characterKinds[0].buildSteps: step "one" requires itself'],
  );

  // A cycle is reported, never repaired — ADR 0011's stance on system definitions.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.buildSteps = [
          { id: 'a', label: 'A', types: [], requires: ['b'] },
          { id: 'b', label: 'B', types: [], requires: ['a'] },
        ];
      }),
    ),
    ['characterKinds[0].buildSteps: has a "requires" cycle: a, b can never become available'],
  );

  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.buildSteps![0]!.budget = {
          stat: 'points',
          targets: ['vigour'],
          methods: ['no-such-method'],
        };
      }),
    ),
    [
      'characterKinds[0].buildSteps: step "one" offers the generation method "no-such-method", which the system\'s generationMethods does not declare',
    ],
  );
});

test('a slot that publishes into nothing, or twice, is caught before the app loads it', async () => {
  const inventory = {
    slotSetter: 'worn',
    occupiedTag: 'any',
    emptyTag: 'none',
    slots: [{ id: 'torso', stats: ['plating'] }],
  };

  // A slot publishing into a stat nothing declares renders a blank forever, which is the
  // mistake an author actually makes — the same check `perBlock` sections get (ADR 0020).
  assert.deepEqual(
    await errorsFor(broken((s) => (s.characterKinds[0]!.inventory = inventory))),
    [
      'characterKinds[0].inventory: slot "torso" publishes into "plating", which is not declared by the system or by this kind',
    ],
  );

  // A slot is found by matching content's string exactly once, so the second is unreachable.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.inventory = {
          ...inventory,
          slots: [{ id: 'torso', stats: ['vigour'] }, { id: 'torso' }],
        };
      }),
    ),
    ['characterKinds[0].inventory: declares the slot "torso" twice; only the first would ever be reached'],
  );

  // And the structural half: a declaration has to say what an occupied and an empty slot
  // publish, because core owns neither word.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.inventory = { slotSetter: 'worn', slots: [] } as never;
      }),
    ),
    [
      'characterKinds[0].inventory.occupiedTag: is required',
      'characterKinds[0].inventory.emptyTag: is required',
    ],
  );
});

test('a blockFilter that could never expand is caught before the app loads it', async () => {
  // The failure mode this guards is silent by construction: a filter that resolves nothing
  // leaves the select offering an empty list, which looks exactly like a content source the
  // user has not enabled. ADR 0030 splits those two sentences apart at runtime; this stops
  // the system definition from creating the confusion in the first place.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.blockFilters = [{ key: 'gizmo:catalogue' }];
      }),
    ),
    ['characterKinds[0].blockFilters: expands "gizmo:catalogue" into nothing: give it tags or tagsFromStats'],
  );

  // A pattern is a stat name with one wildcard. None captures nothing; two is ambiguous.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.blockFilters = [
          { key: 'gizmo:charge', tagsFromStats: ['{name}:gizmo:charge', '{name}:*:charge:*'] },
        ];
      }),
    ),
    [
      'characterKinds[0].blockFilters: the "gizmo:charge" pattern "{name}:gizmo:charge" needs exactly one *, and has 0',
      'characterKinds[0].blockFilters: the "gizmo:charge" pattern "{name}:*:charge:*" needs exactly one *, and has 2',
    ],
  );

  // Keys are matched once, so a second entry for one key is dead weight rather than an
  // alternative — the same reading a duplicate slot id gets.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.blockFilters = [
          { key: 'gizmo:catalogue', tags: ['{name}'] },
          { key: 'Gizmo:Catalogue', tags: ['{list}'] },
        ];
      }),
    ),
    ['characterKinds[0].blockFilters: expands "Gizmo:Catalogue" twice; only the first would ever be reached'],
  );
});

test('a setterTags entry that names a setter twice, or nothing, is caught before the app loads it', async () => {
  // Same reason as a blockFilter: a tag that never matches leaves the select offering an empty list.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.setterTags = [
          { setter: 'isGlowing', tag: 'Glowing' },
          { setter: 'ISGLOWING', tag: 'Lit' },
        ];
      }),
    ),
    ['characterKinds[0].setterTags: tags the setter "ISGLOWING" twice; only the first would ever be reached'],
  );
  assert.notDeepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.setterTags = [{ setter: 'isGlowing', tag: '' }];
      }),
    ),
    [],
  );
});

test('a held-types stat that a slot also publishes into is caught before the app loads it — ADR 0071', async () => {
  // Both answer a requirement by membership, so only one of them could ever be read. Fails without the check.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.heldTypesStat = 'vigour';
        s.characterKinds[0]!.inventory = { slotSetter: 'worn', occupiedTag: 'any', emptyTag: 'none', slots: [{ id: 'torso', stats: ['vigour'] }] };
      }),
    ),
    ['characterKinds[0].heldTypesStat: publishes held types into "vigour", which the slot "torso" publishes into too; only one of them would ever be read'],
  );
  assert.deepEqual(await errorsFor(broken((s) => (s.characterKinds[0]!.heldTypesStat = 'kinds'))), []);
  assert.notDeepEqual(await errorsFor(broken((s) => (s.characterKinds[0]!.heldTypesStat = ''))), []);
});

test('a setterStats entry that starts a stat from a type twice, or names nothing, is caught before the app loads it', async () => {
  // ADR 0057: the second entry for one type and stat is never reached, and an empty one starts nothing,
  // and both are invisible at runtime. Removing the check in checkSystemReferences fails the first
  // assertion; the schema's minLength catches the second.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.setterStats = [
          { types: ['Beast'], setter: 'might', stat: 'vigour' },
          { types: ['Beast'], setter: 'brawn', stat: 'VIGOUR' },
        ];
      }),
    ),
    ['characterKinds[0].setterStats: starts "VIGOUR" from a "Beast" twice; only the first would ever be reached'],
  );
  assert.notDeepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.setterStats = [{ types: ['Beast'], setter: '', stat: 'vigour' }];
      }),
    ),
    [],
  );
  // Two types starting one stat is ordinary: a stat block from either.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.setterStats = [
          { types: ['Beast'], setter: 'might', stat: 'vigour' },
          { types: ['Spirit'], setter: 'might', stat: 'vigour' },
        ];
      }),
    ),
    [],
  );
});

test('a setterGrants entry that reads a setter on a type twice, or names nothing, is caught before the app loads it', async () => {
  // ADR 0058. Removing the check in checkSystemReferences fails the first assertion; the schema's
  // minLength catches the second.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.setterGrants = [
          { types: ['Beast'], setter: 'deeds' },
          { types: ['Beast'], setter: 'DEEDS' },
        ];
      }),
    ),
    ['characterKinds[0].setterGrants: reads the setter "DEEDS" on a "Beast" twice'],
  );
  assert.notDeepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.setterGrants = [{ types: ['Beast'], setter: '' }];
      }),
    ),
    [],
  );
});

test("a contribution's requirements is content's language, and it has to parse", async () => {
  // The one place the system format embeds a *different* language inside JSON (ADR 0022). The
  // schema can only check that it is a string, so the parse happens in checkSystemReferences
  // and a system carrying a broken one is refused rather than loaded with a condition that
  // silently never fires.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.contributions = [
          { stat: 'vigour', value: { kind: 'number', value: 3 }, requirements: '[plating:none' },
        ];
      }),
    ),
    [
      'characterKinds[0].contributions: contributes "vigour" with a requirements expression that does not parse: unterminated "[" (at 13 in "[plating:none")',
    ],
  );

  // And the ordinary case validates: a bucket, a condition, and a stat nothing else declares.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.contributions = [
          { stat: 'vigour:cap', value: { kind: 'number', value: 2 }, bonus: 'base', requirements: '![plating:heavy]' },
          { stat: 'vigour', value: { kind: 'number', value: 3 } },
        ];
      }),
    ),
    [],
  );
});

test('a step may offer a set, and a set cannot also be required', async () => {
  // Perturbation: drop `multiple` from the schema and the first assertion fails on an unknown
  // key; drop the check in `validateGameSystem` and the second one fails.
  assert.deepEqual(
    await errorsFor(broken((s) => (s.characterKinds[0]!.buildSteps![0]!.multiple = true))),
    [],
    'a definition that offers a set is a valid one',
  );

  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        const step = s.characterKinds[0]!.buildSteps![0]!;
        step.multiple = true;
        step.required = true;
      }),
    ),
    ['characterKinds[0].buildSteps: step "one" is both required and multiple; a set that may be empty cannot be required'],
  );

  // Not a boolean: the schema says so rather than the builder guessing a reading.
  const notBoolean = broken((s) => {
    (s.characterKinds[0]!.buildSteps![0] as unknown as Record<string, unknown>)['multiple'] = 'yes';
  });
  assert.equal((await errorsFor(notBoolean)).length, 1);
});

test('a step may be a pick without being required, and a pick cannot also be a set — ADR 0068', async () => {
  // Perturbation: drop `pick` from the schema and the first assertion fails on an unknown key; drop the check in
  // `validateGameSystem` and the second one fails.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        const step = s.characterKinds[0]!.buildSteps![0]!;
        delete step.required;
        step.pick = true;
      }),
    ),
    [],
    'a definition whose step is a pick that may be skipped is a valid one',
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        const step = s.characterKinds[0]!.buildSteps![0]!;
        delete step.required;
        step.pick = true;
        step.multiple = true;
      }),
    ),
    ['characterKinds[0].buildSteps: step "one" is both a pick and multiple; a pick is of one, a set of any number'],
  );
});

test('a step a character may leave unanswered may be advanced, and no other — ADR 0115', async () => {
  // Perturbation: drop `advanced` from the schema and the first assertion fails on an unknown key; drop the check in
  // `validateGameSystem` and the second one fails.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        const step = s.characterKinds[0]!.buildSteps![0]!;
        delete step.required;
        step.multiple = true;
        step.advanced = true;
      }),
    ),
    [],
    'a set left out of what is offered until advanced options are on is a valid one',
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.buildSteps![0]!.advanced = true;
      }),
    ),
    [
      'characterKinds[0].buildSteps: step "one" is advanced and is not a set, a step that equips or a pick that is not required; only a step a character may leave unanswered can be left out of what is offered',
    ],
  );
});

test('a step a character may leave unanswered may wait on an option, and a set may be asked at the start — ADR 0123', async () => {
  // Perturbation: drop `offeredWhen` or `askedAtStart` from the schema and the first assertion fails on an unknown key;
  // drop either check in `validateGameSystem` and its refusal below is missing.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        const step = s.characterKinds[0]!.buildSteps![0]!;
        delete step.required;
        step.multiple = true;
        step.offeredWhen = 'SOME_OPTION';
        step.askedAtStart = true;
      }),
    ),
    [],
    'a set offered only with an option, and asked at the start, is a valid one',
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        const step = s.characterKinds[0]!.buildSteps![0]!;
        step.offeredWhen = 'SOME_OPTION';
        step.askedAtStart = true;
      }),
    ),
    [
      'characterKinds[0].buildSteps: step "one" is offered only when an element is held and is not a set, a step that equips or a pick that is not required; only a step a character may leave unanswered can be switched off',
      'characterKinds[0].buildSteps: step "one" is asked when a character is started and is not a set (multiple); only a set can be',
    ],
  );
});

test('a step a character may leave unanswered may be listed with the required decisions — ADR 0127', async () => {
  // Perturbation: drop `listedWithRequired` from the schema and the first assertion fails on an unknown key; drop the
  // check in `validateGameSystem` and the refusal below is missing.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        const step = s.characterKinds[0]!.buildSteps![0]!;
        delete step.required;
        step.multiple = true;
        step.listedWithRequired = true;
      }),
    ),
    [],
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.buildSteps![0]!.listedWithRequired = true;
      }),
    ),
    [
      'characterKinds[0].buildSteps: step "one" is listed with the required decisions and is not a set, a step that equips or a pick that is not required; only a step a character may leave unanswered needs listing there',
    ],
  );
});

test('a step may equip, and equipping takes none of the keys that make a step something else — ADR 0072', async () => {
  // Perturbation: drop `equip` or `hiddenSetter` from the schema and the first assertion fails on an unknown key; drop
  // the checks in `validateGameSystem` and the clash and no-types assertions fail.
  const equip = { setter: 'shelf', values: ['Switches'] };
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        s.characterKinds[0]!.buildSteps![0]!.equip = equip;
        s.characterKinds[0]!.inventory = { slotSetter: 'place', occupiedTag: 'any', emptyTag: 'none', slots: [], hiddenSetter: 'tucked' };
      }),
    ),
    [],
    'a step that equips, and an inventory naming a hidden setter, are valid',
  );
  for (const key of ['required', 'pick', 'multiple', 'perLevel'] as const) {
    assert.deepEqual(
      await errorsFor(
        broken((s) => {
          const step = s.characterKinds[0]!.buildSteps![0]!;
          step.equip = equip;
          step[key] = true;
        }),
      ),
      [`characterKinds[0].buildSteps: step "one" equips and is also ${key}; a step that equips is a set of its own and takes neither`],
    );
  }
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        const step = s.characterKinds[0]!.buildSteps![0]!;
        step.equip = equip;
        step.types = [];
      }),
    ),
    ['characterKinds[0].buildSteps: step "one" equips and names no types, so it could offer nothing'],
  );
  // No values: the schema says so rather than the builder offering nothing.
  const empty = broken((s) => (s.characterKinds[0]!.buildSteps![0]!.equip = { setter: 'shelf', values: [] }));
  assert.equal((await errorsFor(empty)).length, 1);
});

test('a track expression may read a setter, and a level roll may be fixed by an element (ADR 0044)', async () => {
  const withStat = (expr: unknown) =>
    broken((s) => {
      s.characterKinds[0]!.trackStats = [{ stat: 'dice', value: expr as never }];
    });

  assert.deepEqual(await errorsFor(withStat({ kind: 'setter', name: 'hd', as: 'dieSides' })), []);
  // Perturbation: an unknown reading, a missing name and a stray field are each refused.
  assert.notDeepEqual(await errorsFor(withStat({ kind: 'setter', name: 'hd', as: 'text' })), []);
  assert.notDeepEqual(await errorsFor(withStat({ kind: 'setter', as: 'dieSides' })), []);
  assert.notDeepEqual(await errorsFor(withStat({ kind: 'setter', name: 'hd', as: 'dieSides', extra: 1 })), []);

  const withRoll = (roll: Record<string, unknown>) =>
    broken((s) => {
      s.characterKinds[0]!.buildSteps = [
        { id: 'levels', label: 'Levels', types: [], perLevel: true, levelRoll: roll as never },
      ];
    });
  const base = { pattern: 'hp:level:{n}', dieSetter: 'hd', classType: 'Class' };
  assert.deepEqual(await errorsFor(withRoll({ ...base, fixedWhen: 'ID_OPTION' })), []);
  assert.deepEqual(await errorsFor(withRoll(base)), []);
  assert.notDeepEqual(await errorsFor(withRoll({ ...base, fixedWhen: 3 })), []);
});

test('what allows another class is named only on a per-level step with a roll (ADR 0088)', async () => {
  const roll = { pattern: 'hp:level:{n}', dieSetter: 'hd', classType: 'Class' };
  const withStep = (step: Record<string, unknown>) =>
    broken((s) => {
      s.characterKinds[0]!.buildSteps = [{ id: 'levels', label: 'Levels', types: [], ...step } as never];
    });
  assert.deepEqual(await errorsFor(withStep({ perLevel: true, levelRoll: roll, multiclassWhen: 'ID_OPTION' })), []);
  // Perturbation: no roll, not per level, a blank id and a number are each refused.
  assert.notDeepEqual(await errorsFor(withStep({ perLevel: true, multiclassWhen: 'ID_OPTION' })), []);
  assert.notDeepEqual(await errorsFor(withStep({ levelRoll: roll, multiclassWhen: 'ID_OPTION' })), []);
  assert.notDeepEqual(await errorsFor(withStep({ perLevel: true, levelRoll: roll, multiclassWhen: '' })), []);
  assert.notDeepEqual(await errorsFor(withStep({ perLevel: true, levelRoll: roll, multiclassWhen: 3 })), []);
});

test('a recorded prepared list validates as element ids by lowercased block name, and nothing else does (ADR 0046)', async () => {
  const schemas = await loadSchemas();
  const character = createCharacter('dnd5e', 'pc', { name: 'Vesper', progress: 3 });

  assert.deepEqual(
    validateCharacter({ ...character, prepared: { wizard: ['ID_A', 'ID_B'], 'eldritch knight': [] } }, schemas).errors,
    [],
  );
  // An additive field and not a formatVersion bump: the same character without it still validates.
  assert.deepEqual(validateCharacter(character, schemas).errors, []);

  assert.deepEqual(
    validateCharacter({ ...character, prepared: { wizard: 'ID_A' } }, schemas).errors,
    [{ path: 'prepared.wizard', message: 'must be an array, not a string' }],
  );
  assert.deepEqual(
    validateCharacter({ ...character, prepared: { wizard: [''] } }, schemas).errors.map((e) => e.path),
    ['prepared.wizard[0]'],
  );
  assert.deepEqual(
    validateCharacter({ ...character, prepared: ['ID_A'] }, schemas).errors,
    [{ path: 'prepared', message: 'must be an object, not an array' }],
  );
});

test('a preparation declaration is checked before the app loads it (ADR 0046)', async () => {
  const preparation = {
    blockAttribute: 'prepare',
    limit: '{name}:gizmo:allow',
    elementType: 'Widget',
    heldSelect: 'Ledger',
    listFilter: '$(gizmo:catalogue), $(gizmo:charge)',
    heldFilter: '$(gizmo:charge)',
  };
  const withFilters = (s: GameSystem, change: (p: typeof preparation) => void = () => {}) => {
    const kind = s.characterKinds[0]!;
    kind.blockFilters = [
      { key: 'gizmo:catalogue', tags: ['{list}', '{name}'] },
      { key: 'gizmo:charge', tagsFromStats: ['{name}:gizmo:charge:*'], fillFrom: 1 },
    ];
    const copy = { ...preparation };
    change(copy);
    kind.preparation = copy;
  };

  assert.deepEqual(await errorsFor(broken((s) => withFilters(s))), []);

  // Every part but the ledger is required, and an unknown key is named.
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        withFilters(s);
        delete (s.characterKinds[0]!.preparation as Partial<typeof preparation>).limit;
      }),
    ),
    ['characterKinds[0].preparation.limit: is required'],
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        withFilters(s);
        (s.characterKinds[0]!.preparation as unknown as Record<string, unknown>)['limits'] = 'x';
      }),
    ),
    ['characterKinds[0].preparation.limits: is not a known field — did you mean "limit"?'],
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        withFilters(s);
        delete s.characterKinds[0]!.preparation!.heldSelect;
      }),
    ),
    [],
  );

  // One limit for every block is a mistake nobody could see at runtime.
  assert.deepEqual(
    await errorsFor(broken((s) => withFilters(s, (p) => (p.limit = 'gizmo:allow')))),
    ['characterKinds[0].preparation: the limit "gizmo:allow" names no {name}, so every block would share one number'],
  );
  // A filter that will not parse, and one that names an expansion the kind never makes.
  assert.deepEqual(
    await errorsFor(broken((s) => withFilters(s, (p) => (p.heldFilter = '   ')))),
    ['characterKinds[0].preparation: heldFilter "   " is not a supports expression'],
  );
  assert.deepEqual(
    await errorsFor(broken((s) => withFilters(s, (p) => (p.listFilter = '$(gizmo:catalogue), $(gizmo:missing)')))),
    ['characterKinds[0].preparation: listFilter uses $(gizmo:missing), which this kind\'s blockFilters never expand'],
  );
});

// ADR 0079: a section grouping what it lists lists something, and one marking prepared elements lists what its kind
// prepares, on a kind that prepares, and never in a creature's stat block. Fails if any check is removed (its case reads
// no error), or `group` or `preparedMark` is left out of the schema (every case: an unknown field).
test("a section's group and prepared mark are checked before the app loads it (ADR 0079)", async () => {
  const preparation = {
    blockAttribute: 'prepare',
    limit: '{name}:gizmo:allow',
    elementType: 'Widget',
    listFilter: '$(gizmo:charge)',
    heldFilter: '$(gizmo:charge)',
  };
  const group = { setter: 'tier', label: 'Tier {value}', labels: { '0': 'Trinket' } };
  const preparedMark = { always: 'bolted on', chosen: 'packed' };
  const prepares = (s: GameSystem, section: Record<string, unknown>) => {
    s.elementTypes.push({ name: 'Gadget' });
    const kind = s.characterKinds[0]!;
    kind.elementTypes = ['Widget', 'Gadget'];
    kind.blockFilters = [{ key: 'gizmo:charge', tagsFromStats: ['{name}:gizmo:charge:*'], fillFrom: 1 }];
    kind.preparation = preparation;
    kind.sheet = { sections: [{ id: 's', label: 'S', ...section } as never] };
  };

  assert.deepEqual(await errorsFor(broken((s) => prepares(s, { types: ['Widget'], group, preparedMark }))), []);
  assert.deepEqual(await errorsFor(broken((s) => prepares(s, { stats: ['vigour'], group }))), [
    'characterKinds[0].sheet: section "s" groups listed elements and lists none',
  ]);
  assert.deepEqual(await errorsFor(broken((s) => prepares(s, { types: ['Gadget'], preparedMark }))), [
    'characterKinds[0].sheet: section "s" marks prepared elements and does not list "Widget", what this kind prepares',
  ]);
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        prepares(s, { types: ['Widget'], preparedMark });
        delete s.characterKinds[0]!.preparation;
      }),
    ),
    ['characterKinds[0].sheet: section "s" marks prepared elements, and this kind prepares nothing (no preparation)'],
  );
  assert.deepEqual(
    await errorsFor(
      broken((s) => {
        prepares(s, { types: ['Widget'] });
        s.characterKinds[0]!.companions = {
          types: ['Gadget'],
          sheet: [
            { id: 'c', label: 'C', types: ['Gadget'], preparedMark },
            { id: 'd', label: 'D', stats: ['vigour'], group },
          ],
        };
      }),
    ),
    [
      `characterKinds[0].companions.sheet: the section "c" marks prepared elements, which a creature's stat block has none of`,
      'characterKinds[0].companions.sheet: the section "d" groups listed elements and lists none',
    ],
  );
  assert.deepEqual(await errorsFor(broken((s) => prepares(s, { types: ['Widget'], group: { setter: 'tier' } }))), [
    'characterKinds[0].sheet.sections[0].group.label: is required',
  ]);
  assert.deepEqual(await errorsFor(broken((s) => prepares(s, { types: ['Widget'], preparedMark: { always: 'x', chosen: '' } }))), [
    'characterKinds[0].sheet.sections[0].preparedMark.chosen: must not be empty',
  ]);
});

test('the shipped 5e kind declares its preparation', async () => {
  const [, raw] = (await shippedSystems()).find(([name]) => name === 'dnd5e') ?? [];
  const pc = (raw as GameSystem).characterKinds.find((k) => k.id === 'pc')!;
  assert.deepEqual(pc.preparation, {
    blockAttribute: 'prepare',
    limit: '{name}:spellcasting:prepare',
    elementType: 'Spell',
    heldSelect: 'Spellbook',
    listFilter: '$(spellcasting:list), $(spellcasting:slots)',
    heldFilter: '$(spellcasting:slots)',
    minimum: 1,
  });
});

test('a kind may not declare one freeform key twice — ADR 0092', async () => {
  // Fails if the referential check is removed: two fields on one key would each write the other's text.
  const schemas = await loadSchemas();
  const system = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8')) as GameSystem;
  assert.deepEqual(validateGameSystem(system, schemas).errors, []);
  const pc = system.characterKinds.find((k) => k.id === 'pc')!;
  pc.freeform = { ...pc.freeform!, fields: [...pc.freeform!.fields, { key: 'backstory', label: 'Backstory again' }] };
  assert.deepEqual(validateGameSystem(system, schemas).errors, [{ path: 'characterKinds[0].freeform.fields', message: 'names the key "backstory" twice' }]);
});

test('an attack declaration naming nothing, a condition that will not parse, or a section listing attacks of a kind with none is refused — ADR 0093', async () => {
  // Fails if any of the three checks is removed, or if the schema refuses the shipped declaration or a `setter` read as a
  // number: each mistake would leave a sheet listing no attacks and nothing saying why.
  const schemas = await loadSchemas();
  const read = async (): Promise<GameSystem> => JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8')) as GameSystem;
  const shipped = await read();
  assert.deepEqual(validateGameSystem(shipped, schemas).errors, [], 'the shipped declaration is valid');
  assert.ok(shipped.characterKinds[0]!.attacks!.stats.some((s) => s.value.kind === 'setter' && s.value.as === 'number'));

  const typo = await read();
  typo.characterKinds[0]!.attacks!.types = ['Weapom'];
  assert.deepEqual(validateGameSystem(typo, schemas).errors, [
    { path: 'characterKinds[0].attacks.types', message: `names "Weapom", which the system's elementTypes does not declare` },
  ]);

  const broken = await read();
  broken.characterKinds[0]!.attacks!.stats[0]!.requirements = '[weapon:{name}';
  assert.deepEqual(validateGameSystem(broken, schemas).errors.map((e) => e.path), ['characterKinds[0].attacks.stats[0].requirements']);

  const none = await read();
  const npc = none.characterKinds.find((k) => k.id === 'npc')!;
  npc.sheet = { sections: [...npc.sheet!.sections, { id: 'attacks', label: 'Attacks', attacks: true }] };
  // For the NPC and for the legendary creature, which inherits the NPC's sheet only if it declares none; it declares its own.
  assert.deepEqual(validateGameSystem(none, schemas).errors, [
    { path: `characterKinds[${none.characterKinds.indexOf(npc)}].sheet.sections`, message: '"attacks" lists attacks, and the kind declares none' },
  ]);
});

test('an inventory editor offering an undeclared type, or a section listing the bag of a kind with no inventory, is refused — ADR 0098', async () => {
  // Fails if either check is removed, or if the schema refuses the shipped `types`, `adornSetter` or `bag`.
  const schemas = await loadSchemas();
  const read = async (): Promise<GameSystem> => JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8')) as GameSystem;
  const shipped = await read();
  assert.deepEqual(validateGameSystem(shipped, schemas).errors, []);
  const pc = shipped.characterKinds[0]!;
  assert.ok(pc.inventory!.types!.length && pc.inventory!.adornSetter && pc.sheet!.sections.some((s) => s.bag));

  const typo = await read();
  typo.characterKinds[0]!.inventory!.types = ['Item', 'Magik Item'];
  assert.deepEqual(validateGameSystem(typo, schemas).errors, [
    { path: 'characterKinds[0].inventory.types', message: `names "Magik Item", which the system's elementTypes does not declare` },
  ]);

  const none = await read();
  const npc = none.characterKinds.find((k) => k.id === 'npc')!;
  npc.sheet = { sections: [...npc.sheet!.sections, { id: 'bag', label: 'Bag', bag: true }] };
  assert.deepEqual(validateGameSystem(none, schemas).errors, [
    { path: `characterKinds[${none.characterKinds.indexOf(npc)}].sheet.sections`, message: '"bag" lists the bag, and the kind declares no inventory' },
  ]);
});
