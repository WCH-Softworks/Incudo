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
 * | `rndhp`                     | `rolls`               | a die roll has no formula        |
 * | `<input>` / `<appearance>`  | `freeform`            | the rules never read it          |
 * | `<display-properties>` b64  | `assets/portrait.png` | bytes, never base64 (ADR 0007)   |
 * | `<sources><restricted>`     | inverted, then thrown | a blocklist is the wrong keeping |
 * | `id=` nodes, `<sum>`, `<magic>` | **nothing**       | derived; re-derived instead      |
 *
 * The last row is the interesting one. Aurora wrote its own answer into every save, and the
 * temptation is to import it and be sure of matching. Importing it would mean a character that
 * can never be corrected when content is fixed, and would throw away the one free oracle this
 * project gets (ADR 0008). So the derived blocks are read, kept out of the character, and used
 * to check the engine instead.
 */

import {
  createCharacter,
  type Character,
  type Choice,
  type Element,
  type ElementId,
  type ElementIndex,
  type SourceRef,
} from '@incudo/core';
import { decodeBase64, imageExtension } from './base64.ts';
import type { AuroraSave, SaveDiagnostic } from './parse-save.ts';

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
   * content, not code.
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
  save: AuroraSave,
  options: ImportCharacterOptions = {},
): ImportedCharacter {
  const diagnostics: SaveDiagnostic[] = [...save.diagnostics];
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
  character.rolls = toRolls(save);
  character.freeform = toFreeform(save);

  const { assets, assetRefs } = extractPortrait(save, options.portraitName ?? 'portrait', diagnostics);
  if (assetRefs) character.assets = assetRefs;

  character.sources = toSourceAllowlist(save, options, diagnostics);

  return { character, generated, assets, extraIds: [...new Set(save.sum)], diagnostics };
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
      if (elementIds.includes(decision.registered)) {
        // Aurora allows the same element under two `number=`s of one select in a few
        // homebrew files. Incudo's choice list is a set of ids, so the duplicate would be
        // silently absorbed; say so instead.
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
 * pick is recorded (see `tools/incudo/fixtures/aelin`, `"ruleKey": "build/kin"`).
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
function toRolls(save: AuroraSave): Record<string, number> {
  const rolls: Record<string, number> = {};
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
  // chose, plus every element Aurora's own derivation ended up with.
  const used = new Set<string>();
  for (const choice of save.decisions) {
    const element = index.get(choice.registered);
    if (element) used.add(element.source);
  }
  for (const id of save.sum) {
    const element = index.get(id);
    if (element) used.add(element.source);
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
