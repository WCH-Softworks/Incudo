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
  assert.deepEqual(validateCharacter({ ...character, formatVersion: 3 }, schemas).errors, [
    { path: 'formatVersion', message: 'must be one of 1, 2' },
  ]);

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
