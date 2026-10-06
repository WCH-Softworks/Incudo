/**
 * Which slot of a `select` pool each recorded pick fills — ADR 0096.
 *
 * A pool is every same-named `select` of one element (docs/AURORA-FORMAT.md), and its rules are not
 * interchangeable: a wizard's first six spellbook entries are 1st level and the later ones are not, an Arcane
 * Trickster's school-restricted spells and its any-school ones share a name. A pick fits a rule when the rule would
 * have offered it; a rule of `number` n is n slots. The picks are placed as a matching of picks to slots, so the
 * order they were made in does not decide which slots are left: taking the any-school spell first leaves the
 * restricted slots open, and taking a restricted one first leaves the any-school slot open.
 *
 * Picks are placed in the order recorded, each by an augmenting path, so a pick once placed stays placed and an
 * earlier pick is never displaced by a later one that could not otherwise go anywhere. That is a maximum matching
 * (Kuhn's algorithm, which never unmatches a matched vertex), and the unplaced picks are the latest ones it could
 * not fit.
 *
 * No game noun: rules, picks and a predicate. The engine supplies what "fits" means.
 */

export interface PoolSlots {
  /**
   * For each pick, in the order recorded: the index of the rule whose slot it fills, or `undefined` when no
   * assignment places it.
   */
  placed: (number | undefined)[];
  /**
   * The rules a further pick could go into: a rule with a free slot, or one whose slot holds a pick that could move
   * to such a rule. In rule order. What a pool still open offers is the union of these rules' candidates, and
   * nothing else: an element only a full rule accepts would displace no one.
   */
  available: number[];
  /** The rules with a slot no pick fills, in rule order: where the next pick lands when it fits any of them. */
  free: number[];
  /** Slots in all, the sum of the rules' `number`. */
  capacity: number;
}

/**
 * Places `picks` into the slots of `rules`. `fits(rule, pick)` says whether rule `rule` would accept pick `pick`
 * (both indexes). `numbers[rule]` is how many slots the rule has.
 */
export function placePicks(
  numbers: readonly number[],
  pickCount: number,
  fits: (rule: number, pick: number) => boolean,
): PoolSlots {
  const capacity = numbers.reduce((sum, n) => sum + Math.max(0, n), 0);
  // Which picks each rule holds, and which rule each pick is in.
  const holds: number[][] = numbers.map(() => []);
  const placed: (number | undefined)[] = new Array(pickCount).fill(undefined);
  const edges: number[][] = [];
  for (let pick = 0; pick < pickCount; pick++) {
    const out: number[] = [];
    for (let rule = 0; rule < numbers.length; rule++) if (fits(rule, pick)) out.push(rule);
    edges.push(out);
  }

  const augment = (pick: number, seen: Set<number>): boolean => {
    for (const rule of edges[pick]!) {
      if (seen.has(rule)) continue;
      seen.add(rule);
      if (holds[rule]!.length < numbers[rule]!) {
        holds[rule]!.push(pick);
        placed[pick] = rule;
        return true;
      }
      for (const other of holds[rule]!) {
        if (augment(other, seen)) {
          holds[rule]!.splice(holds[rule]!.indexOf(other), 1);
          holds[rule]!.push(pick);
          placed[pick] = rule;
          return true;
        }
      }
    }
    return false;
  };
  for (let pick = 0; pick < pickCount; pick++) augment(pick, new Set());

  // Rules a further pick could go into: those with room, then any rule holding a pick that fits one already found.
  const reachable = new Set<number>();
  const frontier: number[] = [];
  numbers.forEach((n, rule) => {
    if (holds[rule]!.length < n) {
      reachable.add(rule);
      frontier.push(rule);
    }
  });
  while (frontier.length) {
    const rule = frontier.pop()!;
    for (let pick = 0; pick < pickCount; pick++) {
      const at = placed[pick];
      if (at === undefined || reachable.has(at) || !edges[pick]!.includes(rule)) continue;
      reachable.add(at);
      frontier.push(at);
    }
  }

  const free = numbers.flatMap((n, rule) => (holds[rule]!.length < n ? [rule] : []));
  return { placed, available: [...reachable].sort((a, b) => a - b), free, capacity };
}
