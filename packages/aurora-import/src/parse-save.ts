/**
 * Aurora `.dnd5e` character saves -> a structure, before any interpretation.
 *
 * This file only reads. It does not decide what a decision means, which content it needs, or
 * what Incudo should store — `import-character.ts` does that, and keeping the two apart is
 * what makes the derived blocks usable as an oracle: `<sum>` and `<magic>` are parsed by
 * code that has never seen Incudo's engine.
 *
 * The format is at `version="1.0.3"` and will not change again (ADR 0008), so this is a
 * closed problem. Everything below is present in all eight sample saves unless a comment
 * says otherwise; see docs/AURORA-SAVE-FORMAT.md for what each block is for.
 *
 * Two shapes of `<element>` live in the build tree, and telling them apart is the whole job:
 *
 *     <element type="Race" name="Race" requiredLevel="1" checksum="…" registered="ID_RACE_ELF">
 *     <element type="Racial Trait" name="Keen Senses" id="ID_RACIAL_TRAIT_KEEN_SENSES">
 *
 * The first is a **decision**: the user answered a `<select name="Race">` on the enclosing
 * element. The second is a **grant**: a consequence Aurora wrote down anyway. Only the first
 * is input. Reading the second as input would pin a character to content that has since
 * changed underneath it.
 */

import { parseXml, childrenNamed, firstChild, findFirst, type XmlNode } from './xml.ts';

export interface SaveDiagnostic {
  level: 'error' | 'warning';
  message: string;
  /** Where in the save, as a slash path: `build/elements`. */
  where?: string;
}

/** One `registered=` node: an answer to a `<select>` on the element that encloses it. */
export interface AuroraDecision {
  /** The `<select name="…">` this answers. Aurora keys choices by name, and so does Incudo. */
  ruleName: string;
  /** Element id of the enclosing element — the one whose rules declare the select. */
  ownerId: string;
  /** What was chosen. */
  registered: string;
  /** Aurora's element type for the choice, e.g. "Spell". Informational. */
  type: string;
  /** Disambiguates repeated picks for one select: "Skill Proficiency (Wizard)" 1 and 2. */
  number?: number;
  /** The progression level the select was gated behind. */
  requiredLevel?: number;
  /** Aurora's per-choice guard against the content changing. Recorded, never enforced. */
  checksum?: string;
  /** Aurora marks selects whose picks accumulate into one list. */
  isList?: boolean;
  /** Document order, so a rebuilt choice list keeps the order the user built in. */
  order: number;
}

/**
 * One `<element type="Level">` node: a point of progression, and what it bought.
 *
 * ```xml
 * <element type="Level" name="3" id="ID_LEVEL_3" multiclass="true" starting="true"
 *          class="ID_WOTC_PHB_MULTICLASS_WARLOCK">
 * ```
 */
export interface AuroraLevel {
  /** The level number, from `name=`. */
  at: number;
  /**
   * `class=` — and note it names the **multiclass** element, not the class. Absent on levels
   * taken in the character's first class, which Aurora records only at level 1.
   */
  classRef?: string;
  /** `multiclass="true"`: this level went to something other than the first class. */
  multiclass?: boolean;
  /** `starting="true"`: the level at which that class was first taken. */
  starting?: boolean;
}

/** One `id=` node: something Aurora granted. Derivable, and re-derived rather than trusted. */
export interface AuroraGrant {
  id: string;
  type: string;
  name: string;
  /**
   * Depth in the build tree, 1 for a direct child of `<elements>`.
   *
   * Worth keeping because depth changes what a bare `id=` means. Nested, it is a
   * consequence of a choice above it and gets re-derived. At the top there is nothing above
   * it to be a consequence of, so it is a setting the user turned on.
   */
  depth: number;
  /**
   * The element this one hangs off in the save's tree: the granter, or the choice that led
   * here. Aurora records the whole derivation as a tree, which is worth keeping — it is the
   * only place the *reason* an element is present is written down, and "why did Incudo not
   * derive this" is usually answered by an ancestor rather than by the element itself.
   */
  parentId?: string;
}

/** One `<item>` in `<build><equipment>` — one **instance**, not a reference (ADR 0024). */
export interface AuroraItem {
  /**
   * Aurora's `identifier` GUID. Distinct on every item in every sample save, which is what
   * lets the importer carry an `instanceId` across instead of minting one.
   */
  identifier?: string;
  id: string;
  /**
   * The `name=` attribute: a denormalized copy of the element's own name, and stale in 1 of
   * 42 known cases. The importer deliberately does not carry it — see `details.name`.
   */
  name: string;
  amount?: number;
  equipped?: boolean;
  /** Where it is worn or held: "Primary Hand". */
  location?: string;
  attuned?: boolean;
  /** Magic items attached to this one — a staff with a `<adorner>` enchantment on it. */
  adorners: Array<{ id: string; name: string }>;
  /** `<details>` — the user's own words, as opposed to the denormalized `name=` above. */
  details?: { name?: string; notes?: string };
}

export interface AuroraPortrait {
  /** The path on the machine that made the save. Usually gone; kept for the diagnostic. */
  localPath?: string;
  /** The inline payload, still encoded. Decoding is `import-character.ts`'s job. */
  base64?: string;
}

/** A `<spellcasting>` block out of `<magic>` — numbers Aurora derived, for diffing against. */
export interface AuroraSpellcasting {
  name: string;
  ability?: string;
  /** Spell attack bonus, as Aurora computed it. */
  attack?: number;
  /** Spell save DC, as Aurora computed it. */
  dc?: number;
  /** Element id of the class feature that declares this block. */
  source?: string;
  /** Slots per spell level, index 0 = level 1. Absent levels are 0. */
  slots: number[];
  cantrips: AuroraSpellEntry[];
  spells: AuroraSpellEntry[];
}

export interface AuroraSpellEntry {
  id: string;
  name: string;
  level: number;
  prepared?: boolean;
  alwaysPrepared?: boolean;
  known?: boolean;
}

export interface AuroraSave {
  /** Aurora's save format version. Every sample is "1.0.3". */
  version?: string;
  /** Aurora's denormalized header. Never imported — it is a cache of the derivation. */
  display: Record<string, string>;
  /** `<build><input>`, flattened to `path -> text`: `"backstory"`, `"notes.note.left"`. */
  input: Record<string, string>;
  /** `<build><appearance>`: age, height, weight, eyes, skin, hair, portrait path. */
  appearance: Record<string, string>;
  /** Raw ability scores, lowercased: `{ strength: 8, … }`. Inputs — nothing derives them. */
  abilities: Record<string, number>;
  /** The point-buy budget the user was working to. Informational. */
  availablePoints?: number;
  /** `<elements level-count="8">` — the character's level. */
  levelCount: number;
  /**
   * `rndhp="6,2,3,…"` — hit points rolled per level, in level order starting at level 1.
   * The one thing in the save that genuinely cannot be recomputed (ADR 0007).
   */
  rndhp: number[];
  /**
   * One entry per `<element type="Level">`, in level order — and specifically which class
   * each level was taken in.
   *
   * This is the only record of a multiclass split anywhere in the save, and the importer
   * walked past it until ADR 0015: a `Level` node carries `class=`, `multiclass=` and
   * `starting=` beside the `name=` and `rndhp=` that were being read. A level with no
   * `classRef` belongs to the class chosen at level 1.
   */
  levels: AuroraLevel[];
  decisions: AuroraDecision[];
  grants: AuroraGrant[];
  portrait?: AuroraPortrait;
  /**
   * `<build><equipment>` — items the user put in the character's inventory.
   *
   * Genuine input, and since ADR 0024 `Character.inventory` is where it lands:
   * `import-character.ts`'s `toInventory` maps this across one row per `<item>`. Nothing
   * *derives* from it yet — that is step 3 of docs/INVENTORY-AND-AC-PLAN.md.
   */
  equipment: AuroraItem[];
  /** `<sum>`: every element Aurora's own derivation ended up with. The oracle. */
  sum: string[];
  /** `<sum element-count="…">`, as written. Compared against `sum.length`. */
  sumCount?: number;
  /** `<magic>`: slots, DC and attack bonus Aurora computed. The other half of the oracle. */
  magic: AuroraSpellcasting[];
  /**
   * `<magic multiclass="true" level="N">`: the *shared* caster level Aurora computed, on a character
   * with more than one casting source and nowhere else. It is the only place the file records the
   * multiclass pool: each `<spellcasting>` block's own `<slots>` is that source's own table (a Wizard 4's
   * 4/3 and an Arcane Trickster 4's 3 sit side by side in one save), and the pool's slot counts are
   * derived from this number and never written down. ADR 0041.
   */
  magicLevel?: number;
  /**
   * `<sources><restricted>` — what the user turned OFF. Read so it can be inverted; never
   * stored. See `import-character.ts`, and the note in docs/AURORA-SAVE-FORMAT.md about
   * why a blocklist is the wrong thing to keep.
   */
  restrictedSources: string[];
  restrictedElements: string[];
  diagnostics: SaveDiagnostic[];
}

/**
 * The extension of an Aurora save is its system id, so a `.dnd5e` file is a D&D 5e
 * character. Exported because callers dispatch on it and hard-coding "dnd5e" in three
 * places is how that stops being true.
 */
export function systemIdForSaveExtension(fileName: string): string | undefined {
  const match = /\.([A-Za-z0-9_-]+)$/.exec(fileName);
  return match ? match[1]!.toLowerCase() : undefined;
}

export function parseAuroraSave(xml: string): AuroraSave {
  const diagnostics: SaveDiagnostic[] = [];
  const doc = parseXml(xml);
  const root = findFirst(doc, 'character');

  if (!root) {
    diagnostics.push({ level: 'error', message: 'No <character> element: this is not an Aurora save.' });
    return empty(diagnostics);
  }

  const version = root.attrs['version'];
  if (version && version !== '1.0.3') {
    // Not an error. 1.0.3 is the last version Aurora ever wrote, so anything else is either
    // older (and probably still readable) or not Aurora's.
    diagnostics.push({
      level: 'warning',
      message: `Save format version "${version}"; every known Aurora save is 1.0.3. Reading it anyway.`,
    });
  }

  const build = firstChild(root, 'build');
  if (!build) {
    diagnostics.push({ level: 'error', message: 'No <build> block: there is nothing to import.' });
    return empty(diagnostics, version);
  }

  const elementsNode = firstChild(build, 'elements');
  const tree = elementsNode ? readElementsTree(elementsNode, diagnostics) : emptyTree();

  return {
    version,
    display: flattenText(firstChild(root, 'display-properties'), ['portrait']),
    input: flattenText(firstChild(build, 'input')),
    appearance: flattenText(firstChild(build, 'appearance')),
    abilities: readAbilities(firstChild(build, 'abilities')),
    availablePoints: numberOrUndefined(firstChild(build, 'abilities')?.attrs['available-points']),
    levelCount: numberOrUndefined(elementsNode?.attrs['level-count']) ?? tree.levelCount,
    rndhp: tree.rndhp,

    levels: tree.levels,
    decisions: tree.decisions,
    grants: tree.grants,
    portrait: readPortrait(firstChild(root, 'display-properties')),
    equipment: readEquipment(firstChild(build, 'equipment')),
    sum: readSum(firstChild(build, 'sum')),
    sumCount: numberOrUndefined(firstChild(build, 'sum')?.attrs['element-count']),
    magic: readMagic(firstChild(build, 'magic')),
    ...readMagicLevel(firstChild(build, 'magic')),
    ...readRestricted(firstChild(root, 'sources')),
    diagnostics,
  };
}

// --- the build tree --------------------------------------------------------

interface ElementsTree {
  decisions: AuroraDecision[];
  grants: AuroraGrant[];
  rndhp: number[];
  levels: AuroraLevel[];
  levelCount: number;
}

function emptyTree(): ElementsTree {
  return { decisions: [], grants: [], rndhp: [], levels: [], levelCount: 0 };
}

/**
 * Walk `<build><elements>`, separating decisions from grants.
 *
 * The owner of a decision is the nearest enclosing element that has an identity — either a
 * granted element (`id=`) or another decision (`registered=`, whose identity is what was
 * chosen). Sub Race hangs off the Racial Trait that offers it; the Elf's customized ability
 * increase hangs off `ID_RACE_ELF`, which is itself a decision. Both are the element whose
 * `<rules>` declare the `<select>`, which is what makes the pair
 * `<owner>/select:<name>` the key Incudo already uses.
 */
function readElementsTree(node: XmlNode, diagnostics: SaveDiagnostic[]): ElementsTree {
  const tree = emptyTree();
  let order = 0;

  const walk = (current: XmlNode, ownerId: string | undefined, depth: number): void => {
    for (const child of childrenNamed(current, 'element')) {
      const type = child.attrs['type'] ?? '';
      const name = child.attrs['name'] ?? '';
      const registered = child.attrs['registered'];
      const id = child.attrs['id'];

      if (registered) {
        if (!ownerId) {
          // A decision with nothing above it has no select to answer. Never seen in the
          // sample saves; say so rather than inventing an owner.
          diagnostics.push({
            level: 'warning',
            message: `Choice "${name}" (${registered}) is not inside any element, so there is no rule it answers. Skipped.`,
            where: 'build/elements',
          });
        } else {
          tree.decisions.push({
            ruleName: name,
            ownerId,
            registered,
            type,
            number: numberOrUndefined(child.attrs['number']),
            requiredLevel: numberOrUndefined(child.attrs['requiredLevel']),
            checksum: child.attrs['checksum'],
            isList: child.attrs['isList'] === 'true' ? true : undefined,
            order: order++,
          });
        }
        walk(child, registered, depth + 1);
        continue;
      }

      if (id) {
        tree.grants.push({ id, type, name, depth, parentId: ownerId });
        if (type === 'Level') {
          const at = numberOrUndefined(name) ?? 0;
          tree.levelCount = Math.max(tree.levelCount, at);
          const rndhp = child.attrs['rndhp'];
          // Aurora writes the whole 20-entry roll list once, on the level it was rolled at.
          if (rndhp && !tree.rndhp.length) tree.rndhp = parseRndhp(rndhp, diagnostics);
          // Which class this level was taken in — the only record of a multiclass split in
          // the whole save, and read by nothing until ADR 0015.
          if (at > 0) {
            tree.levels.push({
              at,
              classRef: child.attrs['class'] || undefined,
              multiclass: child.attrs['multiclass'] === 'true' ? true : undefined,
              starting: child.attrs['starting'] === 'true' ? true : undefined,
            });
          }
        }
        walk(child, id, depth + 1);
        continue;
      }

      diagnostics.push({
        level: 'warning',
        message: `An <element type="${type}"> has neither id nor registered, so it is neither a choice nor a grant. Skipped.`,
        where: 'build/elements',
      });
    }
  };

  walk(node, undefined, 1);
  return tree;
}

/** `"6,2,3,1"` -> `[6, 2, 3, 1]`. Non-numeric entries are dropped with a diagnostic. */
function parseRndhp(raw: string, diagnostics: SaveDiagnostic[]): number[] {
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      diagnostics.push({
        level: 'warning',
        message: `Ignored "${trimmed}" in rndhp; it is not a number. That level's hit points will need re-entering.`,
        where: 'build/elements',
      });
      continue;
    }
    out.push(value);
  }
  return out;
}

// --- the flat blocks -------------------------------------------------------

function readAbilities(node: XmlNode | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!node) return out;
  for (const child of node.children) {
    const value = Number(child.text.trim());
    if (Number.isFinite(value)) out[child.name.toLowerCase()] = value;
  }
  return out;
}

function readPortrait(display: XmlNode | undefined): AuroraPortrait | undefined {
  const node = display ? firstChild(display, 'portrait') : undefined;
  if (!node) return undefined;
  const localPath = firstChild(node, 'local')?.text.trim();
  const base64 = firstChild(node, 'base64')?.text.trim();
  if (!localPath && !base64) return undefined;
  return { localPath: localPath || undefined, base64: base64 || undefined };
}

function readEquipment(node: XmlNode | undefined): AuroraItem[] {
  if (!node) return [];
  const items: AuroraItem[] = [];
  for (const child of childrenNamed(node, 'item')) {
    const id = child.attrs['id'];
    if (!id) continue;
    const equipped = firstChild(child, 'equipped');
    items.push({
      identifier: child.attrs['identifier'] || undefined,
      id,
      name: child.attrs['name'] ?? '',
      amount: numberOrUndefined(child.attrs['amount']),
      equipped: equipped?.text.trim() === 'true' ? true : undefined,
      location: equipped?.attrs['location'],
      attuned: firstChild(child, 'attunement')?.text.trim() === 'true' ? true : undefined,
      adorners: readAdorners(firstChild(child, 'items')),
      details: readItemDetails(firstChild(child, 'details')),
    });
  }
  return items;
}

/**
 * `<details><name>` and `<details><notes>`.
 *
 * Aurora writes both tags on every item and leaves them holding nothing but a newline and a
 * tab, so whitespace-only has to mean absent — otherwise 44 of the 45 sample items would
 * arrive carrying an indented empty string. `card=` is display state and is not read.
 */
function readItemDetails(node: XmlNode | undefined): { name?: string; notes?: string } | undefined {
  if (!node) return undefined;
  const name = firstChild(node, 'name')?.text.trim();
  const notes = firstChild(node, 'notes')?.text.trim();
  if (!name && !notes) return undefined;
  return { name: name || undefined, notes: notes || undefined };
}

function readAdorners(node: XmlNode | undefined): Array<{ id: string; name: string }> {
  if (!node) return [];
  return childrenNamed(node, 'adorner')
    .filter((a) => a.attrs['id'])
    .map((a) => ({ id: a.attrs['id']!, name: a.attrs['name'] ?? '' }));
}

function readSum(node: XmlNode | undefined): string[] {
  if (!node) return [];
  const ids: string[] = [];
  for (const child of childrenNamed(node, 'element')) {
    const id = child.attrs['id'];
    if (id) ids.push(id);
  }
  return ids;
}

/** `{ magicLevel }` when the save records a shared caster level, and nothing when it does not. */
function readMagicLevel(node: XmlNode | undefined): { magicLevel?: number } {
  if (node?.attrs['multiclass'] !== 'true') return {};
  const level = numberOrUndefined(node.attrs['level']);
  return level === undefined ? {} : { magicLevel: level };
}

function readMagic(node: XmlNode | undefined): AuroraSpellcasting[] {
  if (!node) return [];
  return childrenNamed(node, 'spellcasting').map((block) => {
    const slotsNode = firstChild(block, 'slots');
    const slots: number[] = [];
    for (let level = 1; level <= 9; level++) {
      slots.push(numberOrUndefined(slotsNode?.attrs[`s${level}`]) ?? 0);
    }
    return {
      name: block.attrs['name'] ?? '',
      ability: block.attrs['ability'],
      attack: numberOrUndefined(block.attrs['attack']),
      dc: numberOrUndefined(block.attrs['dc']),
      source: block.attrs['source'],
      slots,
      cantrips: readSpells(firstChild(block, 'cantrips')),
      spells: readSpells(firstChild(block, 'spells')),
    };
  });
}

function readSpells(node: XmlNode | undefined): AuroraSpellEntry[] {
  if (!node) return [];
  const out: AuroraSpellEntry[] = [];
  for (const child of childrenNamed(node, 'spell')) {
    const id = child.attrs['id'];
    if (!id) continue;
    out.push({
      id,
      name: child.attrs['name'] ?? '',
      level: numberOrUndefined(child.attrs['level']) ?? 0,
      prepared: child.attrs['prepared'] === 'true' ? true : undefined,
      alwaysPrepared: child.attrs['always-prepared'] === 'true' ? true : undefined,
      known: child.attrs['known'] === 'true' ? true : undefined,
    });
  }
  return out;
}

function readRestricted(node: XmlNode | undefined): {
  restrictedSources: string[];
  restrictedElements: string[];
} {
  const restricted = node ? firstChild(node, 'restricted') : undefined;
  if (!restricted) return { restrictedSources: [], restrictedElements: [] };
  return {
    restrictedSources: childrenNamed(restricted, 'source')
      .map((n) => n.attrs['id'])
      .filter((id): id is string => !!id),
    restrictedElements: childrenNamed(restricted, 'element')
      .map((n) => n.text.trim())
      .filter((id) => id !== ''),
  };
}

/**
 * A block of leaf text nodes as `path -> text`, dotted where it nests: `notes.left`.
 *
 * Aurora's `<input>` and `<appearance>` are a flat bag of user-typed strings with a couple
 * of two-level exceptions, and none of it is ever read by a rule. Flattening keeps it that
 * way — `Character.freeform` is `Record<string, string>` precisely so this stuff cannot
 * grow structure the engine might start depending on.
 */
function flattenText(node: XmlNode | undefined, skip: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  if (!node) return out;

  const walk = (current: XmlNode, prefix: string): void => {
    for (const child of current.children) {
      if (skip.includes(child.name)) continue;
      const key = prefix ? `${prefix}.${child.name}` : child.name;
      // `<note column="left">` and `<set name="…">` distinguish siblings by attribute.
      const qualifier = child.attrs['column'] ?? child.attrs['name'] ?? child.attrs['ability'];
      const qualified = qualifier ? `${key}.${qualifier}` : key;
      if (child.children.length) {
        walk(child, qualified);
        continue;
      }
      const text = child.text.trim();
      if (text) out[qualified] = text;
    }
  };

  walk(node, '');
  return out;
}

function numberOrUndefined(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function empty(diagnostics: SaveDiagnostic[], version?: string): AuroraSave {
  return {
    version,
    display: {},
    input: {},
    appearance: {},
    abilities: {},
    levelCount: 0,
    rndhp: [],

    levels: [],
    decisions: [],
    grants: [],
    equipment: [],
    sum: [],
    magic: [],
    restrictedSources: [],
    restrictedElements: [],
    diagnostics,
  };
}
