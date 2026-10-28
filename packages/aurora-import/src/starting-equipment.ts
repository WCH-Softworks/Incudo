/**
 * Starting equipment read out of a class's or a background's prose — ADR 0119 decisions 3 and 9.
 *
 * Aurora's content states starting equipment only as prose (ADR 0087 measured it: no rule of a class or a background
 * grants or offers an item). The converter reads that prose once and writes what it finds on the element as Incudo
 * content (`Element.startingEquipment`): the packages a character may take, each a list of lines, a line one bundle or a
 * choice among bundles. Three shapes are read, the three the corpus writes:
 *
 *  - a 2014 class: "You start with the following equipment…", then one line per row, `(a) … or (b) …` a choice;
 *  - a 2024 class or background: "Choose A or B: (A) …; or (B) …", each letter a package of its own;
 *  - a 2014 background: "Equipment: …", one package.
 *
 * Each part of a line ("two handaxes", "a quiver of 20 arrows", "15 gp") is matched to an item by name, preferring the
 * element's own book, then any book of its edition, then any book. What names a kind of item ("any simple weapon",
 * "a musical instrument", "a holy symbol") is a pick among the items content says are that kind. What matches nothing
 * is a pending item (decision 9): its words are kept, and the user resolves it on Build.
 *
 * A pattern is written here only where it rescues a good share of what a plain lookup misses (decision 9); the test that
 * measures it is `tools/verify`'s `starting-equipment-prose.test.ts`.
 */

import type { Element, ElementIndex, StartingBundle, StartingLine, StartingOption, StartingPick } from '@incudo/core';

const ITEM_TYPES = ['Item', 'Weapon', 'Armor'];

const NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20,
};

const COIN_UNITS: Record<string, string> = { cp: 'cp', sp: 'sp', ep: 'ep', gp: 'gp', pp: 'pp' };

/** The words of a name as a lookup key: lowercased, straight quotes, no articles, no punctuation but what parts names. */
export function nameKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\(if proficient\)|\((?:one )?of your choice\)|\(same as above\)|,? of your choice$|\(matching [^)]*\)| chosen for .*$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;:]+$/, '')
    .trim()
    .replace(/^(?:a|an|the|some|any|one) /, '')
    // "a set of common clothes", "a pair of boots": the measure is not the item (decision 9's first pattern).
    .replace(/^(?:set|pair) of /, '')
    .trim();
}

/**
 * Patterns a plain lookup misses and that each rescue a good share of the misses (decision 9), tried in order once a
 * name and its plural and inverted forms have found nothing. Counted by `patternRescues`, which the measurement prints.
 */
const PATTERNS: Array<[name: string, rewrite: (key: string) => string | undefined]> = [
  // "leather armor" is the armour content calls "Leather".
  ['an armour named without "armor"', (key) => (key.endsWith(' armor') ? key.slice(0, -' armor'.length) : undefined)],
  // "a bottle of black ink": what the measure holds.
  ['what a measure holds', (key) => key.match(/^(?:bottle|flask|vial|jug|pot|bag|case|tin|box|sack) of (.+)$/)?.[1]],
  // "druidic focus (quarterstaff)", "arcane focus (crystal)": the item the brackets name.
  ['the item in brackets', (key) => key.match(/\(([^)]+)\)$/)?.[1]],
  // "a book of lore", "a scroll of pedigree": the item, and what it is of.
  ['an item and what it is of', (key) => key.match(/^([a-z' ]+?) of .+$/)?.[1]],
  // "a belt pouch", "a blank book", "black ink": the item without its first word.
  ['an item without its first word', (key) => (key.includes(' ') ? key.slice(key.indexOf(' ') + 1) : undefined)],
];

/** How many lookups each pattern rescued, for the measurement. */
export const patternRescues = new Map<string, number>();

function singular(key: string): string[] {
  const out: string[] = [];
  if (key.endsWith('ies')) out.push(`${key.slice(0, -3)}y`);
  if (key.endsWith('es')) out.push(key.slice(0, -2));
  if (key.endsWith('s')) out.push(key.slice(0, -1));
  return out;
}

/** The book an element is printed in tells its edition: Aurora's 2024 books carry "(2024)" in their name. */
function edition(book: string): string {
  return /\(2024\)|2024/.test(book) ? '2024' : '2014';
}

/** Items by every key a line may name them by. */
export class ItemNames {
  private readonly byKey = new Map<string, Element[]>();
  readonly all: Element[];
  /** Every element by id, for a pick that reads what an item's setter points at. */
  readonly byId = new Map<string, Element>();

  constructor(elements: Iterable<Element>) {
    const every = [...elements];
    for (const element of every) this.byId.set(element.id, element);
    this.all = every.filter((element) => ITEM_TYPES.includes(element.type));
    for (const item of this.all) {
      const key = nameKey(item.name);
      for (const variant of nameVariants(key)) {
        const list = this.byKey.get(variant);
        if (list) list.push(item);
        else this.byKey.set(variant, [item]);
      }
    }
  }

  /**
   * The item a name means; `undefined` when nothing is called that. Every reading is tried among the items of the
   * element's own edition before any other book's: a 2014 "20 bolts" is the 2014 "Crossbow Bolt", not the 2024 "Bolt".
   */
  find(text: string, book: string): Element | undefined {
    return this.search(text, book, true) ?? this.search(text, book, false);
  }

  private search(text: string, book: string, sameEdition: boolean): Element | undefined {
    const key = nameKey(text);
    const direct = this.lookup(key, book, sameEdition);
    if (direct) return direct;
    // Each pattern once, and then again over what an earlier one wrote ("a bottle of black ink" is a measure, then a word).
    let current = key;
    for (const [name, rewrite] of PATTERNS) {
      const next = rewrite(current);
      if (!next) continue;
      const found = this.lookup(next, book, sameEdition);
      if (found) {
        patternRescues.set(name, (patternRescues.get(name) ?? 0) + 1);
        return found;
      }
      current = next;
    }
    if (!sameEdition) return undefined;
    // "20 bolts": the one item of the book's edition whose name ends in what the line says ("Crossbow Bolt").
    const tail = [key, ...singular(key)];
    const stem = (item: Element): string => nameKey(item.name).replace(/ \([^)]*\)$/, '');
    // An inverted name ("Case, Crossbow Bolt") is the case, not the bolt.
    const ending = this.all.filter(
      (item) => edition(item.source) === edition(book) && !stem(item).includes(',') && tail.some((t) => stem(item).endsWith(` ${t}`)),
    );
    const named = new Set(ending.map(stem));
    if (named.size === 1) {
      patternRescues.set('the one item whose name ends in it', (patternRescues.get('the one item whose name ends in it') ?? 0) + 1);
      return nearest(ending, book);
    }
    return undefined;
  }

  private lookup(key: string, book: string, sameEdition: boolean): Element | undefined {
    for (const candidate of [key, ...singular(key), ...nameVariants(key)]) {
      const found = this.byKey.get(candidate)?.filter((item) => !sameEdition || edition(item.source) === edition(book));
      if (found?.length) return nearest(found, book);
    }
    return undefined;
  }
}

/** "clothes, fine" is "fine clothes" too, and "book (prayers)" is "book": the shapes content names items in. */
function nameVariants(key: string): string[] {
  const out = [key];
  const comma = key.match(/^([^,()]+), ([^,()]+)$/);
  if (comma) out.push(`${comma[2]} ${comma[1]}`);
  const paren = key.match(/^(.+?) \(([^)]*)\)$/);
  if (paren) out.push(paren[1]!);
  return out;
}

function nearest(items: Element[], book: string): Element {
  return items.find((item) => item.source === book) ?? items.find((item) => edition(item.source) === edition(book)) ?? items[0]!;
}

/** A kind of item a line names rather than one item: the picks content lets a converter find the members of. */
function kindPick(text: string, count: number, names: ItemNames, book: string): StartingPick | undefined {
  const key = nameKey(text).replace(/^other /, '');
  const weapon = key.match(/^(simple|martial)(?: (melee|ranged))? weapons?$/);
  if (weapon) {
    const kinds = weapon[2] ? [weapon[2].toUpperCase()] : ['MELEE', 'RANGED'];
    return {
      label: text.trim(),
      ...(count > 1 ? { count } : {}),
      types: ['Weapon'],
      supports: kinds.map((kind) => `ID_INTERNAL_WEAPON_CATEGORY_${weapon[1]!.toUpperCase()}_${kind}`).join('||'),
    };
  }
  const inEdition = (item: Element): boolean => edition(item.source) === edition(book);
  const from = (match: (item: Element) => boolean): StartingPick | undefined => {
    const ids = names.all.filter((item) => inEdition(item) && match(item)).map((item) => item.id);
    return ids.length ? { label: text.trim(), ...(count > 1 ? { count } : {}), from: ids } : undefined;
  };
  if (/^musical instruments?$/.test(key)) return from((item) => item.setters['category']?.value === 'Musical Instruments');
  // Artisan's tools are told apart by the proficiency they are used with, which content tags "Artisan tools".
  if (/^artisan's tools$/.test(key)) {
    return from((item) => {
      const proficiency = names.byId.get(item.setters['proficiency']?.value ?? '');
      return !!proficiency?.supports.some((tag) => tag.toLowerCase() === 'artisan tools');
    });
  }
  if (/^gaming sets?$/.test(key)) return from((item) => item.setters['type']?.value === 'Gaming Set');
  // A focus is told apart only by what its own description calls it: content writes no setter for holy, arcane or druidic.
  const focus = key.match(/^(holy symbol|arcane focus|druidic focus)$/);
  if (focus) {
    const words = focus[1]!;
    return from((item) => item.setters['category']?.value === 'Spellcasting Focus' && (item.description ?? '').toLowerCase().includes(words));
  }
  return undefined;
}

/** One part of a line, read: an item, a pick, coins, or what is left pending. */
function readPart(raw: string, names: ItemNames, book: string, into: StartingBundle): void {
  let text = raw.replace(/\(if proficient\)/gi, '').replace(/\s+/g, ' ').trim().replace(/^and /, '').replace(/[.;]+$/, '').trim();
  if (!text) return;
  // "a pouch containing 15 gp", "a quiver of 20 arrows": a container and what is in it, each a part of its own. Never
  // inside brackets, and only when either half reads as something: "a lucky charm such as a small stone with a hole in
  // the center" is one thing, and stays one pending line rather than two.
  const holding =
    text.match(/^([^(]+?) (?:containing|holding|with) (.+)$/i) ?? text.match(/^(an? (?:quiver|case|pouch|bag)) of (\d+ .+)$/i);
  if (holding) {
    const halves: StartingBundle = {};
    readPart(holding[1]!, names, book, halves);
    readPart(holding[2]!, names, book, halves);
    if (halves.items || halves.picks || halves.coins) {
      for (const item of halves.items ?? []) (into.items ??= []).push(item);
      for (const pick of halves.picks ?? []) (into.picks ??= []).push(pick);
      for (const line of halves.pending ?? []) (into.pending ??= []).push(line);
      for (const [unit, count] of Object.entries(halves.coins ?? {})) into.coins = { ...(into.coins ?? {}), [unit]: (into.coins?.[unit] ?? 0) + count };
      return;
    }
  }
  const coins = text.match(/^(\d+) ?(cp|sp|ep|gp|pp)\b/i);
  if (coins) {
    const unit = COIN_UNITS[coins[2]!.toLowerCase()]!;
    into.coins = { ...(into.coins ?? {}), [unit]: (into.coins?.[unit] ?? 0) + Number(coins[1]) };
    return;
  }
  let count = 1;
  // "any two simple weapons": "any" before the number.
  text = text.replace(/^(?:any|your choice of) (?=\d|two|three|four|five)/i, '');
  const number = text.match(/^(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twenty) (.+)$/i);
  // "50 feet of silk rope" is a length, not fifty of something: it is read whole.
  if (number && !/^(?:feet|foot|yards?|pounds?)\b/i.test(number[2]!)) {
    const n = Number(number[1]) || NUMBERS[number[1]!.toLowerCase()] || 1;
    count = n;
    text = number[2]!;
  }
  text = text.replace(/^(?:any|other|another) /i, '');
  const words = raw.trim().replace(/[.;]+$/, '');
  const pick = kindPick(text, count, names, book);
  if (pick) {
    (into.picks ??= []).push({ ...pick, label: words });
    return;
  }
  // "a set of artisan's tools or a musical instrument": one pick among both kinds. (One of two items, "an ink pen or
  // quill", rescued 2 lookups when measured, too small a share to codify: decision 9. They are pending.)
  const either = text.match(/^(.+?) or (?:an? )?(.+)$/);
  if (either) {
    const kinds = [kindPick(either[1]!, count, names, book), kindPick(either[2]!, count, names, book)];
    if (kinds[0]?.from && kinds[1]?.from) {
      patternRescues.set('one of two kinds', (patternRescues.get('one of two kinds') ?? 0) + 1);
      (into.picks ??= []).push({ label: words, ...(count > 1 ? { count } : {}), from: [...kinds[0].from, ...kinds[1].from] });
      return;
    }
  }
  // "Parchment (10 sheets)": a quantity written after the name.
  const after = text.match(/^(.+?) \((\d+)(?: [a-z ]+)?\)$/i);
  const found = names.find(text, book) ?? (after ? names.find(after[1]!, book) : undefined);
  if (found) {
    const quantity = after && !names.find(text, book) ? count * Number(after[2]) : count;
    (into.items ??= []).push(quantity > 1 ? { id: found.id, quantity } : { id: found.id });
    return;
  }
  (into.pending ??= []).push(count > 1 ? { text: text.trim(), quantity: count } : { text: raw.trim().replace(/[.;]+$/, '') });
}

/** The parts of a list: "a, b, and c", "a and b". */
function parts(text: string): string[] {
  return text
    .replace(/,? and /g, ', ')
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function bundle(text: string, names: ItemNames, book: string): StartingBundle {
  const out: StartingBundle = {};
  for (const part of parts(text)) readPart(part, names, book, out);
  return out;
}

/** "(a) x or (b) y, or (c) z" as its alternatives, or `undefined` for a plain line. */
function alternatives(line: string): string[] | undefined {
  if (!/\(\s*a\s*\)/i.test(line)) return undefined;
  return line
    .split(/\(\s*[a-c]\s*\)/i)
    .map((part) => part.replace(/,?\s+or\s*$/i, '').replace(/,\s*$/, '').trim())
    .filter(Boolean);
}

/** The text of a description, block by block. */
function textOf(description: string | undefined): string {
  return (description ?? '')
    .replace(/<\/(p|li|div|h\d|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*/g, '\n');
}

/** Bundles with nothing left in them are not written. */
function nonEmpty(b: StartingBundle): boolean {
  return !!(b.items?.length || b.picks?.length || b.pending?.length || b.coins);
}

/**
 * Read an element's starting equipment out of its description. `undefined` when the description states none in a shape
 * this reads.
 */
export function readStartingEquipment(element: Element, names: ItemNames): StartingOption[] | undefined {
  const text = textOf(element.description);
  const book = element.source;

  // 2024: "Choose A or B: (A) …; or (B) …", each letter a package.
  const row = text.match(/Choose A(?:, B)*,? (?:or|and) [A-C]:?\s*([\s\S]*?\([A-C]\)[\s\S]*?)(?:\n|$)/);
  if (row) {
    const options: StartingOption[] = [];
    for (const piece of row[1]!.split(/;?\s*(?:or )?\(([A-C])\)\s*/).slice(1).reduce<string[][]>((acc, part, i) => {
      if (i % 2 === 0) acc.push([part]);
      else acc[acc.length - 1]!.push(part);
      return acc;
    }, [])) {
      const [letter, body = ''] = piece;
      const b = bundle(body.replace(/;\s*$/, ''), names, book);
      const { coins, ...rest } = b;
      options.push({
        id: letter!.toLowerCase(),
        label: `Option ${letter}`,
        ...(nonEmpty(rest) ? { lines: [rest] } : {}),
        ...(coins ? { coins } : {}),
      });
    }
    return options.length ? options : undefined;
  }

  // 2014 class: one line per row after "You start with the following equipment…".
  const start = text.match(/You start with the following equipment[^\n]*\n([\s\S]*?)(?:\n[A-Z][A-Z ’']{3,}\n|\nIf you forgo|\nAlternatively|$)/);
  if (start) {
    const lines: StartingLine[] = [];
    let coins: Record<string, number> | undefined;
    // A row whose (a) and (b) the description puts on lines of their own is joined back.
    const rows = start[1]!.replace(/\n(?=\(\s*[b-c]\s*\))/gi, ' ').replace(/\(\s*a\s*\)\n/gi, '(a) ').split('\n').map((line) => line.trim()).filter(Boolean);
    for (const row of rows) {
      const choices = alternatives(row);
      if (choices && choices.length > 1) {
        lines.push({ choose: choices.map((choice) => bundle(choice, names, book)).filter(nonEmpty) });
        continue;
      }
      const b = bundle(choices?.[0] ?? row, names, book);
      if (b.coins) coins = { ...(coins ?? {}), ...b.coins };
      const { coins: _coins, ...rest } = b;
      if (nonEmpty(rest)) lines.push(rest);
    }
    return lines.length || coins ? [{ id: 'equipment', label: 'Starting equipment', ...(lines.length ? { lines } : {}), ...(coins ? { coins } : {}) }] : undefined;
  }

  // 2014 background: "Equipment: …".
  const list = text.match(/Equipment:\s*([^\n]+)/);
  if (list) {
    const b = bundle(list[1]!, names, book);
    const { coins, ...rest } = b;
    if (!nonEmpty(rest) && !coins) return undefined;
    return [{ id: 'equipment', label: 'Equipment', ...(nonEmpty(rest) ? { lines: [rest] } : {}), ...(coins ? { coins } : {}) }];
  }
  return undefined;
}

/** Every class's and background's starting equipment, read and written on the element. */
export function withStartingEquipment(elements: Element[], index: ElementIndex | Iterable<Element>, types: readonly string[] = ['Class', 'Background']): Element[] {
  const names = new ItemNames('all' in index ? index.all() : index);
  return elements.map((element) => {
    if (!types.includes(element.type)) return element;
    const options = readStartingEquipment(element, names);
    return options ? { ...element, startingEquipment: options } : element;
  });
}
