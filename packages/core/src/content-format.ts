/**
 * Incudo's content format — ADR 0119 decision 4.
 *
 * One format for every piece of content Incudo reads: a converted source, a homebrew source's body and a save's
 * `content.json`. `schemas/content.schema.json` is its contract, and {@link checkContentBundle} is the one checker:
 * what an element must have for the engine to read it, and, when it is handed the schema, the schema too (the one
 * validator, `validateJson`).
 */

import { validateJson, type JsonSchema } from './json-schema.ts';
import type { Element, ElementId, Rule } from './model.ts';

/** The content format's version. A file written in another is refused with a sentence. */
export const CONTENT_FORMAT_VERSION = 1;

/**
 * Rules and support tags a source adds to an element it does not declare itself: a supplement extending a book's class.
 * Applied to that element whichever source declares it, in the order the sources load.
 */
export interface ElementExtension {
  id: ElementId;
  rules: Rule[];
  supports: string[];
  /** The file of the source the extension was written in, for reporting. */
  fileUrl?: string;
}

/** Something a source's conversion or its files said, for its line on the Sources pane. */
export interface ContentDiagnostic {
  level: 'error' | 'warning';
  message: string;
  elementId?: string;
  fileUrl?: string;
}

/**
 * One part of a source, as the parts chooser shows it (ADR 0055): a nested index or a file, as its parent names it, in
 * the order it lists them. A part is named once, at its first mention; switching it off leaves out everything under it.
 */
export interface ContentPart {
  name: string;
  url: string;
  isIndex: boolean;
  /** What an index calls itself, usually more readable than the file name its parent gives it. */
  title?: string;
  description?: string;
  /** An index's own parts. Absent for a file, and for an index that could not be read, was named earlier, or was too deep. */
  children?: ContentPart[];
  /** Why this index could not be read. */
  failed?: string;
  /** Named earlier in the tree too: its parts are listed there. */
  repeated?: boolean;
  /** Below the depth a conversion follows. */
  tooDeep?: boolean;
}

/** One file of a source, in the order a load adds them. */
export interface ContentFile {
  url: string;
  name?: string;
  /** Written by the conversion rather than read from a file: loaded whatever parts are switched off. */
  generated?: boolean;
}

/** A content source's own description, and for a converted one what it was made from. */
export interface ContentSourceInfo {
  name: string;
  url?: string;
  version?: string;
  description?: string;
  author?: string;
  /** The parts tree, its top being the source itself. */
  parts?: ContentPart;
  /** Its files in load order; each element's `origin.fileUrl` names one. */
  files?: ContentFile[];
  diagnostics?: ContentDiagnostic[];
  /** For each address the conversion fetched, the ETag the server answered with: what an update check asks with. */
  etags?: Record<string, string>;
  /** What it was converted from, by which version of the converter, and when. */
  converted?: { from: string; converter: number; at?: string };
}

/** The body of a content file: `content.json` in a save, a homebrew source, a converted source. */
export interface ContentBundle {
  formatVersion: 1;
  elements: Element[];
  /** Rules and tags for elements this content does not declare (above). */
  extensions?: ElementExtension[];
  /**
   * A save only: ids the character's content referenced that were not in any loaded source when it was written.
   * Recorded rather than dropped, so a reader can tell "missing" from "never existed".
   */
  unresolved?: ElementId[];
  source?: ContentSourceInfo;
}

export interface CheckContentOptions {
  /** `schemas/content.schema.json`; when given, the bundle is validated against it as well. */
  schema?: JsonSchema;
}

/**
 * Check a content bundle. Returns the sentences that refuse it, none when it reads; `value` only when there are none.
 * Ids are compared ignoring case: two elements an id names differently only by case are one id to a reader that folds.
 */
export function checkContentBundle(raw: unknown, options: CheckContentOptions = {}): { value?: ContentBundle; problems: string[] } {
  const problems: string[] = [];
  const value = raw as ContentBundle;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { problems: ['It is not a JSON object.'] };
  if (value.formatVersion !== CONTENT_FORMAT_VERSION) {
    problems.push(`Its formatVersion is ${JSON.stringify(value.formatVersion)}, and only ${CONTENT_FORMAT_VERSION} can be read.`);
  }
  if (!Array.isArray(value.elements)) return { problems: [...problems, 'It has no list of elements.'] };
  const seen = new Set<string>();
  value.elements.forEach((element, i) => {
    const at = `Element ${i + 1}`;
    if (!element || typeof element !== 'object') return void problems.push(`${at} is not an object.`);
    for (const field of ['id', 'type', 'name'] as const) {
      if (typeof element[field] !== 'string' || !element[field].trim()) problems.push(`${at} has no ${field}.`);
    }
    if (typeof element.source !== 'string') problems.push(`${at} has no source.`);
    if (!element.setters || typeof element.setters !== 'object' || Array.isArray(element.setters)) problems.push(`${at} has no setters.`);
    if (!Array.isArray(element.rules)) problems.push(`${at} has no rules.`);
    if (!Array.isArray(element.supports)) problems.push(`${at} has no support tags.`);
    if (typeof element.id === 'string') {
      // Per file: a source may define an id in two of its files, and the later is used (ADR 0054).
      const key = `${element.origin?.fileUrl ?? ''}\n${element.id.toLowerCase()}`;
      if (seen.has(key)) problems.push(`${at}'s id ${element.id} is used by another element.`);
      seen.add(key);
    }
  });
  if (value.extensions !== undefined && !Array.isArray(value.extensions)) problems.push('Its extensions are not a list.');
  if (options.schema && !problems.length) {
    for (const error of validateJson(value, options.schema, { maxErrors: 10 })) {
      problems.push(`${error.path || 'The file'} ${error.message}.`);
    }
  }
  return problems.length ? { problems } : { value, problems };
}
