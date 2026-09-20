/**
 * The Wizard 4 / Rogue 4 of ROADMAP Phase 2's exit criterion, as the steps that build it.
 *
 * One place, so that the test that works its numbers out from the Player's Handbook
 * (`rogue-wizard.test.ts`) and the one that compares it with an Aurora save of the same choices
 * (`rogue-wizard-aurora.test.ts`) cannot drift apart. The steps are the description the maintainer
 * built in Aurora from: a variant Human, the Wizard first, School of Evocation, Arcane Trickster, Alert
 * and War Caster. Every step goes through `CharacterBuilder` the way a pane drives it, by a candidate's
 * name and book, so a printing that changed fails here and does not quietly pick something else.
 */

import assert from 'node:assert/strict';

import type { ElementId, ElementIndex } from '@incudo/core';
import type { CharacterBuilder } from '@incudo/ui';

const PHB = 'Player’s Handbook';
const AURORA = 'Aurora Legacy Essentials';
const INTERNAL = 'Internal';

export const WIZARD = 'ID_WOTC_PHB_CLASS_WIZARD';
export const ROGUE = 'ID_WOTC_PHB_CLASS_ROGUE';

/** Builds the whole character from a fresh level 1 one. Nothing it owes is left open. */
export function buildRogueWizard(builder: CharacterBuilder, elements: ElementIndex): void {
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
}

/** The id of a top-level pick, found by name, book and type rather than written out. */
function pickId(elements: ElementIndex, name: string, book: string, type: string): ElementId {
  const found = [...elements.all()].filter((e) => e.name === name && e.source === book && e.type === type);
  assert.equal(found.length, 1, `expected one ${type} named ${name} from ${book}, found ${found.length}`);
  return found[0]!.id;
}
