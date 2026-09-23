/**
 * Multiclassing against a real Aurora save, through the builder — ADR 0036.
 *
 * A Paladin 3 / Sorcerer 3 was made in Aurora (a generic sample, docs/SAMPLE-SAVES.md) so that
 * multiclassing would have a referee. This rebuilds it with `CharacterBuilder` — a fresh character, its
 * picks replayed, the Sorcerer levels spent one `addLevel` at a time, each through the same eligibility
 * gate a click goes through — and compares what comes out against the import of the save.
 *
 * The save is found by its class split and not by what it is called, and this file skips where no
 * such save is present.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BundleElementIndex,
  LayeredElementIndex,
  createCharacter,
  deriveCharacter,
  setBaseStat,
  validateGameSystem,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import { compareWithAurora, importAuroraCharacter, parseAuroraSave } from '@incudo/aurora-import';
import { CharacterBuilder } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { loadSchemas } from './node-system.ts';
import { unnamed } from './private-saves.ts';
import { SAVES_DIR, realElements, requireSaves, savesSkip } from './real-data.ts';

async function fiveE(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

// --- the oracle -----------------------------------------------------------------------------

const SPLIT = [...Array<string>(3).fill('Paladin'), ...Array<string>(3).fill('Sorcerer')].join(',');

/**
 * The save whose six levels went three to a Paladin and three to a Sorcerer, found by that and not
 * by what the file is called. Paladin 3 is the odd half-caster level that tells rounding down from up.
 */
async function findOracle(corpus: ElementIndex): Promise<string | undefined> {
  for (const name of (await readdir(SAVES_DIR)).sort()) {
    if (extname(name).toLowerCase() !== '.dnd5e') continue;
    const xml = await unnamed('reading a save', () => readFile(join(SAVES_DIR, name), 'utf8'));
    const imported = importAuroraCharacter(parseAuroraSave(xml), { index: corpus, systemId: 'dnd5e' });
    const split = imported.character.advancement?.map((entry) => corpus.get(entry.elementId)?.name).join(',');
    if (split === SPLIT) return xml;
  }
  return undefined;
}

test(
  'the Paladin 3 / Sorcerer 3 sample, rebuilt through the builder, is the character Aurora wrote',
  { skip: savesSkip },
  async (t) => {
    requireSaves();
    const system = await fiveE();
    const corpus = await realElements();
    const xml = await findOracle(corpus);
    if (xml === undefined) {
      t.skip('no save of a Paladin 3 / Sorcerer 3 is present');
      return;
    }
    const save = parseAuroraSave(xml);
    const imported = importAuroraCharacter(save, { index: corpus, systemId: 'dnd5e' });
    const elements = new LayeredElementIndex([new BundleElementIndex(imported.generated), corpus]);
    const reference = imported.character;

    // What the import holds about the split — the thing the builder has to reproduce.
    assert.equal(reference.progress, 6);
    const importedAdvancement = reference.advancement!;
    assert.equal(importedAdvancement.length, 6);
    const paladin = importedAdvancement[0]!.elementId;
    const sorcerer = importedAdvancement[5]!.elementId;
    assert.notEqual(paladin, sorcerer);
    assert.deepEqual(
      importedAdvancement.map((entry) => (entry.elementId === paladin ? 'P' : 'S')).join(''),
      'PPPSSS',
    );
    const isMulticlassRecord = (ruleKey: string): boolean => ruleKey.includes('select:Multiclass');
    const importedRecords = reference.choices.filter((c) => isMulticlassRecord(c.ruleKey));
    assert.equal(importedRecords.length, 1);

    // --- built from a fresh character, one builder call at a time -------------------------
    // Inputs that are not about which class a level went to are the save's own: the bag and the
    // recorded rolls are carried across, and every other pick is replayed through `choose`. The
    // class is chosen under the builder's own key rather than the import's, so this also proves
    // the first class is found from content and not from where an import happened to put it.
    let seed = createCharacter('dnd5e', 'pc', { progress: 1 });
    seed = { ...seed, inventory: reference.inventory, rolls: reference.rolls };
    const builder = new CharacterBuilder(seed, system, elements);
    for (const [stat, value] of Object.entries(reference.baseStats ?? {})) builder.setBaseStat(stat, value);

    builder.choose('build/class', [paladin]);
    builder.setProgress(3);
    assert.equal(builder.getState().character.advancement, undefined, 'Paladin 3 is still one class');

    // With the scores unset a Charisma 13 minimum is not met. ADR 0045: that is a flag, not a refusal.
    const bare = new CharacterBuilder(
      { ...createCharacter('dnd5e', 'pc', { progress: 3 }), choices: [{ ruleKey: 'build/class', elementIds: [paladin] }] },
      system,
      elements,
    );
    const bareOption = bare.classLevelsFor('levels')!.options.find((o) => o.id === sorcerer)!;
    assert.equal(bareOption.eligible, true, 'a short score does not stop the class being taken');
    assert.ok(
      bareOption.flag?.some((terms) => terms.some((s) => s.stat === 'cha' && s.needs === 13 && s.has < 13)),
      'default scores do not meet Charisma 13, and the shortfall says so',
    );

    const option = builder.classLevelsFor('levels')!.options.find((o) => o.id === sorcerer)!;
    assert.equal(option.eligible, true, 'the sample\'s Charisma meets the Sorcerer\'s block');
    assert.equal(option.taken, false);
    assert.equal(option.flag, undefined, 'and nothing is flagged');

    for (let level = 4; level <= 6; level += 1) {
      assert.equal(builder.addLevel('levels', sorcerer), true, `level ${level} is the Sorcerer's`);
      // A level's track is its class's: after the second Sorcerer level the class reads 2, whatever
      // the character's total is.
      assert.equal(builder.getState().derived.stats.get('level:sorcerer')?.value, level - 3);
      assert.equal(builder.getState().derived.stats.get('level')?.value, level);
    }
    assert.equal(builder.getState().character.progress, 6);

    // The same records an import writes, from the builder's own hands.
    assert.deepEqual(builder.getState().character.advancement, importedAdvancement);
    assert.deepEqual(
      builder.getState().character.choices.filter((c) => isMulticlassRecord(c.ruleKey)),
      importedRecords,
      'keyed exactly as the import keys it, so either can be edited by the other\'s code',
    );

    for (const choice of reference.choices) {
      if (isMulticlassRecord(choice.ruleKey) || choice.ruleKey === 'ID_LEVEL_1/select:Class') continue;
      builder.choose(choice.ruleKey, choice.elementIds);
    }

    // --- what agrees ----------------------------------------------------------------------
    const built = deriveCharacter(builder.getState().character, system, elements);
    const original = deriveCharacter(reference, system, elements);

    const a = summarize(built);
    const b = summarize(original);
    assert.deepEqual(a.elements, b.elements, 'the same elements, ids and all');
    assert.deepEqual(a.stats, b.stats, 'the same stat, every one of them');
    assert.deepEqual(a.pendingChoices, b.pendingChoices);
    assert.deepEqual(
      a.problems.map((p) => p.code),
      b.problems.map((p) => p.code),
    );

    // Not just each other: the numbers the differential check exists for.
    const stat = (name: string) => built.stats.get(name)?.value;
    assert.equal(stat('level'), 6);
    assert.equal(stat('level:paladin'), 3);
    assert.equal(stat('level:sorcerer'), 3);
    // Worked from the Player's Handbook: Paladin 3 is one half-caster level rounded down (1, and 2 if it
    // were rounded up), plus three Sorcerer levels. A caster level of 4 is 4 first-level and 3
    // second-level slots; a 5 would add three third-level ones.
    assert.equal(stat('multiclass:spellcasting:level'), 4, 'a half-caster rounds down: floor(3 / 2) + 3');
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => stat(`spellcasting:slots:${n}`)),
      [4, 3, 0, 0, 0, 0, 0, 0, 0],
      'the shared pool of a caster level of 4',
    );

    // Against Aurora itself: the differences the built character has with the save are exactly
    // the ones the import has and nothing new. Zero `stat-mismatch` and zero `spell-missing` are the
    // numbers CLAUDE.md holds; this is those numbers for a character nobody imported. The one
    // `element-missing` is the Aurora-app marker for the level the second class began at.
    const fingerprint = (d: ReturnType<typeof deriveCharacter>) =>
      compareWithAurora(save, d, { index: elements }).differences
        .map((difference) => `${difference.kind}:${difference.elementId ?? ''}`)
        .sort();
    const builtDifferences = fingerprint(built);
    assert.deepEqual(builtDifferences, fingerprint(original));
    assert.equal(builtDifferences.filter((d) => d.startsWith('stat-mismatch')).length, 0);
    assert.equal(builtDifferences.filter((d) => d.startsWith('spell-missing')).length, 0);
    assert.equal(builtDifferences.filter((d) => d.startsWith('element-missing')).length, 1);
  },
);

test(
  'hit points through the builder read each level\'s own die, worked by hand',
  { skip: savesSkip },
  async (t) => {
    requireSaves();
    // Nothing checks a hit point total against Aurora — the save records the rolls and never the
    // sum (ADR 0019) — so this proves less than it might sound and says so. What it CAN show:
    // that the builder hands levels 1 to 3 the Paladin's d10 and levels 4 to 6 the Sorcerer's d6, and
    // that recording them through it sums to the number the Player's Handbook gives by hand.
    // What it cannot: that Aurora agrees, or that 5e's hit point rule is the one the system
    // definition declares — that is read from the book, and this test is the reading.
    const system = await fiveE();
    const corpus = await realElements();
    const xml = await findOracle(corpus);
    if (xml === undefined) {
      t.skip('no save of a Paladin 3 / Sorcerer 3 is present');
      return;
    }
    const save = parseAuroraSave(xml);
    const imported = importAuroraCharacter(save, { index: corpus, systemId: 'dnd5e' });
    const elements = new LayeredElementIndex([new BundleElementIndex(imported.generated), corpus]);
    const paladin = imported.character.advancement![0]!.elementId;
    const sorcerer = imported.character.advancement![5]!.elementId;

    let seed = createCharacter('dnd5e', 'pc', { progress: 1 });
    for (const [stat, value] of Object.entries(imported.character.baseStats ?? {})) {
      seed = setBaseStat(seed, stat, value);
    }
    const builder = new CharacterBuilder(seed, system, elements);
    builder.choose('build/class', [paladin]);
    builder.setProgress(3);
    for (let level = 4; level <= 6; level += 1) assert.equal(builder.addLevel('levels', sorcerer), true);

    const hp = builder.hitPointsFor('levels')!;
    assert.deepEqual(
      hp.levels.map((l) => l.dieSides),
      [10, 10, 10, 6, 6, 6],
      'the level-by-level dice are what `advancement` says governs each level',
    );

    for (let level = 1; level <= 6; level += 1) builder.recordHitPoints('levels', level, 'average');
    const rolls = builder.getState().character.rolls;
    const total = Object.entries(rolls)
      .filter(([key]) => key.startsWith('hp:level:'))
      .reduce((sum, [, value]) => sum + value, 0);
    // Level 1 is the maximum of its die (10); levels 2 and 3 are a d10's average (6); three levels of
    // a d6's average (4). Not a sum the test lets the code produce: 10 + 2 × 6 + 3 × 4.
    assert.equal(total, 10 + 2 * 6 + 3 * 4);

    const derived = builder.getState().derived;
    const constitutionModifier = derived.stats.get('constitution:modifier')!.value;
    assert.equal(derived.stats.get('hp')?.value, total + constitutionModifier * 6);

    // The control: had the Sorcerer's levels been left on the Paladin, the same six averages would be
    // a d10's, and the sheet would read 6 hit points more than the character has.
    const wrong = 10 + 6 * 5;
    assert.notEqual(total, wrong);
    assert.equal(wrong - total, 6);
  },
);

test(
  'an imported character has its race, class and background answered, and changing one replaces it',
  { skip: savesSkip },
  async (t) => {
    requireSaves();
    // The import records the three under Aurora's own keys (`ID_LEVEL_1/select:Race`, ...) and is
    // frozen, so the builder used to look under `build/<stepId>` only: all three read as open and
    // blocking, and choosing a race added a second beside the imported one. Counts and shapes
    // only — no name or prose from the save.
    const system = await fiveE();
    const corpus = await realElements();
    const xml = await findOracle(corpus);
    if (xml === undefined) {
      t.skip('no save of a Paladin 3 / Sorcerer 3 is present');
      return;
    }
    const save = parseAuroraSave(xml);
    const imported = importAuroraCharacter(save, { index: corpus, systemId: 'dnd5e' });
    const elements = new LayeredElementIndex([new BundleElementIndex(imported.generated), corpus]);
    const reference = imported.character;

    assert.equal(
      reference.choices.some((c) => c.ruleKey.startsWith('build/') && c.ruleKey !== 'build/options'),
      false,
      'precondition: the import writes nothing under the builder\'s own pick keys',
    );

    const builder = new CharacterBuilder(reference, system, elements);
    const before = builder.getState();
    assert.deepEqual(
      before.decisions.filter((d) => d.kind === 'pick' && !d.multiple).map((d) => d.stepId),
      [],
      'no race, class or background is reported as open',
    );
    const settled = new Map(before.picks.map((p) => [p.stepId, p]));
    for (const step of ['race', 'class', 'background']) {
      const pick = settled.get(step);
      assert.ok(pick, `${step} is a settled pick`);
      assert.equal(pick.chosen.length, 1);
      assert.match(pick.ruleKey, /^ID_LEVEL_1\/select:/, 'published under the key it is recorded under');
    }
    assert.equal(before.steps.find((s) => s.id === 'race')?.complete, true);

    // Changing the race replaces the imported record: exactly one choice holds a Race afterwards.
    const race = settled.get('race')!;
    const replacement = race.candidates.find((id) => id !== race.chosen[0])!;
    assert.ok(replacement, 'the corpus offers another race');
    const raceHolders = (id: string, type: string) =>
      builder.getState().character.choices.filter((c) =>
        c.elementIds.some((held) => held === id || elements.get(held)?.type === type),
      );
    assert.equal(raceHolders(race.chosen[0]!, 'Race').length, 1);
    builder.choose(race.ruleKey, [replacement]);
    const after = builder.getState();
    assert.deepEqual(
      raceHolders(replacement, 'Race').map((c) => c.ruleKey),
      [race.ruleKey],
      'one Race record, still under the import\'s key',
    );
    assert.equal(after.derived.elementIds.has(race.chosen[0]!), false);
    assert.equal(after.derived.elementIds.has(replacement), true);
    assert.deepEqual(after.decisions.filter((d) => d.kind === 'pick' && !d.multiple), []);

    // Changing the class re-homes what the old first class held, exactly as it does for a
    // character the builder wrote: the Paladin's three levels go to the new class, the Sorcerer's
    // three stay, and the class records do not multiply.
    const cls = settled.get('class')!;
    const advancement = reference.advancement!;
    const paladin = advancement[0]!.elementId;
    assert.equal(cls.chosen[0], paladin);
    const other = cls.candidates.find(
      (id) => id !== paladin && id !== advancement[5]!.elementId,
    )!;
    builder.choose(cls.ruleKey, [other]);
    const rehomed = builder.getState().character;
    assert.equal(
      rehomed.advancement?.filter((entry) => entry.elementId === other).length,
      3,
      'both of the old first class\'s levels moved',
    );
    assert.equal(rehomed.advancement?.some((entry) => entry.elementId === paladin), false);
    assert.equal(
      rehomed.choices.filter((c) => c.elementIds.some((id) => elements.get(id)?.type === 'Class')).length,
      1,
    );
  },
);
