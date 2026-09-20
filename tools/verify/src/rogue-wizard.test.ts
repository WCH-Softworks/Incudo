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
  type ElementId,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import { ContentLibrary, HttpContentSource } from '@incudo/content';
import { CharacterBuilder, packCharacter } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { LocalMirrorFetcher, NodeFetcher } from './node-platform.ts';
import { loadSchemas } from './node-system.ts';

const AURORA_INDEX =
  process.env['INCUDO_AURORA_INDEX'] ??
  'C:/Users/gcorn/Documents/5e Character Builder/custom/AuroraLegacy.index';
const available = existsSync(AURORA_INDEX);

const PHB = 'Player’s Handbook';
const AURORA = 'Aurora Legacy Essentials';
const INTERNAL = 'Internal';

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

/** The class ids are the only ones written out; everything else is found by name and book. */
const WIZARD = 'ID_WOTC_PHB_CLASS_WIZARD';
const ROGUE = 'ID_WOTC_PHB_CLASS_ROGUE';

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

    /**
     * Answer an open decision the way the pane does: by a candidate's name and book, adding to what
     * a several-slot pool already holds. A name that matches nothing, or more than one thing, is a
     * failure, so a book that changed its printing does not quietly pick something else.
     */
    const answer = (label: string, ...names: string[]): void => {
      for (const name of names) {
        const decision = builder.getState().decisions.find((d) => d.label === label);
        assert.ok(decision, `"${label}" is not open`);
        const [wanted, book = PHB] = name.split('|');
        const matches = decision.candidates.filter((id) => {
          const element = elements.get(id)!;
          return element.name === wanted && element.source === book;
        });
        assert.equal(matches.length, 1, `"${label}" offers ${matches.length} of "${name}", not one`);
        builder.choose(decision.id, [...decision.chosen, matches[0]!]);
      }
    };
    /** Sage's traits and ideals are a table of prose, so the first candidates are as good as any. */
    const firstOf = (label: string, count: number): void => {
      for (let i = 0; i < count; i += 1) {
        const decision = builder.getState().decisions.find((d) => d.label === label);
        assert.ok(decision, `"${label}" is not open`);
        builder.choose(decision.id, [...decision.chosen, decision.candidates[0]!]);
      }
    };
    // A decision stays listed once answered (hit points read "all recorded"), so blocking means owing.
    const blocking = (): string[] =>
      builder.getState().decisions.filter((d) => d.blocking && d.remaining > 0).map((d) => d.label);

    // --- level 1 -----------------------------------------------------------------------------
    // Standard array: Int 15, Dex 14, Con 13, Wis 12, Cha 10, Str 8. The variant Human adds +1 to
    // Constitution and Dexterity below, so they read 14 and 15.
    builder.setGenerationMethod('abilities', 'standard-array');
    const array = { intelligence: 15, dexterity: 14, constitution: 13, wisdom: 12, charisma: 10, strength: 8 };
    for (const [stat, value] of Object.entries(array)) builder.setBudgetStat('abilities', stat, value);

    answer('Campaign options', `Feats|${INTERNAL}`, `Multiclassing|${INTERNAL}`);
    builder.choose('build/race', [pickId(elements, 'Human', PHB, 'Race')]);
    answer('Human Variant', 'Human Variant');
    answer(
      'Ability Score Increase (Human Variant)',
      'Ability Score Increase (Constitution)',
      'Ability Score Increase (Dexterity)',
    );
    answer('Feat (Human Variant)', 'Alert');
    answer('Language (Human)', `Elvish|${AURORA}`);
    answer('Skill Proficiency (Human Variant)', `Stealth|${AURORA}`);

    builder.choose('build/class', [WIZARD]);
    builder.choose('build/background', [pickId(elements, 'Sage', PHB, 'Background')]);
    firstOf('Personality Trait', 2);
    firstOf('Ideal', 1);
    firstOf('Bond', 1);
    firstOf('Flaw', 1);
    answer('Language (Sage)', 'Draconic', `Dwarvish|${AURORA}`);
    answer('Skill Proficiency (Wizard)', `Investigation|${AURORA}`, `Insight|${AURORA}`);
    answer('Cantrip (Wizard)', 'Fire Bolt', 'Mage Hand', 'Prestidigitation');
    answer('Spellbook (Wizard)', 'Magic Missile', 'Shield', 'Mage Armor', 'Sleep', 'Detect Magic', 'Find Familiar');
    answer('Find Familiar', 'Owl');
    // Level 1 is the die's maximum whichever method is passed: the book says so, and the planner obeys.
    builder.recordHitPoints('levels', 1, 'average');

    // --- Wizard 2 to 4 -----------------------------------------------------------------------
    for (let level = 2; level <= 4; level += 1) {
      assert.equal(builder.addLevel('levels', WIZARD), true, `level ${level} is the Wizard's`);
      builder.recordHitPoints('levels', level, 'average');
      if (level === 2) {
        answer('Arcane Tradition', 'School of Evocation');
        answer('Spellbook (Wizard)', 'Burning Hands', 'Thunderwave');
      }
      if (level === 3) answer('Spellbook (Wizard)', 'Misty Step', 'Scorching Ray');
      if (level === 4) {
        answer('Improvement Option (Wizard 4)', `Ability Score Improvement|${INTERNAL}`);
        // +2 to one score is the same +1 twice, and the pool offers it again (ADR 0035).
        answer('Ability Score Increase (WIZARD 4)', `Intelligence +1|${INTERNAL}`, `Intelligence +1|${INTERNAL}`);
        answer('Cantrip (Wizard)', 'Ray of Frost');
        answer('Spellbook (Wizard)', 'Invisibility', 'Mirror Image');
      }
    }

    // --- Rogue 1 to 4 (character levels 5 to 8) ----------------------------------------------
    assert.equal(builder.addLevel('levels', ROGUE), true, 'the Rogue is open to Dexterity 15');
    builder.recordHitPoints('levels', 5, 'average');
    answer('Skill Proficiency (Rogue)', `Sleight of Hand|${AURORA}`);
    answer('Expertise (Rogue)', 'Skill Expertise (Stealth)', 'Tool Expertise (Thieves’ Tools)');

    assert.equal(builder.addLevel('levels', ROGUE), true);
    builder.recordHitPoints('levels', 6, 'average');

    assert.equal(builder.addLevel('levels', ROGUE), true);
    builder.recordHitPoints('levels', 7, 'average');
    answer('Roguish Archetype', 'Arcane Trickster');
    // (ADR 0040) Rogue 3 owes two cantrips beside the Mage Hand it is granted, and three 1st-level
    // spells: the book's table. It owed five spells while the subclass read the character's level 7.
    const pool = (label: string) => builder.getState().derived.pendingChoices.find((p) => p.label === label);
    assert.equal(pool('Cantrip (Arcane Trickster)')?.remaining, 2);
    assert.equal(pool('Spell (Arcane Trickster)')?.remaining, 3, 'three spells known at Rogue 3, not five');
    answer('Cantrip (Arcane Trickster)', 'Minor Illusion', 'Message');
    // Picks fill the pool's rules in level order and the any-school rule comes first, so the two
    // enchantment/illusion picks after it are what a legal Rogue 3 takes.
    answer('Spell (Arcane Trickster)', 'Feather Fall', 'Disguise Self', 'Charm Person');

    assert.equal(builder.addLevel('levels', ROGUE), true);
    builder.recordHitPoints('levels', 8, 'average');
    answer('Improvement Option (Rogue 4)', `Feat|${INTERNAL}`);
    answer('Feat (ROGUE 4)', 'War Caster');
    assert.equal(pool('Spell (Arcane Trickster)')?.remaining, 1, 'a fourth spell known at Rogue 4');
    answer('Spell (Arcane Trickster)', 'Color Spray');

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

/** The id of a top-level pick, found by name, book and type rather than written out. */
function pickId(elements: ElementIndex, name: string, book: string, type: string): ElementId {
  const found = [...elements.all()].filter((e) => e.name === name && e.source === book && e.type === type);
  assert.equal(found.length, 1, `expected one ${type} named ${name} from ${book}, found ${found.length}`);
  return found[0]!.id;
}
