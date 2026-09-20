/**
 * ROADMAP Phase 2's exit criterion, built through the builder: a level 8 multiclassed
 * Rogue/Wizard with a subclass on each side, feats and spells.
 *
 * Wizard 4 / Rogue 4, a variant Human, the Wizard first. Arcane Tradition: Evocation. Roguish
 * Archetype: Arcane Trickster, which puts a *second* spellcasting class beside a full caster — the
 * case CLAUDE.md names as the one no sample save covers. Feats: Alert at level 1 (the variant
 * Human's) and War Caster at Rogue 4, which has a prerequisite.
 *
 * **There is no Aurora oracle for this character.** Every number is worked by hand from the
 * Player's Handbook and written out beside the assertion, so a failure says which sentence of the
 * book the engine disagrees with. That is the standard `hp` and `ac` are held to (ADRs 0019, 0026),
 * and it is weaker than the nine saves. A save of this exact character made in Aurora would be
 * the referee, and `multiclass.test.ts` shows what that looks like for the Paladin/Warlock.
 *
 * It found a real defect the first time it was built, in the running app: a subclass picked through
 * a `select` gated on the character's total level (ADR 0040). Wizard 4 / Rogue 4 read a caster level
 * of 4 where the book says 5, and granted a Wizard 6 feature at Wizard 4. Every figure below that
 * is marked *(ADR 0040)* was wrong before it.
 *
 * Needs only the corpus, no saves. Skipped where the Aurora install is not on the machine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BundleElementIndex,
  createCharacter,
  deriveCharacter,
  readCharacterContainer,
  validateGameSystem,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import { ContentLibrary, HttpContentSource } from '@incudo/content';
import { CharacterBuilder, packCharacter } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { LocalMirrorFetcher, NodeFetcher } from './node-platform.ts';
import { loadSchemas } from './node-system.ts';
import { buildRogueWizard } from './rogue-wizard-build.ts';

const AURORA_INDEX =
  process.env['INCUDO_AURORA_INDEX'] ??
  'C:/Users/gcorn/Documents/5e Character Builder/custom/AuroraLegacy.index';
const available = existsSync(AURORA_INDEX);

async function shippedSystem(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

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
  'a level 8 Wizard 4 / Rogue 4 with an Arcane Trickster, built through the builder, reads as the book says',
  { skip: available ? false : `no Aurora install at ${AURORA_INDEX}` },
  async () => {
    const system = await shippedSystem();
    const elements = await auroraCorpus();
    const builder = new CharacterBuilder(
      createCharacter('dnd5e', 'pc', { progress: 1, name: 'Wizard 4 Rogue 4' }),
      system,
      elements,
    );

    buildRogueWizard(builder, elements);

    // A decision stays listed once answered (hit points read "all recorded"), so blocking means owing.
    const blocking = (): string[] =>
      builder.getState().decisions.filter((d) => d.blocking && d.remaining > 0).map((d) => d.label);

    // --- nothing the character owes is left ---------------------------------------------------
    assert.deepEqual(blocking(), [], 'no blocking decision is open');
    const state = builder.getState();
    assert.equal(state.character.progress, 8);
    assert.deepEqual(
      state.derived.problems.filter((p) => p.level === 'error').map((p) => p.code),
      [],
      'and the derivation reports no error',
    );

    const derived = deriveCharacter(state.character, system, elements);
    const stat = (name: string) => derived.stats.get(name)?.value;
    const has = (name: string) => derived.elements.some((e) => e.name === name);

    // --- the track ------------------------------------------------------------------------------
    assert.equal(stat('level'), 8);
    assert.equal(stat('level:wizard'), 4);
    assert.equal(stat('level:rogue'), 4);
    assert.equal(stat('proficiency'), 3, 'level 5 to 8 is +3');

    // --- abilities: the array, plus the variant Human, plus a +2 at Wizard 4 ------------------
    // Str 8; Dex 14 + 1; Con 13 + 1; Int 15 + 2; Wis 12; Cha 10.
    assert.deepEqual(
      ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].map(stat),
      [8, 15, 14, 17, 12, 10],
    );

    // --- hit points: Wizard first (6 + 3 x 4), Rogue d8 average (4 x 5), Con modifier +2 x 8 ------
    assert.equal(stat('hp'), 6 + 3 * 4 + 4 * 5 + 2 * 8);
    assert.equal(stat('hp'), 54);
    assert.equal(stat('initiative'), 2 + 5, 'Dexterity modifier +2 and Alert +5');
    assert.equal(stat('ac'), 10 + 2, 'no armour: 10 and the Dexterity modifier');

    // --- spellcasting: 8 + proficiency 3 + Intelligence modifier 3 ----------------------------
    assert.equal(stat('wizard:spellcasting:dc'), 14);
    assert.equal(stat('wizard:spellcasting:attack'), 6);
    assert.equal(stat('arcane trickster:spellcasting:dc'), 14, 'both use Intelligence');
    assert.equal(stat('arcane trickster:spellcasting:attack'), 6);

    // --- slots: the multiclass table (ADR 0040) -------------------------------------------------
    // Caster level = Wizard 4 + one third of Rogue 4, rounded down (floor(4 / 3) = 1) = 5, which
    // the multiclass Spellcaster table gives as 4 / 3 / 2. It read 4, and 4 / 3 / 0, before.
    assert.equal(stat('multiclass:spellcasting:level'), 5);
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => stat(`spellcasting:slots:${n}`)),
      [4, 3, 2, 0, 0, 0, 0, 0, 0],
    );
    // The Arcane Trickster's own table at Rogue 4 is 3 first-level slots, and no second-level ones
    // (ADR 0040: 4 and 2 while its `level="4"` and `level="7"` rows read the total, 8).
    assert.equal(stat('arcane trickster:spellcasting:slots:1'), 3);
    assert.ok(!stat('arcane trickster:spellcasting:slots:2'), 'no 2nd-level slots until Rogue 7');

    // --- subclass features, each at its own class's level (ADR 0040) --------------------------
    assert.equal(has('Evocation Savant'), true, 'Wizard 2');
    assert.equal(has('Sculpt Spells'), true, 'Wizard 2');
    assert.equal(has('Potent Cantrip'), false, 'a Wizard 6 feature, and this is Wizard 4');
    assert.equal(has('Mage Hand Legerdemain'), true, 'Rogue 3');
    assert.equal(has('Magical Ambush'), false, 'a Rogue 9 feature');
    assert.equal(has('Cunning Action'), true, 'Rogue 2');
    assert.equal(has('Uncanny Dodge'), false, 'a Rogue 5 feature');
    assert.equal(has('Alert'), true);
    assert.equal(has('War Caster'), true);

    // --- what a second class does and does not give (Player's Handbook, Multiclassing) --------
    // Saving throws: only the class the character started in. Armour and tools: the multiclass
    // Rogue's light armour and thieves' tools, and nothing of its weapons or its other skills.
    assert.equal(has('Saving Throw Proficiency (Intelligence)'), true);
    assert.equal(has('Saving Throw Proficiency (Wisdom)'), true);
    assert.equal(has('Saving Throw Proficiency (Dexterity)'), false, 'the Rogue\'s, which a second class never gives');
    assert.equal(has('Armor Proficiency (Light Armor)'), true);
    assert.equal(has('Tool Proficiency (Thieves’ tools)'), true);
    assert.equal(has('Weapon Proficiency (Hand Crossbow)'), false, 'not a multiclass Rogue\'s');

    // --- the spells the pools hold --------------------------------------------------------------
    const answered = (label: string) => derived.answeredChoices.find((a) => a.label === label)?.chosen.length;
    assert.equal(answered('Cantrip (Wizard)'), 4, 'three at Wizard 1, one more at Wizard 4');
    assert.equal(answered('Spellbook (Wizard)'), 6 + 2 * 3, 'six, and two for each level after the first');
    assert.equal(answered('Cantrip (Arcane Trickster)'), 2, 'Mage Hand is granted, not chosen');
    assert.equal(answered('Spell (Arcane Trickster)'), 4, 'the Rogue 4 column of its table');

    // --- saved, and opened with nothing configured (ADR 0012) ---------------------------------
    // A chosen subclass and a second spellcasting class are exactly what a save has to carry: the
    // container is packed from the corpus, then read back and derived from its own content alone.
    const packed = packCharacter(state.character, system, elements, { generator: 'rogue-wizard-test' });
    const { container, problems } = readCharacterContainer(packed.files);
    assert.ok(container, 'the container reads back');
    assert.deepEqual(problems.filter((p) => p.level === 'error'), []);
    const reopened = deriveCharacter(container.character, system, new BundleElementIndex(container.content.elements));
    assert.deepEqual(summarize(reopened), summarize(derived), 'the save derives identically with no source loaded');
    assert.equal(reopened.stats.get('multiclass:spellcasting:level')?.value, 5);
  },
);

