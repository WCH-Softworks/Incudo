/**
 * A ContentLibrary is everything currently loaded: several sources, resolved into one element index the engine can
 * query.
 *
 * It reads Incudo's content format and nothing else (ADR 0119): a source is converted before it reaches here, so the
 * library walks no network, parses no Aurora file and invents no element. What it does across sources is generic: the
 * later of two definitions of an id is used (ADR 0054), an extension a source writes for another source's element is
 * applied to it whichever loads first (ADR 0051), and what a source refers to that nothing loaded declares is reported
 * (ADR 0052).
 */

import {
  MapElementIndex,
  referencedElementIds,
  type ContentBundle,
  type ContentDiagnostic,
  type ContentPart,
  type ContentSourceInfo,
  type Element,
  type ElementExtension,
  type ElementIndex,
} from '@incudo/core';

export type SourceDiagnostic = ContentDiagnostic;

export interface LoadOptions {
  /** The parts switched off (ADR 0055): a file at one of these addresses, or under an index at one, is left out. */
  excluded?: readonly string[];
  /** Leave out what a conversion generated rather than read from a file: for looking at what the files alone say. */
  withoutGenerated?: boolean;
}

export interface LoadReport {
  info: ContentSourceInfo;
  filesLoaded: number;
  elementsLoaded: number;
  diagnostics: SourceDiagnostic[];
  /**
   * The ids this source's files declare, sorted, each once, whether this load added them or an earlier source in the
   * same library already had them. Not what a conversion generated. What a record of a switched-off source is made of
   * (ADR 0090).
   */
  declared: string[];
}

/**
 * What one source refers to that nothing loaded declares — ADR 0052. Reported, never enforced: a supplement enabled
 * without the book it builds on is a thing a user may mean to do.
 */
export interface MissingContent {
  /** Ids a grant, or a select's default, names and no loaded source declares. Sorted, each once. */
  references: string[];
  /** The target of each extension from this source that found nothing to add to, one per extension, sorted. */
  additions: string[];
}

/**
 * What one source defines that another enabled source also defines — ADR 0054. The source loaded later is used, so
 * between two sources every shared id goes the same way.
 */
export interface SourceOverlap {
  /** The other source. */
  sourceId: string;
  /** Whose definition is used for what both define: this source's, or the other's. */
  used: 'this' | 'other';
  /** Ids both define, differently. Sorted. */
  differ: string[];
  /** How many ids both define the same way. Which one is used changes nothing. */
  same: number;
}

/**
 * Every address the parts switched off leave out: a part is off where it is named, and so is everything under an index
 * that is off; one still named somewhere that is on stays in. Tasha's lists a Player's Handbook file too, so switching
 * the Handbook off leaves that file in, read under Tasha's (ADR 0055, as a load of the indexes always read it).
 */
export function excludedAddresses(parts: ContentPart | undefined, excluded: readonly string[] | undefined): Set<string> {
  const switchedOff = new Set(excluded ?? []);
  if (!switchedOff.size || !parts) return switchedOff;
  // An index's parts are listed at its first mention; a repeat names it and lists nothing.
  const listed = new Map<string, ContentPart>();
  const all = new Set<string>();
  const index = (part: ContentPart): void => {
    all.add(part.url);
    if (part.children && !listed.has(part.url)) listed.set(part.url, part);
    for (const child of part.children ?? []) index(child);
  };
  index(parts);
  const reached = new Set<string>();
  const reach = (part: ContentPart): void => {
    if (switchedOff.has(part.url) || reached.has(part.url)) return;
    reached.add(part.url);
    for (const child of listed.get(part.url)?.children ?? []) reach(child);
  };
  reach(parts);
  const off = new Set([...switchedOff]);
  for (const url of all) if (!reached.has(url)) off.add(url);
  return off;
}

/** A bundle's files in load order: its own list, or for one with none (a save's content, a homebrew body) the files its elements name. */
function filesOf(bundle: ContentBundle): Array<{ url: string; generated?: boolean }> {
  if (bundle.source?.files) return bundle.source.files;
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const element of bundle.elements) {
    const url = element.origin?.fileUrl ?? '';
    if (!seen.has(url)) urls.push(url), seen.add(url);
  }
  return urls.map((url) => ({ url }));
}

export class ContentLibrary {
  private readonly index = new MapElementIndex();
  private readonly loadedUrls = new Set<string>();
  readonly diagnostics: SourceDiagnostic[] = [];

  get elements(): ElementIndex {
    return this.index;
  }

  get size(): number {
    return this.index.size;
  }

  /**
   * Add a source's content. Each element is recorded as the source's (`origin.sourceId`), whatever the file said, so a
   * copy of a file under another source's id is that source's content.
   */
  loadBundle(sourceId: string, bundle: ContentBundle, options: LoadOptions = {}): LoadReport {
    const off = excludedAddresses(bundle.source?.parts, options.excluded);
    const byFile = new Map<string, Element[]>();
    for (const element of bundle.elements) {
      const url = element.origin?.fileUrl ?? '';
      const owned: Element = { ...element, origin: { sourceId, ...(url ? { fileUrl: url } : {}) } };
      const list = byFile.get(url);
      if (list) list.push(owned);
      else byFile.set(url, [owned]);
    }

    let filesLoaded = 0;
    let elementsLoaded = 0;
    const declared = new Set<string>();
    const loadedHere = new Set<string>();
    for (const file of filesOf(bundle)) {
      if (off.has(file.url)) continue;
      const elements = byFile.get(file.url) ?? [];
      if (file.generated) {
        if (options.withoutGenerated) continue;
        // What a conversion generated is what Aurora's app would have made once for everything loaded: added only where
        // nothing loaded declares the id, so two Aurora sources do not read as defining the same 81 things.
        for (const element of elements) if (!this.index.get(element.id)) this.index.add(element);
        loadedHere.add(file.url);
        continue;
      }
      for (const element of elements) declared.add(element.id);
      // A file an earlier source already loaded is not loaded again: Core lists the Player's Handbook index too.
      if (file.url && this.loadedUrls.has(file.url)) continue;
      if (file.url) this.loadedUrls.add(file.url);
      loadedHere.add(file.url);
      this.addElements(elements);
      filesLoaded++;
      elementsLoaded += elements.length;
    }

    for (const diagnostic of bundle.source?.diagnostics ?? []) {
      if (diagnostic.fileUrl && off.has(diagnostic.fileUrl)) continue;
      if (diagnostic.fileUrl && !loadedHere.has(diagnostic.fileUrl) && byFile.has(diagnostic.fileUrl)) continue;
      this.diagnostics.push(diagnostic);
    }

    const extensions = (bundle.extensions ?? []).filter((extension) => !extension.fileUrl || loadedHere.has(extension.fileUrl));
    for (const extension of extensions) this.extensionSources.set(extension, sourceId);
    this.applyExtensions(extensions);

    return {
      info: bundle.source ?? { name: sourceId },
      filesLoaded,
      elementsLoaded,
      diagnostics: this.diagnostics,
      declared: [...declared].sort(),
    };
  }

  /** Every extension loaded so far, by the id it targets, in the order its source loaded. */
  private readonly extensionsByTarget = new Map<string, ElementExtension[]>();
  /**
   * For each target the extensions have been applied to: the element as its source declared it, what applying them
   * produced, and how many were applied. A target whose element is no longer that result was replaced by a later
   * source, and the extensions are applied again over the new one.
   */
  private readonly folded = new Map<string, { base: Element; result: Element; count: number }>();
  /** The warning standing for each extension that found no target, so a later source can withdraw it. */
  private readonly unapplied = new Map<ElementExtension, SourceDiagnostic>();
  /** Which source each extension came from, so what it refers to is reported against that source (ADR 0052). */
  private readonly extensionSources = new Map<ElementExtension, string>();

  /**
   * For each source, what it refers to that nothing loaded declares — ADR 0052. Asked after the last source has
   * loaded, since a reference one source makes is often declared by the next.
   *
   * A grant (or a select's default) to an id nothing declares, which a character silently goes without; and an
   * extension still waiting for its target. Not a requirement naming an id nothing declares: content writes `!ID_X`
   * against ids that will never exist on purpose, and counting them would put a meaningless number beside every source.
   */
  missingContent(): Map<string, MissingContent> {
    const references = new Map<string, Set<string>>();
    const note = (sourceId: string | undefined, element: Element): void => {
      if (sourceId === undefined) return;
      for (const id of referencedElementIds([element], { requirements: false })) {
        if (this.index.get(id)) continue;
        const ids = references.get(sourceId);
        if (ids) ids.add(id);
        else references.set(sourceId, new Set([id]));
      }
    };

    for (const element of this.index.all()) {
      const entry = this.folded.get(element.id);
      // The element as its own source declared it: what extensions added is looked at below, as theirs.
      note(element.origin.sourceId, entry && entry.result === element ? entry.base : element);
      if (!entry || entry.result !== element) continue;
      for (const extension of this.extensionsByTarget.get(element.id) ?? []) {
        note(this.extensionSources.get(extension), { ...element, rules: extension.rules, multiclass: undefined });
      }
    }

    const additions = new Map<string, string[]>();
    for (const extension of this.unapplied.keys()) {
      const sourceId = this.extensionSources.get(extension);
      if (sourceId === undefined) continue;
      const targets = additions.get(sourceId);
      if (targets) targets.push(extension.id);
      else additions.set(sourceId, [extension.id]);
    }

    const out = new Map<string, MissingContent>();
    for (const sourceId of new Set([...references.keys(), ...additions.keys()])) {
      out.set(sourceId, {
        references: [...(references.get(sourceId) ?? [])].sort(),
        additions: (additions.get(sourceId) ?? []).sort(),
      });
    }
    return out;
  }

  /**
   * Apply extensions to the elements they name, across sources: every extension is kept, and after each load all of
   * them are applied, in the order their sources loaded, over whatever element holds each id now. One that waited is
   * applied when its target arrives, and one whose target a later source redefined lands on the new definition. One whose
   * target is still not loaded is a warning, withdrawn if a later source supplies it: a supplement enabled without the
   * book it extends is not a mistake.
   */
  private applyExtensions(extensions: ElementExtension[]): void {
    const touched = new Set<string>();
    for (const extension of extensions) {
      const waiting = this.extensionsByTarget.get(extension.id);
      if (waiting) waiting.push(extension);
      else this.extensionsByTarget.set(extension.id, [extension]);
      touched.add(extension.id);
    }
    for (const extension of this.unapplied.keys()) touched.add(extension.id);
    for (const [id, entry] of this.folded) if (this.index.get(id) !== entry.result) touched.add(id);

    for (const id of touched) {
      const current = this.index.get(id);
      if (!current) continue;
      const all = this.extensionsByTarget.get(id);
      if (!all) continue;
      const entry = this.folded.get(id);
      const replaced = !entry || entry.result !== current;
      if (!replaced && entry.count === all.length) continue;
      const base = replaced ? current : entry.base;
      // Re-added rather than changed in place, so the support index picks up the new tags.
      const result: Element = {
        ...base,
        rules: [...base.rules, ...all.flatMap((extension) => extension.rules)],
        supports: [...base.supports, ...all.flatMap((extension) => extension.supports)],
      };
      this.index.add(result);
      this.folded.set(id, { base, result, count: all.length });
      for (const extension of all) {
        const warning = this.unapplied.get(extension);
        if (!warning) continue;
        this.diagnostics.splice(this.diagnostics.indexOf(warning), 1);
        this.unapplied.delete(extension);
      }
    }

    for (const extension of extensions) {
      if (this.index.get(extension.id)) continue;
      const warning: SourceDiagnostic = {
        level: 'warning',
        message: `An addition targets "${extension.id}", which is not in any loaded source. Its ${extension.rules.length} rule(s) and ${extension.supports.length} support tag(s) were not applied.`,
        elementId: extension.id,
        ...(extension.fileUrl ? { fileUrl: extension.fileUrl } : {}),
      };
      this.diagnostics.push(warning);
      this.unapplied.set(extension, warning);
    }
  }

  /**
   * For each id more than one source defines, each source's definition as it declared it, in load order: the last is
   * the one used (ADR 0054). Only ids with a second source are here.
   */
  private readonly definitions = new Map<string, Array<{ sourceId: string; element: Element }>>();

  /**
   * For each source, what it defines that another enabled source also defines, and whose definition is used — ADR
   * 0054. Asked after the last source has loaded, like {@link missingContent}. Only pairs with the source that is used;
   * definitions are compared as their sources declared them, before any extension, with where they came from left out.
   */
  sourceOverlaps(): Map<string, SourceOverlap[]> {
    const pairs = new Map<string, { differ: string[]; same: number }>();
    for (const [id, all] of this.definitions) {
      const used = all[all.length - 1]!;
      const usedBody = comparable(used.element);
      for (const replaced of all.slice(0, -1)) {
        const key = JSON.stringify([used.sourceId, replaced.sourceId]);
        const pair = pairs.get(key) ?? { differ: [], same: 0 };
        if (comparable(replaced.element) === usedBody) pair.same++;
        else pair.differ.push(id);
        pairs.set(key, pair);
      }
    }

    const out = new Map<string, SourceOverlap[]>();
    const push = (sourceId: string, overlap: SourceOverlap): void => {
      const list = out.get(sourceId);
      if (list) list.push(overlap);
      else out.set(sourceId, [overlap]);
    };
    for (const [key, { differ, same }] of pairs) {
      const [used, replaced] = JSON.parse(key) as [string, string];
      differ.sort();
      push(used, { sourceId: replaced, used: 'this', differ, same });
      push(replaced, { sourceId: used, used: 'other', differ, same });
    }
    return out;
  }

  addElements(elements: Iterable<Element>): void {
    for (const element of elements) {
      const existing = this.index.get(element.id);
      if (existing && existing.origin.sourceId !== element.origin.sourceId) {
        // Two sources defining the same id: the later is used, and that is the rule (ADR 0054). Reported on each source's
        // line, from `sourceOverlaps`, rather than as one warning per id.
        const all = this.definitions.get(element.id);
        const entry = { sourceId: element.origin.sourceId, element };
        if (all) all.push(entry);
        else this.definitions.set(element.id, [{ sourceId: existing.origin.sourceId, element: this.declared(existing) }, entry]);
      } else if (existing) {
        // Within one source: the later definition wins, and it is the author's to fix.
        if (existing.origin.fileUrl !== element.origin.fileUrl) {
          this.diagnostics.push({
            level: 'warning',
            message: `"${element.id}" is defined in more than one file; using ${element.origin.fileUrl}.`,
            elementId: element.id,
            ...(element.origin.fileUrl ? { fileUrl: element.origin.fileUrl } : {}),
          });
        }
        this.definitions.get(element.id)?.splice(-1, 1, { sourceId: element.origin.sourceId, element });
      }
      this.index.add(element);
    }
  }

  /** An element as its source declared it: what `applyExtensions` folded over it is left out. */
  private declared(element: Element): Element {
    const entry = this.folded.get(element.id);
    return entry && entry.result === element ? entry.base : element;
  }
}

/** An element's definition with where it came from left out, for telling two definitions apart (ADR 0054). */
function comparable(element: Element): string {
  return JSON.stringify({ ...element, origin: undefined });
}

/** Whether a load reads this ref as an elements file: images and other non-content refs an index names are skipped. */
export function isElementFile(ref: { url: string }): boolean {
  return ref.url.toLowerCase().endsWith('.xml') || ref.url.toLowerCase().endsWith('.json');
}
