/**
 * An Aurora save -> an Incudo `Character`.
 *
 * `parse-save.ts` reads the file; this decides what any of it means. The split matters:
 * `<sum>` and `<magic>` are read by code that has never seen the engine, so they stay usable
 * as an independent oracle (`verify-character.ts`).
 *
 * What comes across, and what does not:
 *
 * | Aurora                      | Incudo                | why                              |
 * |-----------------------------|-----------------------|----------------------------------|
 * | `registered=` nodes         | `choices`             | the only real input in the file  |
 * | `<abilities>`               | `baseStats`           | ADR 0014                         |
 * | `<equipment>`               | `inventory`           | ADR 0024                         |
 * | `rndhp`                     | `rolls`               | a die roll has no formula        |
 * | `<input>` / `<appearance>`  | `freeform`            | the rules never read it          |
 * | `<display-properties>` b64  | `assets/portrait.png` | bytes, never base64 (ADR 0007)   |
 * | `<sources><restricted>`     | inverted, then thrown | a blocklist is the wrong keeping |
 * | `<magic>` `prepared=` flags  | `prepared`            | a chosen list has no formula (ADR 0046) |
 * | `id=` nodes, `<sum>`, the rest of `<magic>` | **nothing** | derived; re-derived instead |
 *
 * The last row is the interesting one. (The one exception in `<magic>` is the `prepared` flag: which spells
 * a player put on a list is an input, and for a whole-list preparer it is written nowhere else.) Aurora wrote its own answer into every save, and the
 * temptation is to import it and be sure of matching. Importing it would mean a character that
 * can never be corrected when content is fixed, and would throw away the one free oracle this
 * project gets (ADR 0008). So the derived blocks are read, kept out of the character, and used
 * to check the engine instead.
 */

import {
  createCharacter,
  type AdvancementEntry,
  type Character,
  type Choice,
  type Element,
  type ElementId,
  type ElementIndex,
  type InventoryEntry,
  type SourceRef,
} from '@incudo/core';
import { decodeBase64, imageExtension } from './base64.ts';
import { canonicalizeSaveIds } from './canonical-ids.ts';
import { REPEATABLE_SETTER } from './generated-elements.ts';
import type { AuroraItem, AuroraSave, SaveDiagnostic } from './parse-save.ts';

export interface ImportCharacterOptions {
  /**
   * Content to resolve ids against. Optional: without it the character still imports, and the
   * things that need content — the source allowlist, the "does this id exist" check — are
   * reported as unavailable rather than guessed at.
   */
  index?: ElementIndex;
  /** Which of the system's kinds this becomes. Aurora only ever made player characters. */
  kind?: string;
  /** The system id. Defaults to the one the file extension names — `.dnd5e` -> `dnd5e`. */
  systemId?: string;
  /** Recorded as the content source this character came from, if the caller knows it. */
  source?: SourceRef;
  /** Fixed id and timestamps, so a test can import the same file twice and get one answer. */
  id?: string;
  now?: string;
  /** Base name for the portrait file. Defaults to `portrait`. */
  portraitName?: string;
}

export interface ImportedCharacter {
  character: Character;
  /**
   * Elements this save names that the loaded content does not declare, synthesized from
   * what the save records about them.
   *
   * `generated-elements.ts` covers the ids Aurora generates that *content* references, and
   * those are a fixed list. Saves reveal a second, open-ended family: one element per class
   * per ability-score-improvement level (`ID_INTERNAL_CLASS_FEATURE_FEAT_4_WIZARD`,
   * `…ASI_8_CLERIC`), which cannot be enumerated in advance because the set of classes is
   * content, not code. `improvement-options.ts` now generates these *with* their rules whenever
   * the content that asks for them is loaded (ADR 0035), so what is synthesized here is what is
   * left: an option for a class whose content is not in the index this save was imported against.
   *
   * They are only synthesized for ids in Aurora's own `ID_INTERNAL_` namespace, and only
   * from the type and name the save itself records — nothing is invented, and an id outside
   * that namespace is reported as missing content instead. They carry no rules, so they
   * restore the character's shape without asserting mechanics nobody wrote down.
   *
   * Layer these over the content index before deriving, and pass them to the packer, or the
   * character will report them as unresolved.
   */
  generated: Element[];
  /** Container-relative path -> bytes. Ready to hand to `packCharacterContainer`. */
  assets: Map<string, Uint8Array>;
  /**
   * Ids to embed beyond what the character reaches on its own — `collectCharacterContent`'s
   * `extraIds`. This is Aurora's own `<sum>`: every element *its* derivation ended up with.
   * Embedding that set means the save carries what Aurora used even where Incudo's engine
   * would not reach it, so the differential verification still has both sides to compare
   * after the original `.dnd5e` is gone.
   */
  extraIds: ElementId[];
  diagnostics: SaveDiagnostic[];
}

/**
 * Aurora's element types that carry a `<select>` whose name Incudo keys on. Nothing here
 * enumerates D&D nouns — the names come from the save.
 */
export function importAuroraCharacter(
  parsed: AuroraSave,
  options: ImportCharacterOptions = {},
): ImportedCharacter {
  // Aurora matches ids ignoring case and the engine does not, so the save is respelled to the
  // content's before anything reads an id from it.
  const { save, changed } = canonicalizeSaveIds(parsed, options.index);
  const diagnostics: SaveDiagnostic[] = [...save.diagnostics];
  if (changed) {
    diagnostics.push({
      level: 'warning',
      message: `${changed} id(s) in the save are spelled with different capitals than the loaded content and were matched ignoring case, as Aurora does.`,
      where: 'build/elements',
    });
  }
  const systemId = options.systemId ?? 'dnd5e';
  const kind = options.kind ?? 'pc';

  const character = createCharacter(systemId, kind, {
    name: save.input['name'] || save.display['name'] || 'Imported Character',
    progress: save.levelCount || 1,
  });
  if (options.id) character.id = options.id;
  if (options.now) {
    character.createdAt = options.now;
    character.updatedAt = options.now;
  }

  const generated = synthesizeGenerated(save, options.index, diagnostics);
  const known = new Set(generated.map((e) => e.id));

  character.choices = toChoices(save, options.index, known, diagnostics);
  character.baseStats = { ...save.abilities };
  const advancement = toAdvancement(save, options.index, diagnostics);
  if (advancement) character.advancement = advancement;
  character.rolls = toRolls(save, advancement);
  const inventory = toInventory(save, options.index, known, diagnostics);
  if (inventory) character.inventory = inventory;
  const prepared = toPrepared(save);
  if (prepared) character.prepared = prepared;
  character.freeform = toFreeform(save);

  const { assets, assetRefs } = extractPortrait(save, options.portraitName ?? 'portrait', diagnostics);
  if (assetRefs) character.assets = assetRefs;

  character.sources = toSourceAllowlist(save, options, diagnostics);

  return { character, generated, assets, extraIds: [...new Set(save.sum)], diagnostics };
}

/**
 * The spells a save flags `prepared="true"`, per casting block, keyed by the block's lowercased name — ADR 0046.
 *
 * Every flagged spell is copied, the always-prepared ones included. Aurora sets the flag on a domain or
 * oath spell content grants as well as on a player's pick, and telling them apart needs the derivation,
 * which the importer never runs. The engine ignores a recorded id it also finds always prepared, so
 * nothing counts twice. Duplicates are dropped (one sample lists a spell twice), order is the save's,
 * cantrips are never flagged, and a save with no flag gets no field, exactly the character it got before.
 */
function toPrepared(save: AuroraSave): Record<string, ElementId[]> | undefined {
  const out: Record<string, ElementId[]> = {};
  for (const block of save.magic) {
    const key = block.name.trim().toLowerCase();
    if (!key) continue;
    for (const spell of block.spells) {
      if (!spell.prepared) continue;
      const list = (out[key] ??= []);
      if (!list.includes(spell.id)) list.push(spell.id);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Aurora's namespace for elements its application materializes. An id here that no content
 * declares is generated, not missing — which is the premise `generated-elements.ts` rests on
 * and the evidence for it is the same: content grants and requires these ids constantly, and
 * every real save's `<sum>` contains them.
 */
const GENERATED_PREFIX = 'ID_INTERNAL_';

function synthesizeGenerated(
  save: AuroraSave,
  index: ElementIndex | undefined,
  diagnostics: SaveDiagnostic[],
): Element[] {
  if (!index) return [];

  // Type and name, as the save recorded them. A grant node carries both; so does a
  // decision. Nothing below invents either.
  const described = new Map<ElementId, { type: string; name: string }>();
  for (const grant of save.grants) described.set(grant.id, { type: grant.type, name: grant.name });
  for (const decision of save.decisions) {
    if (decision.isList || described.has(decision.registered)) continue;
    described.set(decision.registered, { type: decision.type, name: decision.ruleName });
  }

  const generated: Element[] = [];
  const missing: ElementId[] = [];
  const candidates = new Set([...save.sum, ...described.keys()]);

  for (const id of [...candidates].sort()) {
    if (index.get(id)) continue;
    if (!id.startsWith(GENERATED_PREFIX)) {
      missing.push(id);
      continue;
    }
    const description = described.get(id);
    if (!description) {
      // In `<sum>` but nowhere in the build tree, so the save says what it is called
      // nowhere either. Report rather than name it something made up.
      missing.push(id);
      continue;
    }
    generated.push({
      id,
      type: description.type,
      name: description.name,
      source: 'Internal',
      setters: {},
      rules: [],
      supports: [],
      description: '<p>Generated by Aurora and reconstructed from the save. It carries no rules.</p>',
      origin: { sourceId: 'aurora:save', format: 'aurora' },
    });
  }

  if (generated.length) {
    diagnostics.push({
      level: 'warning',
      message: `Rebuilt ${generated.length} element(s) Aurora generates at runtime from what the save records about them. They carry no rules.`,
      where: 'build/elements',
    });
  }
  for (const id of missing) {
    diagnostics.push({
      level: 'warning',
      message: `"${id}" is not in the loaded content. The source it came from is probably not enabled; the character keeps the reference.`,
      where: 'build/elements',
    });
  }
  return generated;
}

// --- decisions -------------------------------------------------------------

/**
 * `registered=` nodes -> `Choice[]`.
 *
 * Incudo keys a select by the element that declares it plus the select's name — the same two
 * things Aurora records — so the mapping is `<owner>/select:<name>`, and Aurora's `number="1"`
 * / `"2"` become positions in one `elementIds` array rather than separate choices.
 *
 * Order is `(requiredLevel, number, document order)`. Aurora writes selects of the same name
 * across several levels — a wizard's spellbook picks up two more entries every level — and
 * sorting keeps the list in the order the character was actually built, which is what a
 * "spells you learned at level 5" view will want.
 */
/**
 * Whether an element declares that it may be picked more than once — ADR 0035.
 *
 * Needs the element, and so the loaded content: with no index there is no way to know, and the
 * second pick is dropped with a warning exactly as before. A real level 12 Fighter save
 * records `ID_INTERNAL_ASI_CONSTITUTION` under both numbers of one select, and Aurora's own
 * `<sum>` lists it twice — the two picks are a +2, and losing one makes a Constitution of 19
 * out of 20.
 */
function repeatable(index: ElementIndex | undefined, id: ElementId): boolean {
  const value = index?.get(id)?.setters[REPEATABLE_SETTER]?.value;
  return value !== undefined && value.trim().toLowerCase() !== 'false';
}

function toChoices(
  save: AuroraSave,
  index: ElementIndex | undefined,
  generated: Set<ElementId>,
  diagnostics: SaveDiagnostic[],
): Choice[] {
  const byRule = new Map<string, typeof save.decisions>();

  for (const decision of save.decisions) {
    // `isList` selects record a *row number* in `registered`, not an element id — the
    // background's fourth suggested bond is `registered="4"`. Reading those as element ids
    // is how a character ends up choosing an element called "4". They are freeform text
    // picks; `toFreeform` keeps them.
    if (decision.isList) continue;
    if (!decision.ruleName) {
      diagnostics.push({
        level: 'warning',
        message: `A choice of ${decision.registered} on ${decision.ownerId} has no name, so there is no rule to attach it to. Skipped.`,
        where: 'build/elements',
      });
      continue;
    }
    const ruleKey = `${decision.ownerId}/select:${decision.ruleName}`;
    const list = byRule.get(ruleKey);
    if (list) list.push(decision);
    else byRule.set(ruleKey, [decision]);
  }

  const choices: Choice[] = [];
  for (const [ruleKey, decisions] of byRule) {
    const sorted = [...decisions].sort(
      (a, b) =>
        (a.requiredLevel ?? 0) - (b.requiredLevel ?? 0) ||
        (a.number ?? 0) - (b.number ?? 0) ||
        a.order - b.order,
    );
    const elementIds: ElementId[] = [];
    for (const decision of sorted) {
      if (elementIds.includes(decision.registered) && !repeatable(index, decision.registered)) {
        // Aurora allows the same element under two `number=`s of one select in a few
        // homebrew files, and a derivation counts an element once, so keeping the second would
        // change nothing; say so instead. An element that says it may be picked again is the
        // other case and is kept below — that is how Aurora writes "+2 to one ability".
        diagnostics.push({
          level: 'warning',
          message: `"${decision.registered}" is recorded twice for "${decision.ruleName}"; keeping one.`,
          where: 'build/elements',
        });
        continue;
      }
      elementIds.push(decision.registered);
    }
    choices.push({ ruleKey, elementIds });
  }

  const options = campaignOptions(save);
  if (options.length) choices.push({ ruleKey: OPTIONS_RULE_KEY, elementIds: options });

  // Sort by rule key so importing the same file twice produces byte-identical JSON.
  choices.sort((a, b) => (a.ruleKey < b.ruleKey ? -1 : a.ruleKey > b.ruleKey ? 1 : 0));

  if (index) reportMissingChoices(choices, index, generated, diagnostics);
  return choices;
}

/**
 * The rule key campaign options are recorded under.
 *
 * Not an `<element>/select:<name>` key, because no element declares a select for these —
 * they are the settings a table agreed on: feats, multiclassing, Tasha's customized ability
 * scores. Keying a choice by a build step rather than by a rule is already how a top-level
 * pick is recorded (see `tools/verify/fixtures/aelin`, `"ruleKey": "build/kin"`).
 *
 * A campaign setting is arguably not the character's to hold at all — Aurora stores it per
 * character because Aurora has no concept of a campaign, and neither does Incudo yet. When
 * one arrives this is the single place that moves.
 */
export const OPTIONS_RULE_KEY = 'build/options';

/**
 * Options the user turned on, taken from the top of the save's build tree.
 *
 * These sit there with a bare `id=`, which everywhere else in the tree means "a consequence,
 * do not import". At the top level it means the opposite: nothing granted them, so the user
 * ticked a box. The 200-odd `requirements="ID_INTERNAL_OPTION_ALLOW_FEATS"` in the corpus
 * are all downstream of that box.
 */
function campaignOptions(save: AuroraSave): ElementId[] {
  return save.grants
    .filter((g) => g.depth === 1 && g.type === 'Option')
    .map((g) => g.id)
    .filter((id, i, all) => all.indexOf(id) === i)
    .sort();
}

function reportMissingChoices(
  choices: Choice[],
  index: ElementIndex,
  generated: Set<ElementId>,
  diagnostics: SaveDiagnostic[],
): void {
  // Anything already rebuilt above is accounted for; saying it twice helps nobody.
  const missing = new Set<ElementId>();
  for (const choice of choices) {
    for (const id of choice.elementIds) {
      if (!index.get(id) && !generated.has(id)) missing.add(id);
    }
  }
  for (const id of [...missing].sort()) {
    diagnostics.push({
      level: 'warning',
      message: `Chose "", which is not in the loaded content. The choice is kept — the source may just not be enabled.`,
      where: 'build/elements',
    });
  }
}

// --- advancement -----------------------------------------------------------

/**
 * `<element type="Level" class="…">` -> `Character.advancement` (ADR 0015).
 *
 * Aurora records the split as an attribute per level: no `class=` means the class chosen at
 * level 1, and `class="ID_WOTC_PHB_MULTICLASS_WARLOCK"` means that level went to the warlock.
 * Nothing read it until now, so a multiclass save imported as if every level belonged to the
 * first class — Paladin 20 instead of Paladin 2 / Warlock 18.
 *
 * Two resolutions happen here, and both need the index:
 *
 * - **The multiclass element is not the class.** `class=` names the synthetic element behind
 *   a `<multiclass>` block; the levels belong to the Class element that *declares* that block.
 *   The index answers that directly, since a Class element carries its own `multiclass.id`.
 *   The multiclass element stays a separate choice, because it is one: it grants the reduced
 *   proficiency set, and the class element does not.
 * - **The first class is implicit.** Aurora writes it once, as the `Class` decision at level
 *   1, and every unmarked level belongs to it.
 *
 * With no index there is nothing to resolve against, so this returns nothing rather than
 * guessing — an advancement list naming multiclass elements would derive a character whose
 * class features are all missing, which is worse than one that behaves as single-classed.
 */
function toAdvancement(
  save: AuroraSave,
  index: ElementIndex | undefined,
  diagnostics: SaveDiagnostic[],
): AdvancementEntry[] | undefined {
  if (!save.levels.length) return undefined;

  const primary = save.decisions.find((d) => d.type === 'Class')?.registered;
  const multiclassed = save.levels.some((l) => l.classRef);
  // A single-classed character's advancement says only what `progress` and the class choice
  // already say. Recording it anyway would put a redundant twenty-entry array in every save
  // for no gain; the engine treats a character without one as single-tracked.
  if (!multiclassed) return undefined;

  if (!primary) {
    diagnostics.push({
      level: 'warning',
      message:
        'This character multiclasses, but the save records no first class, so its levels cannot be attributed. Level gates will follow the character total.',
      where: 'build/elements',
    });
    return undefined;
  }

  const byMulticlass = index ? multiclassOwners(index) : undefined;
  const entries: AdvancementEntry[] = [];
  const unresolved = new Set<string>();

  for (const level of [...save.levels].sort((a, b) => a.at - b.at)) {
    if (!level.classRef) {
      entries.push({ at: level.at, elementId: primary });
      continue;
    }
    const owner = byMulticlass?.get(level.classRef);
    if (!owner) {
      unresolved.add(level.classRef);
      continue;
    }
    entries.push({ at: level.at, elementId: owner });
  }

  for (const ref of unresolved) {
    diagnostics.push({
      level: 'warning',
      message: `No loaded class declares the multiclass "${ref}", so the levels taken in it are not attributed. Enable the source it came from and re-import.`,
      where: 'build/elements',
    });
  }

  return entries.length ? entries : undefined;
}

/** `<multiclass id="X">` on a Class element -> `X` maps to that class. */
function multiclassOwners(index: ElementIndex): Map<string, ElementId> {
  const owners = new Map<string, ElementId>();
  for (const element of index.all()) {
    const id = element.multiclass?.id;
    if (id && !owners.has(id)) owners.set(id, element.id);
  }
  return owners;
}

// --- inventory -------------------------------------------------------------

/**
 * Aurora's three `<equipped location=…>` strings, against the vocabulary content uses.
 *
 * These are the *only* three values in a set of real saves: everything else — a cloak, a
 * ring, boots — is equipped with no location at all and takes its slot from the element.
 * An unrecognised location is reported rather than written through: Aurora's words and
 * content's words are two vocabularies, and copying one into a field that holds the other
 * would put "Secondary Hand" where `onehand` belongs.
 */
const LOCATION_SLOTS: Record<string, string> = {
  'Primary Hand': 'onehand',
  'Two-Handed': 'twohand',
  Armor: 'body',
};

/**
 * `<build><equipment>` -> `Character.inventory` (ADR 0024).
 *
 * One row per `<item>`, in the order the save lists them, and nothing is derived from it
 * here — that is step 3 of docs/INVENTORY-AND-AC-PLAN.md. This step only gives the bag a
 * home, which is why it moves no `aurora verify` count.
 *
 * Four of the mappings are decisions rather than transcription, all settled by ADR 0024:
 *
 * - **`instanceId` is Aurora's `identifier`.** All 45 items in a set of real saves have one and
 *   all 45 are distinct, so nothing is minted — minting would make an import
 *   non-deterministic and the golden fixtures would move on every run. The fallback below
 *   is derived from the file too, for the same reason.
 * - **`name` comes from `<details><name>`, not from the `name=` attribute.** The attribute
 *   is a denormalized copy of the element's own name and is already stale in 1 of 42 known
 *   cases ("Crossbow, Hand"), so carrying it would ship a wrong name inside a save that
 *   also embeds the element with the right one.
 * - **An adorner is a nested `elementId` and nothing else.** Aurora gives it no identity,
 *   and its `name=` is byte-identical to the element's in 15 of 15 cases.
 * - **`slot` is written only where Aurora disagrees with the element** — see below.
 */
function toInventory(
  save: AuroraSave,
  index: ElementIndex | undefined,
  generated: Set<ElementId>,
  diagnostics: SaveDiagnostic[],
): InventoryEntry[] | undefined {
  if (!save.equipment.length) return undefined;

  const entries: InventoryEntry[] = [];
  const used = new Set<string>();
  const unknownLocations = new Set<string>();
  const missing = new Set<ElementId>();
  let locatedWithoutIndex = 0;

  save.equipment.forEach((item, position) => {
    const entry: InventoryEntry = {
      instanceId: instanceIdFor(item, position, used, diagnostics),
      elementId: item.id,
    };
    // Omitted means 1, and the derivation reads a row once however large it is: ten arrows
    // are not ten contributions of whatever an arrow contributes (ADR 0024).
    if (item.amount !== undefined && item.amount !== 1) entry.quantity = item.amount;
    if (item.equipped) entry.equipped = true;

    const slot = slotOverride(item, index);
    if (slot === 'no-index') locatedWithoutIndex++;
    else if (slot) entry.slot = slot;
    if (item.location && !(item.location in LOCATION_SLOTS)) unknownLocations.add(item.location);

    // One flag covering host and adornment together. Aurora has no per-adorner one, and 5
    // of the adorners that require attunement are recorded by a flag on their host.
    if (item.attuned) entry.attuned = true;
    if (item.adorners.length) entry.adorners = item.adorners.map((a) => ({ elementId: a.id }));
    if (item.details?.name) entry.name = item.details.name;
    if (item.details?.notes) entry.notes = item.details.notes;
    entries.push(entry);

    if (index) {
      for (const id of [item.id, ...item.adorners.map((a) => a.id)]) {
        if (!index.get(id) && !generated.has(id)) missing.add(id);
      }
    }
  });

  for (const location of [...unknownLocations].sort()) {
    diagnostics.push({
      level: 'warning',
      message: `"${location}" is not a slot this importer knows, so the item keeps whatever slot its element declares. Check where it ended up.`,
      where: 'build/equipment',
    });
  }
  if (locatedWithoutIndex) {
    // The comparison below needs the element, so with no content there is no way to tell an
    // override from agreement. Saying nothing beats writing a slot that is probably a copy
    // of the element's own — the same reasoning `toAdvancement` uses for multiclass levels.
    diagnostics.push({
      level: 'warning',
      message: `${locatedWithoutIndex} item(s) record where they are worn, but no content is loaded to compare that against, so no slot was recorded. The elements' own slots will be used.`,
      where: 'build/equipment',
    });
  }
  for (const id of [...missing].sort()) {
    diagnostics.push({
      level: 'warning',
      message: `The bag holds "${id}", which is not in the loaded content. The item is kept — the source it came from is probably not enabled.`,
      where: 'build/equipment',
    });
  }

  return entries;
}

/**
 * Aurora's GUID, or something else derived from the file.
 *
 * Every item in every sample save has an `identifier`, so the fallback is for homebrew and
 * for hand-edited files. It has to be deterministic (a minted id would change the bytes of
 * an imported save on every run) and unique (two entries sharing an `instanceId` is a
 * validation error under ADR 0024, and a file where an edit hits the wrong row).
 */
function instanceIdFor(
  item: AuroraItem,
  position: number,
  used: Set<string>,
  diagnostics: SaveDiagnostic[],
): string {
  const identifier = item.identifier;
  if (identifier && !used.has(identifier)) {
    used.add(identifier);
    return identifier;
  }
  if (identifier) {
    diagnostics.push({
      level: 'warning',
      message: `Two items share the identifier "${identifier}"; the second one is numbered by its position instead.`,
      where: 'build/equipment',
    });
  }
  const fallback = `${item.id}#${position}`;
  used.add(fallback);
  return fallback;
}

/**
 * Where the item went, **only when that is not what the element itself says** (ADR 0024).
 *
 * Content declares a slot on 1,070 elements, and across all 26 equipped items in the nine
 * saves the recorded `location` agrees with it 15 times out of 15 — the other 11 record no
 * location at all. So the slot is derived from the element and this field means "the user
 * put this somewhere the element did not say": a shield in the off hand, a versatile weapon
 * in both.
 *
 * Two elements in the corpus declare a compound slot (`onehand,secondary`), which nothing
 * in the saves exercises; a location naming one member of the set is agreement, not an
 * override.
 *
 * Returns `'no-index'` rather than a slot when there is content to compare against but none
 * loaded — the caller turns that into one diagnostic for the whole bag.
 */
function slotOverride(item: AuroraItem, index: ElementIndex | undefined): string | undefined | 'no-index' {
  if (!item.location) return undefined;
  const slot = LOCATION_SLOTS[item.location];
  if (!slot) return undefined; // Reported by the caller; never written through.
  if (!index) return 'no-index';

  const declared = index.get(item.id)?.setters['slot']?.value;
  if (!declared) return slot; // The element says nothing, so the location is all there is.
  const members = declared.split(',').map((s) => s.trim());
  return members.includes(slot) ? undefined : slot;
}

// --- rolls -----------------------------------------------------------------

/**
 * `rndhp="6,2,3,…"` -> `{ "hp:level:1": 6, "hp:level:2": 2, … }`.
 *
 * Aurora rolls all twenty levels up front and stores the lot, so a level 5 character carries
 * fifteen rolls it has not used yet. They come across anyway: they are recorded results, and
 * discarding the unused ones would reroll them at level 6 — the exact failure ADR 0007 exists
 * to prevent, just deferred.
 *
 * Whether level 1's entry is ever *read* is the system's business. 5e takes the maximum of the
 * hit die at level 1 and never rolls, so `hp:level:1` sits there unused; dropping it here would
 * be this file deciding a rule it has no business knowing.
 */
function toRolls(save: AuroraSave, advancement: AdvancementEntry[] | undefined): Record<string, number> {
  const rolls: Record<string, number> = {};
  if (advancement) {
    // A multiclass save carries one list per class, on the level that class began at, indexed by
    // the class's own level (ADR 0044). Each one lands on the character levels that class was
    // taken at. Entries past a class's last level belong to no character level yet, so they are
    // not copied: unlike the single-class tail below, there is no level to file them under.
    const filed = new Set<string>();
    for (const level of save.levels) {
      if (!level.rndhp) continue;
      const owner = advancement.find((entry) => entry.at === level.at)?.elementId;
      if (owner === undefined || filed.has(owner)) continue;
      filed.add(owner);
      advancement
        .filter((entry) => entry.elementId === owner)
        .sort((a, b) => a.at - b.at)
        .forEach((entry, k) => {
          const value = level.rndhp![k];
          if (value !== undefined) rolls[`hp:level:${entry.at}`] = value;
        });
    }
    return rolls;
  }
  save.rndhp.forEach((value, i) => {
    rolls[`hp:level:${i + 1}`] = value;
  });
  return rolls;
}

// --- freeform --------------------------------------------------------------

/**
 * Everything the rules never read, under stable prefixes.
 *
 * `<input>` keys keep their own names, `<appearance>` gets a prefix, and Aurora's two
 * `<information>` fields come along because they cost nothing and someone will miss them.
 * `name` is left out: it is the character's name, which has a field of its own, and having it
 * in two places invites them to disagree.
 */
function toFreeform(save: AuroraSave): Record<string, string> {
  const freeform: Record<string, string> = {};
  for (const [key, value] of Object.entries(save.input)) {
    if (key === 'name') continue;
    freeform[key] = value;
  }
  for (const [key, value] of Object.entries(save.appearance)) {
    // The appearance block repeats the portrait's local path. The bytes are in assets/;
    // a dead Windows path from another machine is not worth carrying.
    if (key === 'portrait') continue;
    freeform[`appearance.${key}`] = value;
  }
  // Picks from a table rather than from the content index: "the fourth bond on the
  // Sage's list". The row number is all Aurora stores, so the row number is all there is
  // to keep, and it is text.
  for (const decision of save.decisions) {
    if (!decision.isList) continue;
    freeform[`list.${decision.ownerId}.${decision.ruleName}${decision.number ? `.${decision.number}` : ''}`] =
      decision.registered;
  }
  return sortKeys(freeform);
}

// --- portrait --------------------------------------------------------------

/**
 * The base64 payload -> real bytes in `assets/`.
 *
 * This is the single largest thing in most saves — 5.2 MB of PNG in one of the samples, 88%
 * of the file in another — and Aurora stores it *and* the original path to it. Decoding it out
 * to a file is most of what makes an imported `.incu` a hundredth the size (ADR 0007).
 *
 * The extension comes from the bytes' magic number, not from the recorded path: that path
 * points at someone else's machine and is routinely wrong or gone.
 */
function extractPortrait(
  save: AuroraSave,
  baseName: string,
  diagnostics: SaveDiagnostic[],
): { assets: Map<string, Uint8Array>; assetRefs?: Record<string, string> } {
  const assets = new Map<string, Uint8Array>();
  const base64 = save.portrait?.base64;
  if (!base64) {
    if (save.portrait?.localPath) {
      diagnostics.push({
        level: 'warning',
        message:
          'The save names a portrait file but does not embed it, so there is nothing to import. Add the picture again in Incudo.',
        where: 'display-properties/portrait',
      });
    }
    return { assets };
  }

  const { bytes, skipped } = decodeBase64(base64);
  if (skipped) {
    diagnostics.push({
      level: 'warning',
      message: `Ignored ${skipped} character(s) that are not base64 while decoding the portrait.`,
      where: 'display-properties/portrait',
    });
  }
  if (!bytes.length) {
    diagnostics.push({
      level: 'warning',
      message: 'The embedded portrait decoded to nothing and was dropped.',
      where: 'display-properties/portrait',
    });
    return { assets };
  }

  const extension = imageExtension(bytes);
  if (!extension) {
    diagnostics.push({
      level: 'warning',
      message:
        'The embedded portrait is not a PNG, JPEG, GIF, BMP or WebP. Importing the bytes without an extension; it may not display.',
      where: 'display-properties/portrait',
    });
  }

  const path = `assets/${baseName}${extension ? `.${extension}` : ''}`;
  assets.set(path, bytes);
  return { assets, assetRefs: { portrait: path } };
}

// --- sources ---------------------------------------------------------------

/**
 * `<restricted>` inverted into an allowlist — and then most of it discarded.
 *
 * Aurora records what the user turned **off**: 177 sources and 37,235 element ids in one
 * 3.1 MB save. That is the complement of a short answer, and it rots — an exclusion list
 * silently *includes* everything published after it was written.
 *
 * Inverting it gives what was enabled, which is still hundreds of books. The list actually
 * worth keeping is smaller again: the sources the character's own elements come from, which
 * is a handful. So the blocklist is read, inverted against the loaded content, used to check
 * that nothing the character uses was disabled, and thrown away. `Character.sources` gets the
 * handful, and stays an allowlist by construction rather than by intention.
 *
 * Aurora's books are `type="Source"` elements whose `name` is the string every other element
 * carries in its `source` attribute, so the join is by name. With no content index loaded
 * there is nothing to invert against, and this says so instead of inventing one.
 */
function toSourceAllowlist(
  save: AuroraSave,
  options: ImportCharacterOptions,
  diagnostics: SaveDiagnostic[],
): SourceRef[] {
  const refs: SourceRef[] = [];
  if (options.source) refs.push(options.source);

  const index = options.index;
  if (!index) {
    if (save.restrictedSources.length) {
      diagnostics.push({
        level: 'warning',
        message: `The save disables ${save.restrictedSources.length} source(s), but no content is loaded to invert that against. Imported without a source list.`,
        where: 'sources/restricted',
      });
    }
    return refs;
  }

  const restricted = new Set(save.restrictedSources);
  const byName = new Map<string, Element>();
  for (const source of index.byType('Source')) byName.set(source.name, source);

  // Which books the character actually draws on: the source string of every element it
  // chose, plus every element Aurora's own derivation ended up with, plus everything in the
  // bag.
  //
  // The bag is the late addition, and it is there for the *carried* half. An equipped item
  // is in Aurora's `<sum>` and would be covered by the loop below it; a carried one is not,
  // so a character whose only use of a book is a Frost Brand sitting in a backpack would
  // otherwise have written a source list that does not mention it. A save embeds its bag's
  // content either way (ADR 0012), so this costs nothing today and matters the first time a
  // save is opened to be *edited* rather than read.
  const used = new Set<string>();
  for (const choice of save.decisions) {
    const element = index.get(choice.registered);
    if (element) used.add(element.source);
  }
  for (const id of save.sum) {
    const element = index.get(id);
    if (element) used.add(element.source);
  }
  for (const item of save.equipment) {
    for (const id of [item.id, ...item.adorners.map((a) => a.id)]) {
      const element = index.get(id);
      if (element) used.add(element.source);
    }
  }

  const disabledButUsed: string[] = [];
  for (const name of [...used].sort()) {
    const source = byName.get(name);
    if (!source) continue; // "Internal", "Unknown" — not a book, nothing to record.
    if (restricted.has(source.id)) disabledButUsed.push(name);
    refs.push({ id: source.id, name: source.name });
  }

  if (disabledButUsed.length) {
    // Worth saying out loud rather than fixing: it means Aurora let the character keep
    // content from a book that was later switched off, and the user should know which.
    diagnostics.push({
      level: 'warning',
      message: `The character uses content from ${disabledButUsed.length} source(s) it had disabled: ${disabledButUsed.join(', ')}. Kept, and enabled in the import.`,
      where: 'sources/restricted',
    });
  }

  return refs;
}

function sortKeys(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(record).sort()) out[key] = record[key]!;
  return out;
}
