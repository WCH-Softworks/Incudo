/**
 * The purse, worded and edited — ADR 0087, ADR 0098. Counts are kept per unit as the player holds them (`Character.money`)
 * and never folded into one total; what a unit is worth in another is worked out from the system's rates by core's
 * `currencyWorths`, and read here only to order units and to exchange coins when the player asks. Nothing here names a
 * coin: the units are the system's.
 */
import { currencyWorths, setMoney, type Character, type GameSystem } from '@incudo/core';

export interface PurseRow {
  unit: string;
  label: string;
  count: number;
}

/** The units in the order a book lists coins: most worth first, as the system's rates make them. */
export function unitsByWorth(system: GameSystem): string[] {
  const worths = currencyWorths(system.currency);
  const units = Object.keys(system.currency ?? {});
  return worths ? units.sort((a, b) => (worths.get(b) ?? 0) - (worths.get(a) ?? 0)) : units;
}

/** "15 gp, 3 sp": coins most worth first, by the unit ids content prices items in. */
export function formatCoins(coins: Record<string, number> | undefined, system: GameSystem): string | undefined {
  if (!coins) return undefined;
  const order = unitsByWorth(system);
  const units = Object.keys(coins).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const parts = units.filter((unit) => (coins[unit] ?? 0) > 0).map((unit) => `${coins[unit]} ${unit}`);
  return parts.length ? parts.join(', ') : undefined;
}

/** The purse: every declared unit, most worth first, with the count held. */
export function purseRows(character: Character, system: GameSystem): PurseRow[] {
  return unitsByWorth(system).map((unit) => ({ unit, label: system.currency![unit]!.label, count: character.money?.[unit] ?? 0 }));
}

/** The purse in a line: "10 gp, 3 sp", or "None". */
export function purseLine(purse: readonly PurseRow[]): string {
  const held = purse.filter((row) => row.count > 0).map((row) => `${row.count} ${row.unit}`);
  return held.length ? held.join(', ') : 'None';
}

/** A write to the purse: the character it gives, or a sentence saying why it was not made. */
export type PurseWrite = { character: Character } | { refused: string };

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function unitLabel(system: GameSystem, unit: string): string | undefined {
  return system.currency?.[unit]?.label;
}

/** Hold exactly `count` of a unit. A count that is not a whole number from 0 is refused. */
export function planSetCoins(character: Character, system: GameSystem, unit: string, count: number): PurseWrite {
  if (!unitLabel(system, unit)) return { refused: `"${unit}" is not a coin this game counts.` };
  if (!Number.isInteger(count) || count < 0) return { refused: 'A number of coins is a whole number, 0 or more.' };
  return { character: setMoney(character, { ...(character.money ?? {}), [unit]: count }) };
}

/** Receive coins of one unit. */
export function planReceiveCoins(character: Character, system: GameSystem, unit: string, count: number): PurseWrite {
  if (!Number.isInteger(count) || count < 1) return { refused: 'Receive a whole number of coins, 1 or more.' };
  return planSetCoins(character, system, unit, (character.money?.[unit] ?? 0) + count);
}

/**
 * Spend coins of one unit, and only of that unit: more than the purse holds of it is refused, whatever the rest is
 * worth, because change is made only when the player asks for it (Exchange; ADR 0087 decision 5).
 */
export function planSpendCoins(character: Character, system: GameSystem, unit: string, count: number): PurseWrite {
  const label = unitLabel(system, unit);
  if (!label) return { refused: `"${unit}" is not a coin this game counts.` };
  if (!Number.isInteger(count) || count < 1) return { refused: 'Spend a whole number of coins, 1 or more.' };
  const held = character.money?.[unit] ?? 0;
  if (held < count) {
    return { refused: `The purse holds ${held} ${unit}, fewer than ${count}. Exchange other coins for ${label.toLowerCase()} first.` };
  }
  return planSetCoins(character, system, unit, held - count);
}

/**
 * Exchange `count` coins of one unit for coins of another, at the worths the system's rates give — only when that comes
 * out whole: 10 sp is 1 gp, 15 sp is not, and the sentence says how many to exchange instead.
 */
export function planExchangeCoins(character: Character, system: GameSystem, from: string, count: number, to: string): PurseWrite {
  const worths = currencyWorths(system.currency);
  const fromWorth = worths?.get(from);
  const toWorth = worths?.get(to);
  if (fromWorth === undefined || toWorth === undefined) return { refused: 'Those are not coins this game counts.' };
  if (from === to) return { refused: 'Choose two different coins.' };
  if (!Number.isInteger(count) || count < 1) return { refused: 'Exchange a whole number of coins, 1 or more.' };
  const held = character.money?.[from] ?? 0;
  if (held < count) return { refused: `The purse holds ${held} ${from}, fewer than ${count}.` };
  // Worths are whole numbers of the least unit (core's `currencyWorths`), so this is exact.
  const value = count * fromWorth;
  if (value % toWorth !== 0) {
    // The fewest coins of `from` that make a whole number of `to`.
    const step = toWorth / gcd(fromWorth, toWorth);
    return { refused: `${count} ${from} is not a whole number of ${to}. Exchange a multiple of ${step} ${from}.` };
  }
  const got = value / toWorth;
  return {
    character: setMoney(character, { ...(character.money ?? {}), [from]: held - count, [to]: (character.money?.[to] ?? 0) + got }),
  };
}
