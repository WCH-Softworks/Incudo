/**
 * The bag, as a player manages it at any point — ADR 0098.
 *
 * Everything the inventory editor shows and writes is worked out here, under `node --test`: what the bag holds and where
 * each entry is, what each gives the character (read off the derivation, never worked out again), what can be added,
 * bought, attached and opened, and every write, each a pure function returning the character it gives or a sentence
 * saying why it was not made. The builder publishes the state and routes its methods here; the panes of both shells
 * render it and compute nothing.
 *
 * Nothing here names a game. The item types, the setter an adornment names its host's type by, where a price is written
 * and the slots are the kind's `inventory`; the coins are the system's `currency`.
 */
import {
  adornedName,
  matchesSupports,
  newInstanceId,
  parseSupports,
  removeInventoryEntry,
  setInventoryEntry,
  statReferences,
  type Character,
  type DerivedCharacter,
  type Element,
  type ElementId,
  type ElementIndex,
  type GameSystem,
  type InventoryEntry,
  type ResolvedCharacterKind,
} from '@incudo/core';

import { planSpendCoins, purseRows, type PurseRow } from './money.ts';
import { packageUntouched } from './starting-equipment.ts';
import type { SheetView } from './sheet.ts';

// --- what is read ------------------------------------------------------------------------------------------------------

/** What the editor's state and writes read. */
export interface InventoryContext {
  system: GameSystem;
  kind: ResolvedCharacterKind;
  character: Character;
  derived: DerivedCharacter;
  /** The builder's index: the offered view (ADR 0049) for what is offered, every id answered for what is held. */
  elements: ElementIndex;
  /** The character's own sheet, whose rows say what an item moves. */
  sheet: SheetView;
}

/** One entry of the bag, as the editor shows it. */
export interface InventoryRow {
  instanceId: string;
  elementId: ElementId;
  /** The name shown: the user's own, else the adornment's naming setter filled, else "Host (Adornment)", else the item's. */
  name: string;
  /** The item's own name, or its id when nothing declares it. */
  itemName: string;
  /** The user's own name for it, when there is one. */
  userName?: string;
  /** Whether no loaded or embedded content declares the item: it is kept, and nothing about it can be read. */
  missing: boolean;
  quantity: number;
  equipped: boolean;
  /** Where it is: the slot it fills ("Armor"), where it is worn ("Rings"), "Carried", or why it fills nothing. */
  where: string;
  /** Present when the item or its adornment requires attunement. */
  attunement?: { attuned: boolean; note?: string };
  /** The adornment attached to it, when there is one. */
  adornment?: { elementId: ElementId; name: string };
  /** Whether a magic item made from items like this one could be attached: some adorner admits it and none is attached. */
  canAdorn: boolean;
  /** Whether content lists what it holds, so it can be opened into its contents. */
  canOpen: boolean;
  notes?: string;
  /** What it gives the character, in a sentence; empty when there is nothing to say. */
  gives: string;
  /** When a starting package added it and can still be taken back: what editing it does to that. */
  fromPackage?: string;
  /** The price content states, worded ("15 gp"), when there is one. */
  price?: string;
}

export interface InventoryState {
  /** The entries the editor edits, in bag order. */
  rows: InventoryRow[];
  /** "Attuned to 2 of 3 items", and whether that is over; absent for a kind that has no attunement. */
  attunement?: { text: string; over: boolean };
  /** Every unit the system declares, most worth first, with what the character holds. */
  purse: PurseRow[];
  /** When a starting package's coins can still be taken back: what spending below them does. */
  purseNote?: string;
  /** Whether anything can be added: the kind's inventory names types. */
  canAdd: boolean;
}

export const INVENTORY_HEADING = 'Inventory';
export const INVENTORY_HINT =
  'Everything the character carries. Equip an item to wear or wield it; only what is equipped counts toward its numbers, ' +
  'and an item that requires attunement counts only once attuned. Buying pays the price in its own coin: exchange coins ' +
  'first when the purse holds others.';

// --- reading ------------------------------------------------------------------------------------------------------------

function setterOf(element: Element, name: string) {
  const lower = name.toLowerCase();
  return Object.entries(element.setters).find(([key]) => key.toLowerCase() === lower)?.[1];
}

/** The price an item states, when it states one in a unit the system counts and above 0 (ADR 0098 decision 3). */
export function itemPrice(element: Element, kind: ResolvedCharacterKind, system: GameSystem): { amount: number; unit: string } | undefined {
  const def = kind.inventory?.price;
  if (!def) return undefined;
  const set = setterOf(element, def.setter);
  const unit = set?.attrs?.[def.unitAttribute]?.trim();
  const amount = Number(set?.value.trim());
  if (!set || !unit || !system.currency?.[unit] || !Number.isInteger(amount) || amount <= 0) return undefined;
  return { amount, unit };
}

/** "15 gp". */
function priceText(price: { amount: number; unit: string } | undefined): string | undefined {
  return price ? `${price.amount} ${price.unit}` : undefined;
}

/** Whether an element or its adornment needs attunement, by the kind's attunement setter. */
function requiresAttunement(elements: readonly Element[], kind: ResolvedCharacterKind): boolean {
  const def = kind.inventory?.attunement;
  if (!def) return false;
  const requires = def.requires.trim().toLowerCase();
  return elements.some((e) => setterOf(e, def.setter)?.value.trim().toLowerCase() === requires);
}

/** Whether an entry's item or its adornment requires attunement: only then does its attunement count, or show. */
export function entryNeedsAttunement(entry: InventoryEntry, elements: Pick<ElementIndex, 'get'>, kind: ResolvedCharacterKind): boolean {
  const items = [entry.elementId, ...(entry.adorners ?? []).map((a) => a.elementId)].flatMap((id) => elements.get(id) ?? []);
  return requiresAttunement(items, kind);
}

/** The type of item an item is made from, when its adorn setter names one of the kind's inventory types. */
function madeFrom(element: Element, kind: ResolvedCharacterKind): string | undefined {
  const setter = kind.inventory?.adornSetter;
  if (!setter) return undefined;
  const value = setterOf(element, setter)?.value.trim().toLowerCase();
  if (!value) return undefined;
  return (kind.inventory?.types ?? []).find((type) => type.toLowerCase() === value);
}

/**
 * Whether an adornment admits a host: the host is of the type the adornment is made from, and the adornment's setter
 * named after that type, read as a filter, admits it by a tag, its id, a setter value or its own name (content names
 * hosts by name: "Plate", "Longsword"). Absent, any host of the type.
 */
export function adornmentAdmits(adornment: Element, host: Element, kind: ResolvedCharacterKind): boolean {
  const type = madeFrom(adornment, kind);
  if (!type || host.type !== type || madeFrom(host, kind)) return false;
  const filter = setterOf(adornment, type.toLowerCase())?.value;
  if (!filter?.trim()) return true;
  return matchesSupports(parseSupports(filter), {
    tags: new Set([...host.supports.map((s) => s.toLowerCase()), host.name.trim().toLowerCase()]),
    setterValues: new Set(Object.values(host.setters).map((s) => s.value.trim().toLowerCase())),
    id: host.id,
    resolve: () => undefined,
  });
}

/**
 * What can be added: every element of the kind's inventory types, through the offered view, by name. Hidden is not a
 * reason to leave one out: the 2024 mounts are goods. Asked for on request: it is thousands of items.
 */
export function inventoryOffer(kind: ResolvedCharacterKind, elements: ElementIndex): ElementId[] {
  const found = new Map<ElementId, Element>();
  for (const type of kind.inventory?.types ?? []) {
    for (const element of elements.byType(type)) found.set(element.id, element);
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map((e) => e.id);
}

/** One group of the add list: its name as content writes it, and its items in the offer's order. */
export interface OfferGroup {
  label: string;
  options: ElementId[];
}

/** The first entry of a grouped add list: everything, for a search that does not know the group. */
export const ALL_ITEMS_LABEL = 'All items';
/** The group of items that write no value for the kind's `groupSetter`. */
export const OTHER_ITEMS_LABEL = 'Other';

/**
 * The add list in groups — ADR 0117: "All items" first, then one group per value of the kind's `groupSetter`, by name,
 * with "Other" last for items that write none. Values are joined ignoring case and surrounding space, under the first
 * spelling met. Empty when the kind names no setter: the list is not grouped.
 */
export function inventoryOfferGroups(
  kind: ResolvedCharacterKind,
  offer: readonly ElementId[],
  elements: Pick<ElementIndex, 'get'>,
): OfferGroup[] {
  const setter = kind.inventory?.groupSetter;
  if (!setter) return [];
  const groups = new Map<string, OfferGroup>();
  const other: ElementId[] = [];
  for (const id of offer) {
    const value = elements.get(id)?.setters[setter]?.value?.trim();
    if (!value) {
      other.push(id);
      continue;
    }
    const key = value.toLowerCase();
    const group = groups.get(key);
    if (group) group.options.push(id);
    else groups.set(key, { label: value, options: [id] });
  }
  const named = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  return [
    { label: ALL_ITEMS_LABEL, options: [...offer] },
    ...named,
    ...(other.length ? [{ label: OTHER_ITEMS_LABEL, options: other }] : []),
  ];
}

/** What a group's entry in the list says: "Potions (99)". */
export function offerGroupLine(group: OfferGroup): string {
  return `${group.label} (${group.options.length})`;
}

/** What a candidate is, beside its name in the picker: "15 gp · requires attunement · made from Armor". */
export function inventoryOfferNote(element: Element, kind: ResolvedCharacterKind, system: GameSystem): string {
  const parts = [priceText(itemPrice(element, kind, system)) ?? 'no price'];
  if (requiresAttunement([element], kind)) parts.push('requires attunement');
  const from = madeFrom(element, kind);
  if (from) parts.push(`attached to ${indefinite(from.toLowerCase())}`);
  return parts.join(' · ');
}

function indefinite(noun: string): string {
  return `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;
}

/** The adornments that could be attached to an entry's item, through the offered view, by name. */
export function adornmentOffer(context: Pick<InventoryContext, 'kind' | 'elements' | 'character'>, instanceId: string): ElementId[] {
  const entry = context.character.inventory?.find((e) => e.instanceId === instanceId);
  const host = entry ? context.elements.get(entry.elementId) : undefined;
  if (!host || !context.kind.inventory?.adornSetter) return [];
  const found: Element[] = [];
  for (const type of context.kind.inventory.types ?? []) {
    for (const element of context.elements.byType(type)) {
      if (adornmentAdmits(element, host, context.kind)) found.push(element);
    }
  }
  return [...new Map(found.map((e) => [e.id, e])).values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((e) => e.id);
}

/** The name an entry is shown by (ADR 0098 decision 3): the user's, else what its adornment names it, else the item's. */
export function entryName(entry: InventoryEntry, elements: Pick<ElementIndex, 'get'>, kind: ResolvedCharacterKind): string {
  const own = entry.name?.trim();
  if (own) return own;
  const host = elements.get(entry.elementId);
  if (!host) return entry.elementId;
  const nameSetter = kind.attacks?.nameSetter;
  for (const adornment of entry.adorners ?? []) {
    const element = elements.get(adornment.elementId);
    if (!element) continue;
    const template = nameSetter ? setterOf(element, nameSetter)?.value : undefined;
    const named = template ? adornedName(template, host, element) : undefined;
    return named ?? `${host.name} (${element.name})`;
  }
  return host.name;
}

/** A sheet row an item moves: its label, and the section it is in. */
interface MovedRow {
  section: string;
  label: string;
}

/**
 * For every element, the sheet rows it moves: a row whose stat it contributes to non-zero, directly or through a stat
 * the kind's formulas read, followed by name as ADR 0095 follows them and never evaluated.
 */
function rowsMoved(sheet: SheetView, derived: DerivedCharacter, kind: ResolvedCharacterKind): Map<ElementId, MovedRow[]> {
  const derives = new Map(kind.stats.map((def) => [def.name.toLowerCase(), def.derive]));
  const out = new Map<ElementId, MovedRow[]>();
  for (const section of sheet.sections) {
    for (const row of section.rows) {
      const ids = new Set<ElementId>();
      const seen = new Set<string>();
      const walk = (stat: string): void => {
        const key = stat.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        for (const c of derived.stats.get(key)?.contributions ?? []) if (c.value !== 0) ids.add(c.from);
        for (const ref of statReferences(derives.get(key))) walk(ref);
      };
      walk(row.stat);
      for (const id of ids) {
        const rows = out.get(id) ?? [];
        if (!rows.some((r) => r.section === section.label && r.label === row.label)) rows.push({ section: section.label, label: row.label });
        out.set(id, rows);
      }
    }
  }
  return out;
}

/** "A, B and C", or "A, B, C and 4 more" past `most`. */
function listed(names: readonly string[], most = 5): string {
  const shown = names.length > most ? [...names.slice(0, most - 1), `${names.length - most + 1} more`] : [...names];
  return shown.length < 2 ? (shown[0] ?? '') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** Row labels that more than one section of the sheet shows ("Strength" is a score and a saving throw). */
function ambiguousLabels(sheet: SheetView): Set<string> {
  const sections = new Map<string, Set<string>>();
  for (const section of sheet.sections) {
    for (const row of section.rows) sections.set(row.label, (sections.get(row.label) ?? new Set()).add(section.label));
  }
  return new Set([...sections].filter(([, where]) => where.size > 1).map(([label]) => label));
}

/**
 * The rows an item moves, in the sheet's order: "Armor Class and Speed", or, where a label is shown in more than one
 * section, that section's rows under its name, "Armor Class; Saving Throws: Strength, Dexterity and Constitution".
 */
function movedText(rows: readonly MovedRow[], ambiguous: ReadonlySet<string>): string {
  const bySection = new Map<string, string[]>();
  for (const row of rows) bySection.set(row.section, [...(bySection.get(row.section) ?? []), row.label]);
  const plain: string[] = [];
  const named: string[] = [];
  for (const [section, labels] of bySection) {
    if (labels.some((label) => ambiguous.has(label))) named.push(`${section}: ${listed(labels, 6)}`);
    else plain.push(...labels);
  }
  return [...(plain.length ? [listed(plain)] : []), ...named].join('; ');
}

interface GivesReading {
  moved: Map<ElementId, MovedRow[]>;
  ambiguous: Set<string>;
  /** The types some section of the character's sheet lists: a granted element of one of these is named. */
  listedTypes: Set<string>;
}

/** What one entry gives the character, in a sentence (ADR 0098 decision 7). */
function gives(entry: InventoryEntry, items: readonly Element[], context: InventoryContext, reading: GivesReading): string {
  const { derived, kind } = context;
  const attack = derived.attacks.some((a) => a.instanceId === entry.instanceId);
  const hasRules = items.some((e) => e.rules.length > 0);
  if (!entry.equipped) {
    if (attack) return hasRules ? 'An attack, under Attacks. Gives nothing else until equipped.' : 'An attack, under Attacks.';
    return hasRules ? 'Gives nothing until equipped.' : '';
  }
  const working = items.filter((e) => !derived.equipment.suppressed.has(e.id));
  const unattuned = items.length > working.length;
  const rows: MovedRow[] = [];
  for (const e of working) {
    for (const row of reading.moved.get(e.id) ?? []) {
      if (!rows.some((r) => r.section === row.section && r.label === row.label)) rows.push(row);
    }
  }
  const named: string[] = [];
  let unnamed = 0;
  for (const e of working) {
    for (const rule of e.rules) {
      if (rule.kind !== 'grant' || !derived.elementIds.has(rule.id)) continue;
      const granted = derived.elements.find((held) => held.id === rule.id);
      if (!granted) continue;
      if (reading.listedTypes.has(granted.type)) {
        const name = granted.sheet?.alt || granted.sheet?.name || granted.name;
        if (!named.includes(name)) named.push(name);
      } else unnamed++;
    }
  }
  const parts: string[] = [];
  if (rows.length) parts.push(`Moves ${movedText(rows, reading.ambiguous)}.`);
  if (named.length) parts.push(`Gives ${listed(unnamed ? [...named, 'something the sheet does not list'] : named)}.`);
  else if (unnamed) parts.push('Gives something the sheet does not list.');
  if (attack) parts.push('An attack, under Attacks.');
  if (unattuned) {
    parts.push(working.length && (rows.length || named.length || unnamed) ? 'Its magic gives nothing until attuned.' : 'Gives nothing until attuned.');
  }
  if (!parts.length) parts.push(kind.inventory ? 'Gives this character nothing.' : '');
  return parts.join(' ');
}

/** Where an equipped entry is, from the resolved slots: the slot it fills, the engine's sentence, or where it is worn. */
function whereOf(entry: InventoryEntry, element: Element | undefined, context: InventoryContext): string {
  if (!entry.equipped) return 'Carried';
  const { derived, kind } = context;
  const issue = derived.equipment.issues.find((i) => i.instanceId === entry.instanceId && i.code !== 'unattuned');
  if (issue) return issue.message;
  const slots = kind.inventory?.slots ?? [];
  for (const occupant of derived.equipment.occupants.values()) {
    if (occupant.instanceId === entry.instanceId) return slots.find((s) => s.id === occupant.slotId)?.label ?? occupant.slotId;
  }
  const slotId = entry.slot ?? (element && kind.inventory ? setterOf(element, kind.inventory.slotSetter)?.value.trim() : undefined);
  return slots.find((s) => s.id === slotId)?.label ?? 'Equipped';
}

/** The record of the starting package that added an entry, while it can still be taken back. */
function packageOf(character: Character, instanceId: string) {
  return character.startingEquipment?.find((record) => record.entries?.some((e) => e.instanceId === instanceId));
}

function packageName(elements: Pick<ElementIndex, 'get'>, forId: ElementId): string {
  return elements.get(forId)?.name ?? forId;
}

/** The editor as it stands. Absent for a kind that declares no inventory. */
export function inventoryState(context: InventoryContext): InventoryState | undefined {
  const { kind, character, derived, elements, system } = context;
  const def = kind.inventory;
  if (!def) return undefined;
  const reading: GivesReading = {
    moved: rowsMoved(context.sheet, derived, kind),
    ambiguous: ambiguousLabels(context.sheet),
    listedTypes: new Set(kind.sheet.sections.flatMap((s) => s.types ?? [])),
  };
  const rows: InventoryRow[] = [];
  for (const entry of character.inventory ?? []) {
    const element = elements.get(entry.elementId);
    const adornments = (entry.adorners ?? []).flatMap((a) => elements.get(a.elementId) ?? []);
    const items = element ? [element, ...adornments] : adornments;
    const record = packageOf(character, entry.instanceId);
    const adornment = entry.adorners?.[0];
    const needs = requiresAttunement(items, kind);
    const price = element ? priceText(itemPrice(element, kind, system)) : undefined;
    const row: InventoryRow = {
      instanceId: entry.instanceId,
      elementId: entry.elementId,
      name: entryName(entry, elements, kind),
      itemName: element?.name ?? entry.elementId,
      ...(entry.name?.trim() ? { userName: entry.name } : {}),
      missing: !element,
      quantity: entry.quantity ?? 1,
      equipped: entry.equipped === true,
      where: whereOf(entry, element, context),
      ...(needs
        ? {
            attunement: {
              attuned: entry.attuned === true,
              ...(entry.attuned && !entry.equipped ? { note: 'Attuned, and counts only while equipped.' } : {}),
            },
          }
        : {}),
      ...(adornment ? { adornment: { elementId: adornment.elementId, name: elements.get(adornment.elementId)?.name ?? adornment.elementId } } : {}),
      canAdorn: !adornment && element !== undefined && adornmentOffer(context, entry.instanceId).length > 0,
      canOpen: (element?.contents?.length ?? 0) > 0,
      ...(entry.notes?.trim() ? { notes: entry.notes } : {}),
      gives: gives(entry, items, context, reading),
      ...(record && packageUntouched(character, record)
        ? {
            fromPackage:
              `From ${packageName(elements, record.for)}'s starting equipment. Removing it, changing how many or attaching ` +
              'an item to it means that starting equipment can no longer be taken back.',
          }
        : {}),
      ...(price ? { price } : {}),
    };
    rows.push(row);
  }

  const attunementDef = def.attunement;
  let attunement: InventoryState['attunement'];
  if (attunementDef?.countStat && attunementDef.maxStat) {
    const count = derived.stats.get(attunementDef.countStat.toLowerCase())?.value ?? 0;
    const max = derived.stats.get(attunementDef.maxStat.toLowerCase())?.value ?? 0;
    const over = count > max;
    attunement = { text: `Attuned to ${count} of ${max} item${max === 1 ? '' : 's'}${over ? ': over the limit' : ''}.`, over };
  }

  const coined = (character.startingEquipment ?? []).filter((r) => r.coins && Object.keys(r.coins).length && packageUntouched(character, r));
  return {
    rows,
    ...(attunement ? { attunement } : {}),
    purse: system.currency ? purseRows(character, system) : [],
    ...(coined.length
      ? {
          purseNote:
            `Coins from ${listed(coined.map((r) => `${packageName(elements, r.for)}'s`))} starting equipment are in the purse. ` +
            'Spending below them means that starting equipment can no longer be taken back.',
        }
      : {}),
    canAdd: (def.types ?? []).length > 0,
  };
}

// --- the writes --------------------------------------------------------------------------------------------------------

/** A write to the bag: the character it gives, or a sentence saying why it was not made. */
export type InventoryWrite = { character: Character } | { refused: string };

function entryOf(character: Character, instanceId: string): InventoryEntry | undefined {
  return character.inventory?.find((e) => e.instanceId === instanceId);
}

const NO_SUCH_ENTRY: InventoryWrite = { refused: 'That item is no longer in the bag.' };

/**
 * Add an item, carried, at the end of the bag; with `buy`, also pay its price in its own coin from the purse, refused
 * when it has no price or the purse holds too few of that coin (change is made only by Exchange).
 */
export function planAddItem(
  context: Pick<InventoryContext, 'kind' | 'elements' | 'character' | 'system'>,
  elementId: ElementId,
  options: { buy?: boolean; newId?: () => string } = {},
): InventoryWrite {
  const { kind, elements, system } = context;
  const element = elements.get(elementId);
  if (!element || !(kind.inventory?.types ?? []).includes(element.type)) return { refused: 'That is not an item this character can carry.' };
  let character = context.character;
  if (options.buy) {
    const price = itemPrice(element, kind, system);
    if (!price) return { refused: `${element.name} has no price in your content. Add it instead.` };
    const paid = planSpendCoins(character, system, price.unit, price.amount);
    if ('refused' in paid) return { refused: `${element.name} costs ${price.amount} ${price.unit}. ${paid.refused}` };
    character = paid.character;
  }
  const entry: InventoryEntry = { instanceId: (options.newId ?? newInstanceId)(), elementId };
  return { character: setInventoryEntry(character, entry) };
}

/** Take an entry out of the bag, adornment and all. */
export function planRemoveItem(character: Character, instanceId: string): InventoryWrite {
  if (!entryOf(character, instanceId)) return NO_SUCH_ENTRY;
  return { character: removeInventoryEntry(character, instanceId) };
}

/** Write one entry back with a change, in place. */
function edit(character: Character, instanceId: string, change: (entry: InventoryEntry) => InventoryEntry): InventoryWrite {
  const entry = entryOf(character, instanceId);
  if (!entry) return NO_SUCH_ENTRY;
  const next = change(entry);
  if (JSON.stringify(next) === JSON.stringify(entry)) return { character };
  return { character: setInventoryEntry(character, next) };
}

/** Drop the optional fields a change emptied, so an entry records only what it says. */
function without(entry: InventoryEntry, key: keyof InventoryEntry): InventoryEntry {
  const { [key]: _gone, ...rest } = entry;
  return rest as InventoryEntry;
}

/** How many identical copies the entry stands for: a whole number from 1. */
export function planSetQuantity(character: Character, instanceId: string, quantity: number): InventoryWrite {
  if (!Number.isInteger(quantity) || quantity < 1) return { refused: 'How many is a whole number, 1 or more. Remove the item to have none.' };
  return edit(character, instanceId, (entry) => (quantity === 1 ? without(entry, 'quantity') : { ...entry, quantity }));
}

/** Wear or wield it, or carry it. Where it goes is the kind's slots', read back on the next derivation. */
export function planEquipItem(character: Character, instanceId: string, equipped: boolean): InventoryWrite {
  return edit(character, instanceId, (entry) => (equipped ? { ...entry, equipped: true } : without(entry, 'equipped')));
}

/** Attune to it, or end the attunement. Never refused for the limit: going over is reported (ADR 0023). */
export function planAttuneItem(character: Character, instanceId: string, attuned: boolean): InventoryWrite {
  return edit(character, instanceId, (entry) => (attuned ? { ...entry, attuned: true } : without(entry, 'attuned')));
}

/** The user's own name for this one; blank goes back to the item's. */
export function planRenameItem(character: Character, instanceId: string, name: string): InventoryWrite {
  return edit(character, instanceId, (entry) => (name.trim() ? { ...entry, name } : without(entry, 'name')));
}

/** Notes on this one, kept as written; blank removes them. */
export function planItemNotes(character: Character, instanceId: string, notes: string): InventoryWrite {
  return edit(character, instanceId, (entry) => (notes.trim() ? { ...entry, notes } : without(entry, 'notes')));
}

/** Whether an entry records nothing but its element: moving it onto a host loses nothing anyone wrote. */
function isBare(entry: InventoryEntry): boolean {
  return (entry.quantity ?? 1) === 1 && !entry.equipped && !entry.attuned && !entry.slot && !entry.adorners?.length && !entry.name?.trim() && !entry.notes?.trim();
}

/**
 * Attach a magic item to a host: one the host admits, to a host with none attached. A bare entry of it carried in the bag
 * is moved onto the host; otherwise it is taken from content.
 */
export function planAttachItem(
  context: Pick<InventoryContext, 'kind' | 'elements' | 'character'>,
  instanceId: string,
  adornmentId: ElementId,
): InventoryWrite {
  const entry = entryOf(context.character, instanceId);
  if (!entry) return NO_SUCH_ENTRY;
  if (entry.adorners?.length) return { refused: 'Something is already attached to it. Detach it first.' };
  const host = context.elements.get(entry.elementId);
  const adornment = context.elements.get(adornmentId);
  if (!host || !adornment || !adornmentAdmits(adornment, host, context.kind)) {
    return { refused: `${adornment?.name ?? 'That'} cannot be attached to ${host?.name ?? 'this item'}.` };
  }
  let character = context.character;
  const loose = character.inventory?.find((e) => e.elementId === adornmentId && e.instanceId !== instanceId && isBare(e));
  if (loose) character = removeInventoryEntry(character, loose.instanceId);
  return { character: setInventoryEntry(character, { ...entry, adorners: [{ elementId: adornmentId }] }) };
}

/** Detach what is attached to an entry. It goes nowhere: an adornment is never an instance of its own (ADR 0024). */
export function planDetachItem(character: Character, instanceId: string): InventoryWrite {
  return edit(character, instanceId, (entry) => without(entry, 'adorners'));
}

/**
 * Open one of an entry into what its item holds: each line a new carried entry with its amount, in content's order,
 * the entry's quantity one less (removed at one). An id nothing loaded declares is left out and named in `missing`.
 */
export function planOpenItem(
  context: Pick<InventoryContext, 'elements' | 'character'>,
  instanceId: string,
  newId: () => string = newInstanceId,
): { character: Character; missing: string[] } | { refused: string } {
  const entry = entryOf(context.character, instanceId);
  if (!entry) return NO_SUCH_ENTRY as { refused: string };
  const element = context.elements.get(entry.elementId);
  const contents = element?.contents ?? [];
  if (!contents.length) return { refused: `Your content does not say what ${element?.name ?? 'this item'} holds.` };
  const quantity = entry.quantity ?? 1;
  let character =
    quantity > 1
      ? setInventoryEntry(context.character, quantity === 2 ? without(entry, 'quantity') : { ...entry, quantity: quantity - 1 })
      : removeInventoryEntry(context.character, instanceId);
  const missing: string[] = [];
  for (const line of contents) {
    if (!context.elements.get(line.id)) {
      missing.push(line.id);
      continue;
    }
    character = setInventoryEntry(character, { instanceId: newId(), elementId: line.id, ...(line.quantity && line.quantity > 1 ? { quantity: line.quantity } : {}) });
  }
  return { character, missing };
}

/** The sentence after an Open that left lines out. */
export function openMissingNote(count: number): string {
  return `${count} item${count === 1 ? '' : 's'} it holds ${count === 1 ? 'is' : 'are'} not in any loaded content and ${count === 1 ? 'was' : 'were'} left out.`;
}
