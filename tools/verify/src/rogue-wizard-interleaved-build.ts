/**
 * The Rogue 4 / Wizard 4 whose levels alternate, as the steps that build it (docs/SAMPLE-SAVES.md, sample 06).
 *
 * `rogue-wizard-build.ts` describes the same two classes taken in blocks with the Wizard first. This is the
 * other order, and order is what it is for: the Rogue is the first class, so it brings the saving throws and the
 * full starting proficiencies, and the Wizard comes in as a multiclass with only its own. Every level after the
 * first is spent on the class it went to, one `addLevel` at a time, in the order Rogue, Wizard, Rogue, Wizard.
 * The steps go through `CharacterBuilder` the way a pane drives it, by a candidate's name and book, so a
 * printing that changed fails here and does not quietly pick something else.
 */

import assert from 'node:assert/strict';

import type { ElementId, ElementIndex } from '@incudo/core';
import type { CharacterBuilder } from '@incudo/ui';

import { ROGUE, WIZARD } from './rogue-wizard-build.ts';

const PHB = 'Player’s Handbook';
const AURORA = 'Aurora Legacy Essentials';
const INTERNAL = 'Internal';

/** Builds the whole character from a fresh level 1 one. Nothing it owes is left open. */
export function buildInterleavedRogueWizard(builder: CharacterBuilder, elements: ElementIndex): void {
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
  const firstOf = (label: string, count: number): void => {
    for (let i = 0; i < count; i += 1) {
      const decision = builder.getState().decisions.find((d) => d.label === label);
      assert.ok(decision, `"${label}" is not open`);
      builder.choose(decision.id, [...decision.chosen, decision.candidates[0]!]);
    }
  };

  // --- character level 1: Rogue 1 -------------------------------------------------------------
  // Standard array: DEX 15, INT 14, CON 13, WIS 12, CHA 10, STR 8; the Human adds +1 to each.
  builder.setGenerationMethod('abilities', 'standard-array');
  const array = { dexterity: 15, intelligence: 14, constitution: 13, wisdom: 12, charisma: 10, strength: 8 };
  for (const [stat, value] of Object.entries(array)) builder.setBudgetStat('abilities', stat, value);

  answer('Campaign options', `Feats|${INTERNAL}`, `Multiclassing|${INTERNAL}`);
  builder.choose('build/race', [pickId(elements, 'Human', PHB, 'Race')]);
  answer('Language (Human)', `Elvish|${AURORA}`);
  builder.choose('build/class', [ROGUE]);
  builder.choose('build/background', [pickId(elements, 'Sage', PHB, 'Background')]);
  firstOf('Personality Trait', 2);
  firstOf('Ideal', 1);
  firstOf('Bond', 1);
  firstOf('Flaw', 1);
  answer('Language (Sage)', `Dwarvish|${AURORA}`, `Gnomish|${AURORA}`);
  answer('Skill Proficiency (Rogue)', `Stealth|${AURORA}`, `Perception|${AURORA}`, `Sleight of Hand|${AURORA}`, `Insight|${AURORA}`);
  answer('Expertise (Rogue)', 'Skill Expertise (Stealth)', 'Tool Expertise (Thieves’ Tools)');
  builder.recordHitPoints('levels', 1, 'average');

  // --- Wizard 1 (character level 2) -------------------------------------------------------------
  assert.equal(builder.addLevel('levels', WIZARD), true, 'the Wizard is open to Intelligence 15');
  builder.recordHitPoints('levels', 2, 'average');
  answer('Cantrip (Wizard)', 'Fire Bolt', 'Mage Hand', 'Prestidigitation');
  answer('Spellbook (Wizard)', 'Magic Missile', 'Shield', 'Mage Armor', 'Sleep', 'Detect Magic', 'Find Familiar');
  answer('Find Familiar', 'Owl');

  // --- Rogue 2 (3) ------------------------------------------------------------------------------
  assert.equal(builder.addLevel('levels', ROGUE), true);
  builder.recordHitPoints('levels', 3, 'average');

  // --- Wizard 2 (4) -----------------------------------------------------------------------------
  assert.equal(builder.addLevel('levels', WIZARD), true);
  builder.recordHitPoints('levels', 4, 'average');
  answer('Arcane Tradition', 'School of Evocation');
  answer('Spellbook (Wizard)', 'Burning Hands', 'Thunderwave');

  // --- Rogue 3 (5): the Arcane Trickster ----------------------------------------------------------
  assert.equal(builder.addLevel('levels', ROGUE), true);
  builder.recordHitPoints('levels', 5, 'average');
  answer('Roguish Archetype', 'Arcane Trickster');
  answer('Cantrip (Arcane Trickster)', 'Minor Illusion', 'Message');
  answer('Spell (Arcane Trickster)', 'Feather Fall', 'Disguise Self', 'Charm Person');

  // --- Wizard 3 (6) -----------------------------------------------------------------------------
  assert.equal(builder.addLevel('levels', WIZARD), true);
  builder.recordHitPoints('levels', 6, 'average');
  answer('Spellbook (Wizard)', 'Misty Step', 'Scorching Ray');

  // --- Rogue 4 (7): an ability score improvement -------------------------------------------------
  assert.equal(builder.addLevel('levels', ROGUE), true);
  builder.recordHitPoints('levels', 7, 'average');
  answer('Improvement Option (Rogue 4)', `Ability Score Improvement|${INTERNAL}`);
  answer('Ability Score Increase (ROGUE 4)', `Dexterity +1|${INTERNAL}`, `Dexterity +1|${INTERNAL}`);
  answer('Spell (Arcane Trickster)', 'Color Spray');

  // --- Wizard 4 (8): a feat ------------------------------------------------------------------------
  assert.equal(builder.addLevel('levels', WIZARD), true);
  builder.recordHitPoints('levels', 8, 'average');
  answer('Improvement Option (Wizard 4)', `Feat|${INTERNAL}`);
  answer('Feat (WIZARD 4)', 'Ritual Caster');
  // The feat is one element per class list, and asks which. Its two ritual spells are chosen through a
  // `Ritual` support filter that Incudo does not read yet (ROADMAP, CLAUDE.md), so they are not offered.
  answer('Ritual Caster', 'Wizard');
  answer('Cantrip (Wizard)', 'Ray of Frost');
  answer('Spellbook (Wizard)', 'Invisibility', 'Mirror Image');
}

/** The id of a top-level pick, found by name, book and type rather than written out. */
function pickId(elements: ElementIndex, name: string, book: string, type: string): ElementId {
  const found = [...elements.all()].filter((e) => e.name === name && e.source === book && e.type === type);
  assert.equal(found.length, 1, `expected one ${type} named ${name} from ${book}, found ${found.length}`);
  return found[0]!.id;
}
