/**
 * Aurora elements XML -> Incudo `Element`s.
 *
 * Where Aurora's format is ambiguous, this reports a diagnostic rather than guessing
 * silently (docs/adr/0005). The importer never mutates upstream content.
 */

import {
  parseRequirements,
  parseStatValue,
  parseSupports,
  type Element,
  type ElementContent,
  type MulticlassBlock,
  type Rule,
  type Setter,
  type SpellcastingBlock,
  type SheetDescription,
  type SheetHints,
} from '@incudo/core';
import { bookOf } from './book.ts';
import { asItemFeature } from './item-features.ts';
import { parseXml, childrenNamed, firstChild, findFirst, decodeEntities, type XmlNode } from './xml.ts';

export interface ImportDiagnostic {
  level: 'error' | 'warning';
  message: string;
  elementId?: string;
  fileUrl?: string;
}

/**
 * An `<append id="X">` block: extra rules and support tags for an element declared
 * somewhere else, often in another file entirely.
 *
 * Aurora's way of saying "Tasha's adds a grant to this Player's Handbook element" without
 * editing the Player's Handbook file. Because the target may not have been read yet — or
 * may live in a file this index never loads — appends cannot be applied here. They come out
 * with the file and get applied once everything is loaded; `ContentLibrary` does that.
 */
export interface ElementAppend {
  id: string;
  rules: Rule[];
  supports: string[];
  fileUrl: string;
}

export interface ImportedFile {
  url: string;
  name?: string;
  version?: string;
  elements: Element[];
  /** `<append>` blocks, unapplied. See {@link ElementAppend}. */
  appends: ElementAppend[];
  diagnostics: ImportDiagnostic[];
}

export interface ParseElementsOptions {
  /** Content source id recorded on every imported element. */
  sourceId: string;
  fileUrl: string;
}

export function parseAuroraElements(xml: string, options: ParseElementsOptions): ImportedFile {
  const diagnostics: ImportDiagnostic[] = [];
  const doc = parseXml(xml);
  const root = findFirst(doc, 'elements') ?? doc;
  const info = firstChild(root, 'info');
  const update = info ? firstChild(info, 'update') : undefined;

  const elements: Element[] = [];
  for (const node of childrenNamed(root, 'element')) {
    const element = toElement(node, options, diagnostics, elements);
    if (!element) continue;
    elements.push(element);
    // A <multiclass> block declares an id that other content references by name
    // (`requirements="!ID_WOTC_PHB_MULTICLASS_ROGUE"`). Aurora's app materializes that
    // as an element when you multiclass; nothing in the XML declares it. Synthesize it,
    // or 24 core references dangle. See docs/AURORA-FORMAT.md.
    const virtual = multiclassAsElement(element, options);
    if (virtual) elements.push(virtual);
  }

  const appends: ElementAppend[] = [];
  for (const node of childrenNamed(root, 'append')) {
    const id = node.attrs['id'];
    if (!id) {
      diagnostics.push({
        level: 'warning',
        message: 'An <append> has no id, so there is nothing to append it to. Skipped.',
        fileUrl: options.fileUrl,
      });
      continue;
    }
    // An append targets another file's element by id and carries no `source` of its own —
    // no `type="List"` select has ever been observed inside one (the construct is
    // background-only, ADR 0005's "measure, don't guess" territory), but `'Unknown'`
    // is the same fallback a same-shaped omission gets in `toElement`.
    const parsed = parseRules(firstChild(node, 'rules'), id, 'Unknown', diagnostics, options, elements);
    appends.push({
      id,
      rules: parsed.rules,
      supports: [...parsed.supports, ...directSupports(node)],
      fileUrl: options.fileUrl,
    });
  }

  return {
    url: options.fileUrl,
    name: firstChild(info ?? root, 'name')?.text.trim(),
    version: update?.attrs['version'],
    elements,
    appends,
    diagnostics,
  };
}

function toElement(
  node: XmlNode,
  options: ParseElementsOptions,
  diagnostics: ImportDiagnostic[],
  extraElements: Element[],
): Element | undefined {
  const id = node.attrs['id'];
  const type = node.attrs['type'];
  const name = node.attrs['name'];

  if (!id || !type || !name) {
    diagnostics.push({
      level: 'error',
      message: `Skipped an <element> missing ${!id ? 'id' : !type ? 'type' : 'name'}.`,
      fileUrl: options.fileUrl,
      elementId: id,
    });
    return undefined;
  }

  const source = bookOf(node.attrs['source']);
  const rulesNode = firstChild(node, 'rules');
  const { rules, supports } = parseRules(
    rulesNode,
    id,
    source,
    diagnostics,
    options,
    extraElements,
  );

  const element: Element = {
    id,
    type,
    name,
    source,
    setters: parseSetters(firstChild(node, 'setters')),
    rules,
    // Aurora puts `<supports>` beside `<rules>`, not inside it — 3,611 blocks in the corpus
    // and not one within `<rules>`. Both are read: the rules-level form is what the format
    // description implies and costs one line to keep working.
    supports: [...supports, ...directSupports(node)],
    // Likewise `<requirements>` as a direct child, which gates the element rather than one
    // of its rules: 1,845 in the corpus, and the reason a Human Variant is only offered
    // when the campaign turned feats on.
    requirements: safeRequirements(
      firstChild(node, 'requirements')?.text,
      id,
      diagnostics,
      options.fileUrl,
    ),
    description: firstChild(node, 'description')?.innerXml.trim() || undefined,
    sheet: parseSheet(firstChild(node, 'sheet'), id, diagnostics, options.fileUrl),
    multiclass: parseMulticlass(
      firstChild(node, 'multiclass'),
      id,
      source,
      diagnostics,
      options,
      extraElements,
    ),
    spellcasting: childrenNamed(node, 'spellcasting').map(parseSpellcasting),
    contents: parseExtract(firstChild(node, 'extract')),
    origin: { sourceId: options.sourceId, fileUrl: options.fileUrl, format: 'aurora' },
  };

  if (element.spellcasting?.length === 0) delete element.spellcasting;
  if (!element.contents) delete element.contents;
  // An option Aurora's content writes as an item to equip is converted into what it is (ADR 0129).
  return asItemFeature(element);
}

/**
 * What a pack holds — ADR 0098. Aurora writes `<extract>` with an `<item>` per line, its id as the text and `amount=`
 * beside it when more than one; 44 blocks in the corpus, which this used to drop (the eighth such construct). A
 * `<description>` child is prose beside the list and is not read, and an `<item>` naming no id is skipped.
 */
function parseExtract(node: XmlNode | undefined): ElementContent[] | undefined {
  if (!node) return undefined;
  const lines: ElementContent[] = [];
  for (const item of childrenNamed(node, 'item')) {
    const id = item.text.trim();
    if (!id) continue;
    const amount = Number(item.attrs['amount']);
    lines.push({ id, ...(Number.isInteger(amount) && amount > 1 ? { quantity: amount } : {}) });
  }
  return lines.length ? lines : undefined;
}

/**
 * The synthetic element behind a `<multiclass>` block. Carries the block's own rules, so
 * taking a multiclass grants what the block grants, and `has(id)` checks resolve.
 */
function multiclassAsElement(owner: Element, options: ParseElementsOptions): Element | undefined {
  const block = owner.multiclass;
  if (!block) return undefined;
  return {
    id: block.id,
    type: MULTICLASS_TYPE,
    name: `${owner.name} (multiclass)`,
    source: owner.source,
    setters: block.setters,
    rules: block.rules,
    supports: [],
    description: block.prerequisite ? `<p>Prerequisite: ${block.prerequisite}</p>` : undefined,
    origin: { ...owner.origin, format: 'aurora' },
  };
}

/**
 * The element type given to synthesized multiclass elements. Aurora has no name for this
 * because the concept lives in its app code; a system definition maps it like any other type.
 */
export const MULTICLASS_TYPE = 'Multiclass';

/**
 * The tags one `<supports>` block declares.
 *
 * **A block is a comma-separated list, not one tag.** Acrobatics says
 *
 *     <supports>Skill,Dexterity,ID_PROFICIENCY_SKILL,ID_CLASS_ROGUE,Rogue, PHB24 Rogue</supports>
 *
 * and reading that as a single tag is how a Rogue ended up with no skills to choose from. 1,554
 * of the corpus's 3,758 tags contain a comma, so this was two in five of them.
 *
 * Splitting is provably safe rather than merely likely: the *other* side of the comparison is
 * `parseSupports`, which treats `,` as AND and therefore can never produce an operand containing
 * a comma. A joined tag was unmatchable by construction — nothing could have depended on it.
 *
 * Only commas separate. Tags contain spaces (`PHB24 Fighter`, `spell saving throw`), so each
 * part is trimmed and nothing else is touched.
 */
export function supportTags(text: string): string[] {
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

/**
 * `<supports>` children of a node, as tags.
 *
 * An element may carry several blocks, and each block may list several tags. These are what
 * every `<select supports="…">` filters on, so dropping them — which this importer did until
 * the differential verification made it obvious — means no select ever offers anything.
 */
function directSupports(node: XmlNode): string[] {
  const tags: string[] = [];
  for (const child of childrenNamed(node, 'supports')) {
    tags.push(...supportTags(child.text || child.innerXml));
  }
  return tags;
}

/**
 * A `<set>`'s value is its text, entities decoded, unless it holds markup. It used to be the raw
 * source slice every time, so `Mounts &amp; Vehicles` kept the entity (87 setters in the official
 * corpus, all `&amp;`: an item category, a book's author and information). Two setters hold markup,
 * a spell's casting time naming another spell in `<i>`, and `.text` would drop the italic word, so
 * those stay the source as written, the way a description does.
 */
function setterValue(set: XmlNode): string {
  return set.children.length > 0 ? set.innerXml || set.text : set.text;
}

function parseSetters(node: XmlNode | undefined): Record<string, Setter> {
  const out: Record<string, Setter> = {};
  if (!node) return out;
  for (const set of childrenNamed(node, 'set')) {
    const name = set.attrs['name'];
    if (!name) continue;
    const { name: _ignored, ...attrs } = set.attrs;
    out[name] = {
      value: setterValue(set).trim(),
      attrs: Object.keys(attrs).length ? attrs : undefined,
    };
  }
  return out;
}

/**
 * A `<sheet>`: its attributes, and every `<description>` with the level, usage and action it writes on itself.
 *
 * The sixth silently dropped construct (ADR 0076), found as the other five were, by counting what the corpus holds:
 * this used to keep the first description only, and 220 sheets write two to five, gated by `level=` (Rage's "Unlimited"
 * at 20, Sneak Attack's dice). `description` stays the first one's text, so a reader of it and a save written before
 * this read what they did. A description the XML comments out is not one: the reader skips comments. Bugfix, so ADR
 * 0008's freeze allows it.
 */
function parseSheet(
  node: XmlNode | undefined,
  ownerId: string,
  diagnostics: ImportDiagnostic[],
  fileUrl: string,
): SheetHints | undefined {
  if (!node) return undefined;
  const hints: SheetHints = {};
  if (node.attrs['display'] !== undefined) hints.display = node.attrs['display'] !== 'false';
  if (node.attrs['alt']) hints.alt = node.attrs['alt'];
  if (node.attrs['usage']) hints.usage = node.attrs['usage'];
  if (node.attrs['action']) hints.action = node.attrs['action'];
  if (node.attrs['name']) hints.name = node.attrs['name'];
  const descriptions: SheetDescription[] = [];
  for (const child of childrenNamed(node, 'description')) {
    const description: SheetDescription = { text: child.innerXml.trim() };
    const rawLevel = child.attrs['level'];
    const level = numberOrUndefined(rawLevel);
    if (level !== undefined) description.level = level;
    else if (rawLevel !== undefined) {
      // Read as ungated, it would shadow the text meant for the lower levels; so it is reported, and kept ungated
      // only because dropping the text would lose it.
      diagnostics.push({
        level: 'warning',
        message: `A sheet description's level "${rawLevel}" is not a number; it is shown at every level.`,
        elementId: ownerId,
        fileUrl,
      });
    }
    if (child.attrs['usage']) description.usage = child.attrs['usage'];
    if (child.attrs['action']) description.action = child.attrs['action'];
    descriptions.push(description);
  }
  if (descriptions.length) {
    hints.description = descriptions[0]!.text;
    hints.descriptions = descriptions;
  }
  return Object.keys(hints).length ? hints : undefined;
}

/**
 * A `<spellcasting>` block, including the `<list>` child this used to drop.
 *
 * The fifth silently dropped construct, found the way the other four were — by counting what
 * the corpus contains rather than by reading the format. Every attribute was read and the one
 * child element was not, so `$(spellcasting:list)` had nothing to resolve against and every
 * spell select in the game offered an empty list. 17 blocks carry a `<list>`, across 10
 * distinct values, and five of them differ from their block's name. Bugfix, so ADR 0008's
 * freeze allows it; see docs/AURORA-FORMAT.md.
 */
function parseSpellcasting(node: XmlNode): SpellcastingBlock {
  const list = firstChild(node, 'list')?.text.trim();
  return {
    name: node.attrs['name'] ?? '',
    ability: node.attrs['ability'],
    prepare: node.attrs['prepare'],
    extend: node.attrs['extend'],
    all: node.attrs['all'] === 'true',
    allowReplace: node.attrs['allowReplace'] === 'true',
    ...(list ? { list } : {}),
  };
}

function parseMulticlass(
  node: XmlNode | undefined,
  ownerId: string,
  ownerSource: string,
  diagnostics: ImportDiagnostic[],
  options: ParseElementsOptions,
  extraElements: Element[],
): MulticlassBlock | undefined {
  if (!node) return undefined;
  const fileUrl = options.fileUrl;
  const { rules } = parseRules(
    firstChild(node, 'rules'),
    `${ownerId}#multiclass`,
    ownerSource,
    diagnostics,
    options,
    extraElements,
  );
  return {
    id: node.attrs['id'] ?? `${ownerId}_MULTICLASS`,
    prerequisite: firstChild(node, 'prerequisite')?.text.trim() || undefined,
    requirements: safeRequirements(
      firstChild(node, 'requirements')?.text,
      ownerId,
      diagnostics,
      fileUrl,
    ),
    setters: parseSetters(firstChild(node, 'setters')),
    rules,
  };
}

function parseRules(
  node: XmlNode | undefined,
  ownerId: string,
  ownerSource: string,
  diagnostics: ImportDiagnostic[],
  options: ParseElementsOptions,
  extraElements: Element[],
): { rules: Rule[]; supports: string[] } {
  const fileUrl = options.fileUrl;
  const rules: Rule[] = [];
  const supports: string[] = [];
  if (!node) return { rules, supports };

  let counter = 0;
  const nextKey = (prefix: string): string => `${prefix}-${counter++}`;

  for (const child of node.children) {
    const requirements = safeRequirements(child.attrs['requirements'], ownerId, diagnostics, fileUrl);
    const level = numberOrUndefined(child.attrs['level']);

    switch (child.name) {
      case 'grant': {
        const id = child.attrs['id'];
        if (!id) {
          diagnostics.push({
            level: 'warning',
            message: 'A <grant> has no id and was skipped.',
            elementId: ownerId,
            fileUrl,
          });
          break;
        }
        rules.push({
          kind: 'grant',
          key: nextKey('grant'),
          type: child.attrs['type'] ?? '',
          id,
          level,
          requirements,
          spellcasting: child.attrs['spellcasting'],
          prepared: child.attrs['prepared'] === 'true',
          equipped: safeRequirements(child.attrs['equipped'], ownerId, diagnostics, fileUrl),
          allowReplace: child.attrs['allowReplace'] === 'true',
          name: child.attrs['name'],
        });
        break;
      }
      case 'select': {
        const selectName = child.attrs['name'] ?? 'Choice';
        const selectType = child.attrs['type'] ?? '';
        const items = childrenNamed(child, 'item');
        // A background's suggested Personality Trait / Ideal / Bond / Flaw (and a handful
        // of similarly-shaped tables — Trinket, Specialty, ...): 346 selects across the
        // corpus whose candidates are inline text, `<item id="1">...text...</item>`, with
        // small local numbers rather than a real `ID_...` reference — nothing else in the
        // format works this way, and there is no `<element type="List">` anywhere for
        // `candidatesFor` to find. Synthesizing one element per `<item>`, keyed
        // deterministically off the owner and the select's own name, lets every existing
        // select/candidate/Choice mechanism pick these up unchanged — the same move already
        // made for a `<multiclass>` block's synthetic element (`multiclassAsElement` above).
        // Gated on the `<item>` shape being present, not on `type="List"` by name: the
        // corpus happens to only use that type for this, but the construct is structural,
        // not a rule about what "List" means.
        //
        // Every background shares the type "List" (there is no `supports=` on any of these
        // 346 selects to tell them apart), so without more, an Acolyte's "Personality Trait"
        // would offer all 2,258 items from every background's tables, not its own 6–8. A
        // `supports` tag scoped to (owner, select name) is what a filter is *for* — no new
        // mechanism, and it leaves `Element.type` at the plain literal the XML wrote, so
        // the type counts still show one "List" bucket rather than 346 one-off ones.
        const scopeTag = items.length > 0 ? `${ownerId}:list:${selectName}` : undefined;
        rules.push({
          kind: 'select',
          // Selects are keyed by name, not by position: a content update that inserts a
          // rule above must not silently reassign a user's recorded choice.
          key: `select:${child.attrs['name'] ?? nextKey('select')}`,
          type: selectType,
          name: selectName,
          supports: scopeTag ? { kind: 'tag', tag: scopeTag } : parseSupports(child.attrs['supports']),
          number: numberOrUndefined(child.attrs['number']) ?? 1,
          level,
          requirements,
          optional: child.attrs['optional'] === 'true',
          default: child.attrs['default'],
          spellcasting: child.attrs['spellcasting'],
          prepared: child.attrs['prepared'] === 'true',
          allowReplace: child.attrs['allowReplace'] === 'true',
        });
        for (const item of items) {
          const localId = item.attrs['id'];
          if (!localId) {
            diagnostics.push({
              level: 'warning',
              message: `An <item> inside the "${selectName}" select has no id and was skipped.`,
              elementId: ownerId,
              fileUrl,
            });
            continue;
          }
          const text = itemText(item);
          if (!text) {
            diagnostics.push({
              level: 'warning',
              message: `An <item id="${localId}"> inside the "${selectName}" select has no text and was skipped.`,
              elementId: ownerId,
              fileUrl,
            });
            continue;
          }
          extraElements.push({
            id: `${ownerId}/list:${selectName}/${localId}`,
            type: selectType,
            name: text,
            source: ownerSource,
            setters: {},
            rules: [],
            supports: [scopeTag!],
            origin: { sourceId: options.sourceId, fileUrl: options.fileUrl, format: 'aurora' },
          });
        }
        break;
      }
      case 'stat': {
        const name = child.attrs['name'];
        if (!name) break;
        const raw = child.attrs['value'] ?? child.text.trim();
        rules.push({
          kind: 'stat',
          key: nextKey('stat'),
          name: name.toLowerCase(),
          value: parseStatValue(raw),
          bonus: child.attrs['bonus'],
          max: numberOrUndefined(child.attrs['max'] ?? child.attrs['maximum']),
          level,
          requirements,
          equipped: safeRequirements(child.attrs['equipped'], ownerId, diagnostics, fileUrl),
          alt: child.attrs['alt'],
          inline: child.attrs['inline'] === 'true',
        });
        break;
      }
      case 'supports': {
        // Same comma-separated list as `directSupports`, and one rule per tag — a `<supports>`
        // inside `<rules>` is the same statement, written in the other of the two places
        // Aurora allows it.
        for (const tag of supportTags(child.text || child.innerXml)) {
          supports.push(tag);
          rules.push({ kind: 'supports', key: nextKey('supports'), tag });
        }
        break;
      }
      case 'setter':
      case 'spellcasting':
      case 'multiclass':
        // Handled outside the rules list.
        break;
      default:
        diagnostics.push({
          level: 'warning',
          message: `Unknown rule <${child.name}> — ignored. If real content uses it, widen the importer.`,
          elementId: ownerId,
          fileUrl,
        });
    }
  }

  return { rules, supports };
}

function safeRequirements(
  raw: string | undefined,
  ownerId: string,
  diagnostics: ImportDiagnostic[],
  fileUrl: string,
) {
  try {
    return parseRequirements(raw);
  } catch (error) {
    diagnostics.push({
      level: 'error',
      message: `Could not parse requirements ${JSON.stringify(raw)}: ${(error as Error).message}`,
      elementId: ownerId,
      fileUrl,
    });
    return undefined;
  }
}

function numberOrUndefined(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The plain-text label for a `<item>` inside a `<select>`. `innerXml`, not `.text`: one file
 * (Ghosts of Saltmarsh's Smuggler background) wraps a lead word in `<strong>`, and `.text`
 * only accumulates text nodes directly under the item — it would silently drop anything
 * inside a nested tag. `innerXml` is the raw, order-preserving source slice, so stripping
 * tags and decoding entities recovers the whole sentence in the order it was written.
 */
function itemText(node: XmlNode): string {
  return decodeEntities(node.innerXml.replace(/<[^>]+>/g, '')).trim();
}
