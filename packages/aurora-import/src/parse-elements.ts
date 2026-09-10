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
  type MulticlassBlock,
  type Rule,
  type Setter,
  type SpellcastingBlock,
  type SheetHints,
} from '@incudo/core';
import { parseXml, childrenNamed, firstChild, findFirst, type XmlNode } from './xml.ts';

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
    const element = toElement(node, options, diagnostics);
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
    const parsed = parseRules(firstChild(node, 'rules'), id, diagnostics, options.fileUrl);
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

  const rulesNode = firstChild(node, 'rules');
  const { rules, supports } = parseRules(rulesNode, id, diagnostics, options.fileUrl);

  const element: Element = {
    id,
    type,
    name,
    source: node.attrs['source'] ?? 'Unknown',
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
    sheet: parseSheet(firstChild(node, 'sheet')),
    multiclass: parseMulticlass(firstChild(node, 'multiclass'), id, diagnostics, options.fileUrl),
    spellcasting: childrenNamed(node, 'spellcasting').map(parseSpellcasting),
    origin: { sourceId: options.sourceId, fileUrl: options.fileUrl, format: 'aurora' },
  };

  if (element.spellcasting?.length === 0) delete element.spellcasting;
  return element;
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
 * `<supports>` children of a node, as tags.
 *
 * One tag per block, and an element may carry several. These are what every
 * `<select supports="…">` filters on, so dropping them — which this importer did until the
 * differential verification made it obvious — means no select ever offers anything.
 */
function directSupports(node: XmlNode): string[] {
  const tags: string[] = [];
  for (const child of childrenNamed(node, 'supports')) {
    const tag = (child.text || child.innerXml).trim();
    if (tag) tags.push(tag);
  }
  return tags;
}

function parseSetters(node: XmlNode | undefined): Record<string, Setter> {
  const out: Record<string, Setter> = {};
  if (!node) return out;
  for (const set of childrenNamed(node, 'set')) {
    const name = set.attrs['name'];
    if (!name) continue;
    const { name: _ignored, ...attrs } = set.attrs;
    out[name] = {
      value: (set.innerXml || set.text).trim(),
      attrs: Object.keys(attrs).length ? attrs : undefined,
    };
  }
  return out;
}

function parseSheet(node: XmlNode | undefined): SheetHints | undefined {
  if (!node) return undefined;
  const hints: SheetHints = {};
  if (node.attrs['display'] !== undefined) hints.display = node.attrs['display'] !== 'false';
  if (node.attrs['alt']) hints.alt = node.attrs['alt'];
  if (node.attrs['usage']) hints.usage = node.attrs['usage'];
  if (node.attrs['action']) hints.action = node.attrs['action'];
  if (node.attrs['name']) hints.name = node.attrs['name'];
  const description = firstChild(node, 'description');
  if (description) hints.description = description.innerXml.trim();
  return Object.keys(hints).length ? hints : undefined;
}

function parseSpellcasting(node: XmlNode): SpellcastingBlock {
  return {
    name: node.attrs['name'] ?? '',
    ability: node.attrs['ability'],
    prepare: node.attrs['prepare'],
    extend: node.attrs['extend'],
    all: node.attrs['all'] === 'true',
    allowReplace: node.attrs['allowReplace'] === 'true',
  };
}

function parseMulticlass(
  node: XmlNode | undefined,
  ownerId: string,
  diagnostics: ImportDiagnostic[],
  fileUrl: string,
): MulticlassBlock | undefined {
  if (!node) return undefined;
  const { rules } = parseRules(firstChild(node, 'rules'), `${ownerId}#multiclass`, diagnostics, fileUrl);
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
  diagnostics: ImportDiagnostic[],
  fileUrl: string,
): { rules: Rule[]; supports: string[] } {
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
        rules.push({
          kind: 'select',
          // Selects are keyed by name, not by position: a content update that inserts a
          // rule above must not silently reassign a user's recorded choice.
          key: `select:${child.attrs['name'] ?? nextKey('select')}`,
          type: child.attrs['type'] ?? '',
          name: child.attrs['name'] ?? 'Choice',
          supports: parseSupports(child.attrs['supports']),
          number: numberOrUndefined(child.attrs['number']) ?? 1,
          level,
          requirements,
          optional: child.attrs['optional'] === 'true',
          default: child.attrs['default'],
          spellcasting: child.attrs['spellcasting'],
          prepared: child.attrs['prepared'] === 'true',
          allowReplace: child.attrs['allowReplace'] === 'true',
        });
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
        const tag = (child.text || child.innerXml).trim();
        if (tag) {
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
