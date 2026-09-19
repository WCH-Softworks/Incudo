/**
 * Campaign options through the builder, against the real corpus — ADR 0032.
 *
 * `aurora verify` cannot see any of this: it compares the elements a character *chose*, and an
 * option changes what is *offered* — all nine saves come back byte-identical with or without the
 * step. So the evidence is measurement, here, and perturbation.
 *
 * Two kinds of test, and only the first is about the step. "Offers every Option" and "an import's
 * options read as chosen" fail if the `options` step, or its `multiple`, is taken out of
 * `systems/dnd5e/system.json` — checked. The Human Variant, Dwarf and Fighter tests measure what an
 * option *does* once chosen, which the engine could always do (an imported character has always had
 * them); they are here to show what the step now makes reachable, and are expected to pass without
 * it because they write `build/options` themselves.
 *
 * Skips where no Aurora install is present, and names no character from the nine saves.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCharacter, validateGameSystem, type ElementIndex, type GameSystem } from '@incudo/core';
import { ContentLibrary, HttpContentSource } from '@incudo/content';
import { CharacterBuilder } from '@incudo/ui';

import { LocalMirrorFetcher, NodeFetcher } from './node-platform.ts';
import { loadSchemas } from './node-system.ts';

const AURORA_INDEX =
  process.env['INCUDO_AURORA_INDEX'] ??
  'C:/Users/gcorn/Documents/5e Character Builder/custom/AuroraLegacy.index';
const available = existsSync(AURORA_INDEX);
const skip = available ? false : `no Aurora install at ${AURORA_INDEX}`;

const FEATS = 'ID_INTERNAL_OPTION_ALLOW_FEATS';
const CUSTOM_ASI = 'ID_WOTC_TCOE_OPTION_CUSTOMIZED_ASI';

async function fiveE(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

async function corpus(): Promise<ElementIndex> {
  const library = new ContentLibrary();
  await library.loadSource(
    new HttpContentSource({
      id: AURORA_INDEX,
      fetcher: new LocalMirrorFetcher(AURORA_INDEX.replace(/\.index$/i, ''), new NodeFetcher()),
      resolveByName: true,
    }),
    AURORA_INDEX,
  );
  return library.elements;
}

/** A level-`progress` character with `options` switched on, then `pick` chosen. */
function build(
  system: GameSystem,
  elements: ElementIndex,
  progress: number,
  options: string[],
  pick: { step: 'race' | 'class'; id: string },
): CharacterBuilder {
  const b = new CharacterBuilder(createCharacter('dnd5e', 'pc', { progress }), system, elements);
  if (options.length) b.choose('build/options', options);
  b.choose(`build/${pick.step}`, [pick.id]);
  return b;
}

test('the options step offers every Option in the corpus, and never blocks', { skip }, async () => {
  const system = await fiveE();
  const elements = await corpus();
  const b = new CharacterBuilder(createCharacter('dnd5e', 'pc', { progress: 1 }), system, elements);

  const decision = b.getState().decisions.find((d) => d.stepId === 'options')!;
  assert.ok(decision, 'the set is on screen from the start');
  assert.equal(decision.blocking, false);
  assert.equal(decision.multiple, true);
  // Six real ones and the two the overlay supplies — found by type, with no id named in the step.
  assert.equal(decision.candidates.length, elements.byType('Option').length);
  assert.equal(decision.candidates.length, 8);
  assert.ok(decision.candidates.includes(FEATS));
  assert.ok(decision.candidates.includes(CUSTOM_ASI));
  assert.equal(b.getState().steps.find((s) => s.id === 'options')!.complete, true);
});

test('feats on: the Human Variant is offered, and a level 4 improvement offers a feat', { skip }, async () => {
  const system = await fiveE();
  const elements = await corpus();
  const human = { step: 'race', id: 'ID_RACE_HUMAN' } as const;
  const fighter = { step: 'class', id: 'ID_WOTC_PHB_CLASS_FIGHTER' } as const;
  const VARIANT = 'ID_RACE_VARIANT_HUMAN_VARIANT';

  // The Human Variant is a `Race Variant` a Human offers through its own select, not a Race, and
  // it requires the feats switch — so it is measured where it actually appears.
  const variants = (options: string[]) =>
    build(system, elements, 1, options, human)
      .getState()
      // Not the options decision itself: switching one on takes it off that list.
      .decisions.filter((d) => d.stepId !== 'options')
      .flatMap((d) => d.candidates);
  assert.equal(variants([]).includes(VARIANT), false, 'off: not offered');
  assert.equal(variants([FEATS]).includes(VARIANT), true, 'on: offered');
  assert.equal(
    variants([FEATS]).length - variants([]).length,
    1,
    'and it is the only thing that switch adds to a Human',
  );

  // Eight of the nine sample characters took a feat at level 4.
  const improvement = (options: string[]) => {
    const b = build(system, elements, 4, options, fighter);
    return { b, decision: b.getState().decisions.find((d) => /Improvement Option \(Fighter 4\)/i.test(d.label))! };
  };
  const off = improvement([]);
  const on = improvement([FEATS]);
  assert.equal(off.decision.candidates.length, 1, 'off: the ability score improvement alone');
  assert.equal(on.decision.candidates.length, 2, 'on: and the feat beside it');
  const feat = on.decision.candidates.find((id) => id !== off.decision.candidates[0])!;
  assert.match(feat, /FEAT_4_FIGHTER$/);

  // Taking it opens a real feat choice: that is the whole of "reachable".
  on.b.choose(on.decision.id, [feat]);
  const feats = on.b.getState().decisions.find((d) => /^Feat\b/i.test(d.label));
  assert.ok(feats, 'a feat decision opens');
  assert.ok(feats.candidates.length > 0);
  assert.ok(feats.candidates.every((id) => elements.get(id)?.type === 'Feat'));
});

test('customized ability scores on: the fixed racial bonus stops and a choice opens', { skip }, async () => {
  const system = await fiveE();
  const elements = await corpus();
  const dwarf = { step: 'race', id: 'ID_SRD_RACE_DWARF' } as const;

  const read = (options: string[]) => {
    const state = build(system, elements, 1, options, dwarf).getState();
    return {
      constitution: state.derived.stats.get('constitution')?.value,
      choices: state.decisions.filter((d) => /Custom Ability Score Improvement/i.test(d.label)),
    };
  };
  const off = read([]);
  const on = read([CUSTOM_ASI]);

  assert.equal(off.choices.length, 0, 'off: nothing to choose');
  assert.equal(off.constitution, 12, 'off: the fixed +2 to Constitution applies to a base of 10');
  assert.equal(on.constitution, 10, 'on: it does not');
  assert.equal(on.choices.length, 1, 'on: a choice took its place');
  assert.equal(on.choices[0]!.candidates.length, 6, 'one for each ability');
});

test('options an import already holds read as chosen, and can be changed', { skip }, async () => {
  // OPTIONS_RULE_KEY is `build/options` and the step's own key is the same string, which is the
  // reason a set looks only there.
  const system = await fiveE();
  const elements = await corpus();
  const character = {
    ...createCharacter('dnd5e', 'pc', { progress: 1 }),
    choices: [{ ruleKey: 'build/options', elementIds: [FEATS, CUSTOM_ASI] }],
  };
  const b = new CharacterBuilder(character, system, elements);

  assert.deepEqual(b.getState().picks.find((p) => p.stepId === 'options')?.chosen, [FEATS, CUSTOM_ASI]);
  b.choose('build/options', [CUSTOM_ASI]);
  assert.ok(!b.getState().derived.elementIds.has(FEATS));
  assert.ok(b.getState().derived.elementIds.has(CUSTOM_ASI));
});
