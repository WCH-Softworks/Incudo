/**
 * Dice notation, parsed and rolled — the one piece of machinery a rolled budget needs.
 *
 * **Why this is here and not in `core`.** ADR 0019 is explicit: "Core does not roll and must
 * never learn how — a roll is an input precisely because it has no formula, and an engine that
 * could produce one could silently reroll it." A derivation runs on every keystroke, so a
 * roller reachable from `deriveCharacter` would eventually be called by one, and the character's
 * scores would change while the user looked at them.
 *
 * So rolling lives above the engine, where it can only be reached by something a user did. It is
 * not in a shell either: `"4d6dl1"` is declared by `systems/<id>/system.json`
 * (`GenerationMethodDef.dice`), which makes parsing it a rule about the game, and
 * docs/CODE-REUSE-POLICY.md rule 1 says a rule about the game may not live in a component. A
 * shell that knew 4d6-drop-lowest meant four six-sided dice would be the same bug as a shell
 * that hardcoded 27 points.
 *
 * The randomness is injected for the same reason the fetcher is (rule 1): a test needs a
 * sequence it chose, and nothing here should care where the numbers come from.
 *
 * What is deliberately *not* supported: arithmetic between dice terms, exploding dice,
 * rerolls, success counting. The corpus declares exactly one notation, `4d6dl1`. Everything
 * below is the smallest grammar that covers it and its obvious neighbours, and an unparseable
 * notation is **reported rather than guessed at** — which is the house rule (ADR 0005) and the
 * difference between a user seeing "Incudo cannot read this" and a user silently getting 1d6.
 */

/** One dice term, already understood. `4d6dl1` is `{ count: 4, sides: 6, dropLowest: 1 }`. */
export interface DiceSpec {
  /** How many dice to roll. */
  count: number;
  /** Faces per die. */
  sides: number;
  /** Discard this many of the lowest results before summing. */
  dropLowest: number;
  /** Discard this many of the highest results before summing. */
  dropHighest: number;
  /** A flat term added after the dice, e.g. the `+2` of `2d6+2`. */
  modifier: number;
}

export type DiceParse =
  | { ok: true; spec: DiceSpec }
  | { ok: false; reason: string };

const PATTERN =
  /^([0-9]+)?d([0-9]+)((?:(?:dl|dh|kl|kh)[0-9]+)*)([+-][0-9]+)?$/i;
const KEEP_OR_DROP = /(dl|dh|kl|kh)([0-9]+)/gi;

/**
 * Read a notation string. `NdS`, then any number of `dlK` / `dhK` / `klK` / `khK`, then an
 * optional `+K` or `-K`.
 *
 * Keep is expressed as a drop, because they are the same instruction counted from opposite
 * ends: `4d6kh3` keeps the best three of four, which is `4d6dl1`. Normalising here means the
 * roller has one rule to implement and one to test.
 */
export function parseDice(notation: string): DiceParse {
  const text = notation.trim();
  if (!text) return { ok: false, reason: 'empty dice notation' };

  const match = PATTERN.exec(text);
  if (!match) return { ok: false, reason: `cannot read the dice notation "${notation}"` };

  const count = match[1] === undefined ? 1 : Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[4] === undefined ? 0 : Number(match[4]);

  if (count < 1) return { ok: false, reason: `"${notation}" rolls no dice` };
  if (sides < 2) return { ok: false, reason: `"${notation}" has a die with fewer than two faces` };

  let dropLowest = 0;
  let dropHighest = 0;
  for (const term of (match[3] ?? '').matchAll(KEEP_OR_DROP)) {
    const kind = term[1]!.toLowerCase();
    const n = Number(term[2]);
    if (kind === 'dl') dropLowest += n;
    else if (kind === 'dh') dropHighest += n;
    // Keeping the highest three of four is dropping the lowest one — the same instruction
    // counted from the other end.
    else if (kind === 'kh') dropLowest += Math.max(0, count - n);
    else dropHighest += Math.max(0, count - n);
  }

  if (dropLowest + dropHighest >= count) {
    return { ok: false, reason: `"${notation}" drops every die it rolls` };
  }

  return { ok: true, spec: { count, sides, dropLowest, dropHighest, modifier } };
}

/** What one roll produced, in enough detail for a view to show its working. */
export interface DiceRoll {
  /** The sum of the kept dice plus the modifier. This is what gets recorded. */
  total: number;
  /** Every die, in the order it came up. */
  rolled: number[];
  /** The dice that were dropped, as values. */
  dropped: number[];
}

/**
 * Roll a spec once.
 *
 * `random` returns a number in [0, 1) — `Math.random` by default, a chosen sequence in a test.
 * Callers in this package always pass the builder's own, so a test can produce a known set of
 * scores without stubbing a global.
 */
export function rollDice(spec: DiceSpec, random: () => number = Math.random): DiceRoll {
  const rolled: number[] = [];
  for (let i = 0; i < spec.count; i += 1) {
    rolled.push(1 + Math.floor(random() * spec.sides));
  }

  const ascending = [...rolled].sort((a, b) => a - b);
  const dropped = [
    ...ascending.slice(0, spec.dropLowest),
    ...(spec.dropHighest > 0 ? ascending.slice(ascending.length - spec.dropHighest) : []),
  ];
  const kept = ascending.slice(spec.dropLowest, ascending.length - spec.dropHighest);

  return {
    total: kept.reduce((sum, die) => sum + die, 0) + spec.modifier,
    rolled,
    dropped,
  };
}
