/**
 * Multiclassing against the project's own oracle, through the builder — ADR 0036.
 *
 * The level 20 Paladin 2 / Warlock 18 was made in Aurora precisely so multiclassing would have a
 * referee. This rebuilds it with `CharacterBuilder` — a fresh character, its picks replayed, the
 * Warlock levels spent one `addLevel` at a time, each through the same eligibility gate a click goes
 * through — and compares what comes out against the import of the real save.
 *
 * The save is personal data and stays out of the repo, like the other eight; this file skips
 * where it is not installed and asserts on counts, ids and shapes — never a name or a piece of
 * prose from the character.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
import { ContentLibrary, HttpContentSource } from '@incudo/content';
import { compareWithAurora, importAuroraCharacter, parseAuroraSave } from '@incudo/aurora-import';
import { CharacterBuilder } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { LocalMirrorFetcher, NodeFetcher } from './node-platform.ts';
import { loadSchemas } from './node-system.ts';

const AURORA_INDEX =
  process.env['INCUDO_AURORA_INDEX'] ??
  'C:/Users/gcorn/Documents/5e Character Builder/custom/AuroraLegacy.index';
const SAVES_DIR = process.env['INCUDO_AURORA_SAVES'] ?? dirname(dirname(AURORA_INDEX));
const ORACLE_FILE = join(SAVES_DIR, 'Hexadin.dnd5e');
const available = existsSync(AURORA_INDEX) && existsSync(ORACLE_FILE);

async function fiveE(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

// --- the oracle -----------------------------------------------------------------------------

async function auroraCorpus(): Promise<ElementIndex> {
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

test(
  'the Paladin 2 / Warlock 18 oracle, rebuilt through the builder, is the character Aurora wrote',
  { skip: available ? false : `no Aurora install at ${AURORA_INDEX}` },
  async () => {
    const system = await fiveE();
    const corpus = await auroraCorpus();

    const save = parseAuroraSave(await readFile(ORACLE_FILE, 'utf8'));
    const imported = importAuroraCharacter(save, { index: corpus, systemId: 'dnd5e' });
    const elements = new LayeredElementIndex([new BundleElementIndex(imported.generated), corpus]);
    const reference = imported.character;

    // What the import holds about the split — the thing the builder has to reproduce.
    assert.equal(reference.progress, 20);
    const importedAdvancement = reference.advancement!;
    assert.equal(importedAdvancement.length, 20);
    const paladin = importedAdvancement[0]!.elementId;
    const warlock = importedAdvancement[19]!.elementId;
    assert.notEqual(paladin, warlock);
    assert.deepEqual(
      importedAdvancement.map((entry) => (entry.elementId === paladin ? 'P' : 'W')).join(''),
      `PP${'W'.repeat(18)}`,
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
    builder.setProgress(2);
    assert.equal(builder.getState().character.advancement, undefined, 'Paladin 2 is still one class');

    // The Warlock is refused until the gate says otherwise — measured, not assumed. With the
    // scores unset a Charisma 13 minimum reads false, which is what the gate is for.
    const bare = new CharacterBuilder(
      { ...createCharacter('dnd5e', 'pc', { progress: 2 }), choices: [{ ruleKey: 'build/class', elementIds: [paladin] }] },
      system,
      elements,
    );
    const bareOption = bare.classLevelsFor('levels')!.options.find((o) => o.id === warlock)!;
    assert.equal(bareOption.eligible, false, 'default scores do not meet Charisma 13');
    assert.equal(bare.addLevel('levels', warlock), false);
    assert.equal(bare.getState().character.progress, 2, 'a refused level does not grow the character');

    const option = builder.classLevelsFor('levels')!.options.find((o) => o.id === warlock)!;
    assert.equal(option.eligible, true, 'the oracle\'s Charisma meets the Warlock\'s block');
    assert.equal(option.taken, false);

    for (let level = 3; level <= 20; level += 1) {
      assert.equal(builder.addLevel('levels', warlock), true, `level ${level} is the Warlock's`);

      if (level === 6) {
        // Decisions a level opens keep arriving in the one flat list, tagged with the level in
        // their own track: this is character level 6 and Warlock level 4.
        const improvement = builder
          .getState()
          .decisions.find((d) => /Improvement Option \(Warlock 4\)/i.test(d.label));
        assert.ok(improvement, 'the Warlock\'s level 4 improvement is outstanding');
        assert.equal(improvement.openedAt, 4, 'Warlock 4, though the character is level 6');
        assert.equal(builder.getState().derived.stats.get('level:warlock')?.value, 4);
        assert.equal(builder.getState().derived.stats.get('level')?.value, 6);
      }
    }
    assert.equal(builder.getState().character.progress, 20);

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
    assert.equal(stat('level'), 20);
    assert.equal(stat('level:paladin'), 2);
    assert.equal(stat('level:warlock'), 18);
    assert.equal(stat('multiclass:spellcasting:level'), 1, 'a half-caster rounds down: floor(2 / 2)');
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => stat(`spellcasting:slots:${n}`)),
      [2, 0, 0, 0, 0, 0, 0, 0, 0],
      'the Paladin\'s two first-level slots, and pact magic is not in the shared table',
    );
    assert.equal(stat('warlock:spellcasting:slots:count'), 4);
    assert.equal(stat('warlock:spellcasting:slots:5'), 4, 'four pact slots, all fifth level');

    // Against Aurora itself: the differences the built character has with the save are exactly
    // the ones the import has — the one known `element-missing`, the darkvision that post-dates
    // the save, the three `content-missing` — and nothing new. Zero `stat-mismatch` and zero
    // `spell-missing` are the numbers CLAUDE.md holds; this is those numbers for a character
    // nobody imported.
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
  { skip: available ? false : `no Aurora install at ${AURORA_INDEX}` },
  async () => {
    // Nothing checks a hit point total against Aurora — the save records the rolls and never the
    // sum (ADR 0019) — so this proves less than it might sound and says so. What it CAN show:
    // that the builder hands level 1 and 2 the Paladin's d10 and levels 3–20 the Warlock's d8, and
    // that recording them through it sums to the number the Player's Handbook gives by hand.
    // What it cannot: that Aurora agrees, or that 5e's hit point rule is the one the system
    // definition declares — that is read from the book, and this test is the reading.
    const system = await fiveE();
    const corpus = await auroraCorpus();
    const save = parseAuroraSave(await readFile(ORACLE_FILE, 'utf8'));
    const imported = importAuroraCharacter(save, { index: corpus, systemId: 'dnd5e' });
    const elements = new LayeredElementIndex([new BundleElementIndex(imported.generated), corpus]);
    const paladin = imported.character.advancement![0]!.elementId;
    const warlock = imported.character.advancement![19]!.elementId;

    let seed = createCharacter('dnd5e', 'pc', { progress: 1 });
    for (const [stat, value] of Object.entries(imported.character.baseStats ?? {})) {
      seed = setBaseStat(seed, stat, value);
    }
    const builder = new CharacterBuilder(seed, system, elements);
    builder.choose('build/class', [paladin]);
    builder.setProgress(2);
    for (let level = 3; level <= 20; level += 1) assert.equal(builder.addLevel('levels', warlock), true);

    const hp = builder.hitPointsFor('levels')!;
    assert.deepEqual(
      hp.levels.map((l) => l.dieSides),
      [10, 10, ...Array<number>(18).fill(8)],
      'the level-by-level dice are what `advancement` says governs each level',
    );

    for (let level = 1; level <= 20; level += 1) builder.recordHitPoints('levels', level, 'average');
    const rolls = builder.getState().character.rolls;
    const total = Object.entries(rolls)
      .filter(([key]) => key.startsWith('hp:level:'))
      .reduce((sum, [, value]) => sum + value, 0);
    // Level 1 is the maximum of its die (10); level 2 is a d10's average (6); eighteen levels of
    // a d8's average (5). Not a sum the test lets the code produce: 10 + 6 + 18 × 5.
    assert.equal(total, 10 + 6 + 18 * 5);

    const derived = builder.getState().derived;
    const constitutionModifier = derived.stats.get('constitution:modifier')!.value;
    assert.equal(derived.stats.get('hp')?.value, total + constitutionModifier * 20);

    // The control: had the Warlock's levels been left on the Paladin, the same twenty averages
    // would be a d10's, and the sheet would read 18 hit points more than the character has.
    const wrong = 10 + 6 * 19;
    assert.notEqual(total, wrong);
    assert.equal(wrong - total, 18);
  },
);

test(
  'an imported character has its race, class and background answered, and changing one replaces it',
  { skip: available ? false : `no Aurora install at ${AURORA_INDEX}` },
  async () => {
    // The import records the three under Aurora's own keys (`ID_LEVEL_1/select:Race`, ...) and is
    // frozen, so the builder used to look under `build/<stepId>` only: all three read as open and
    // blocking, and choosing a race added a second beside the imported one. Counts and shapes
    // only — no name or prose from the save.
    const system = await fiveE();
    const corpus = await auroraCorpus();
    const save = parseAuroraSave(await readFile(ORACLE_FILE, 'utf8'));
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
    // character the builder wrote: the Paladin's two levels go to the new class, the Warlock's
    // eighteen stay, and the class records do not multiply.
    const cls = settled.get('class')!;
    const advancement = reference.advancement!;
    const paladin = advancement[0]!.elementId;
    assert.equal(cls.chosen[0], paladin);
    const other = cls.candidates.find(
      (id) => id !== paladin && id !== advancement[19]!.elementId,
    )!;
    builder.choose(cls.ruleKey, [other]);
    const rehomed = builder.getState().character;
    assert.equal(
      rehomed.advancement?.filter((entry) => entry.elementId === other).length,
      2,
      'both of the old first class\'s levels moved',
    );
    assert.equal(rehomed.advancement?.some((entry) => entry.elementId === paladin), false);
    assert.equal(
      rehomed.choices.filter((c) => c.elementIds.some((id) => elements.get(id)?.type === 'Class')).length,
      1,
    );
  },
);
