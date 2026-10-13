/**
 * The editor of a spell's attack row — ADR 0111: what content does not say about it (its die, its damage type, the
 * ability its saving throw uses) and the class it is cast as when no class holds it. Read off the derivation's rows and
 * the kind's `attacks.spells`; every write is the builder's `setSpellAttack`. Names no game: the dice, types and
 * abilities offered are the system's.
 */

import type { DerivedCharacter, ElementId, ResolvedCharacterKind, SpellAttackChoice } from '@incudo/core';

import { heldBlocks, type BlockOption } from './additions.ts';
import { attackHead } from './sheet-document.ts';
import { sheetAttack } from './sheet.ts';

/** One spell row as the editor shows it. */
export interface SpellAttackRow {
  elementId: ElementId;
  name: string;
  kind: 'attack' | 'save';
  /** The row as the sheet writes it: "Fire Bolt: +5, 1d10 fire (range 120 feet)". */
  line: string;
  /** Content states its die and damage type, so neither is offered. */
  stated: boolean;
  /** What the user chose, empty when nothing is recorded. */
  choice: SpellAttackChoice;
  /** The class content casts it as, by name; absent when none does, and a class must be chosen for its numbers. */
  given?: string;
}

export interface SpellAttacksState {
  /** False for a kind whose attacks name no spells. */
  available: boolean;
  label: string;
  description: string;
  rows: SpellAttackRow[];
  /** The dice offered, by sides. */
  sides: number[];
  damageTypes: string[];
  abilities: string[];
  /** The classes a spell may be cast as: every block the character holds. */
  blocks: BlockOption[];
}

export const SPELL_ATTACKS_LABEL = 'Spell attacks';
export const SPELL_ATTACKS_DESCRIPTION =
  "A spell that makes an attack roll or calls for a saving throw is listed under Attacks on the sheet. Your content does not say which die it rolls, its damage type or the ability its saving throw uses, so choose them here; how many dice it rolls is worked out from the character. A spell no class casts needs a class for its attack bonus and save DC.";

/** The editor's state, from the derivation's spell rows. */
export function spellAttacksState(
  derived: Pick<DerivedCharacter, 'attacks' | 'elements' | 'character'>,
  kind: Pick<ResolvedCharacterKind, 'attacks'>,
): SpellAttacksState {
  const def = kind.attacks?.spells;
  const rows: SpellAttackRow[] = [];
  for (const attack of derived.attacks) {
    if (!attack.spell || attack.elementId === undefined) continue;
    rows.push({
      elementId: attack.elementId,
      name: attack.name,
      kind: attack.spell.kind,
      line: attackHead(sheetAttack(attack)),
      stated: attack.spell.dice === 'content',
      choice: derived.character.spellAttacks?.[attack.elementId] ?? {},
      ...(attack.spell.given !== undefined ? { given: attack.spell.given } : {}),
    });
  }
  return {
    available: def !== undefined,
    label: SPELL_ATTACKS_LABEL,
    description: SPELL_ATTACKS_DESCRIPTION,
    rows,
    sides: [...(def?.sides ?? [])],
    damageTypes: [...(def?.damageTypes ?? [])],
    abilities: [...(def?.abilities ?? [])],
    blocks: def ? heldBlocks(derived) : [],
  };
}

/** What a die is called in a list: "d8". */
export function dieLabel(sides: number): string {
  return `d${sides}`;
}

/** What the die list's empty entry and its "rolls nothing" entry say. */
export const DIE_UNCHOSEN = 'Not chosen';
export const DIE_NONE = 'Rolls nothing';
/** What the class list's first entry says: the class content gives, or that there is none. */
export function givenBlockLabel(row: Pick<SpellAttackRow, 'given'>): string {
  return row.given !== undefined ? `As content gives it (${row.given})` : 'No class';
}

/**
 * Why a choice cannot be recorded, or undefined when it can: a die, type, ability or class the system or the character
 * does not offer, a second die with no first, or a die for a spell whose die content states.
 */
export function spellAttackRefusal(state: SpellAttacksState, elementId: ElementId, choice: SpellAttackChoice): string | undefined {
  const row = state.rows.find((r) => r.elementId === elementId);
  if (!row) return 'That spell has no attack row on this character.';
  if (choice.sides !== undefined) {
    if (row.stated) return 'Its die is stated by its content.';
    if (choice.sides.length > 2) return 'A spell is given one die, or two to choose between.';
    if (choice.sides.some((s) => !state.sides.includes(s))) return 'That die is not offered.';
  }
  if (choice.damageType !== undefined && (row.stated || !state.damageTypes.includes(choice.damageType))) return 'That damage type is not offered.';
  if (choice.ability !== undefined && (row.kind !== 'save' || !state.abilities.includes(choice.ability))) return 'That ability is not offered.';
  if (choice.block !== undefined && !state.blocks.some((b) => b.key === choice.block!.trim().toLowerCase())) return 'The character casts no such class.';
  return undefined;
}
