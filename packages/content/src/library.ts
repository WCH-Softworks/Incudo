/**
 * A ContentLibrary is everything currently loaded: several sources, resolved into one
 * element index the engine can query. It walks nested indexes and can load lazily.
 */

import { auroraGeneratedElements, type ElementAppend } from '@incudo/aurora-import';
import { MapElementIndex, type Element, type ElementIndex } from '@incudo/core';
import type { ContentIndex, ContentSource, FileRef, SourceDiagnostic } from './source.ts';

export interface LoadOptions {
  /** Stop after this many nested index levels. Content from the internet can be cyclic. */
  maxDepth?: number;
  /** Called as each file finishes, for progress UI. */
  onProgress?: (loaded: number, total: number, current: string) => void;
  /** Skip files whose name matches; used to avoid pulling images and other non-XML refs. */
  include?: (ref: FileRef) => boolean;
  /**
   * Load the corpus exactly as it is on disk, without the elements Aurora's app generates at
   * runtime. Only useful for looking at what the files themselves say — every real
   * derivation wants the overlay, or 51 references dangle. See `generated-elements.ts`.
   */
  withoutGeneratedElements?: boolean;
}

export interface LoadReport {
  index: ContentIndex;
  filesLoaded: number;
  elementsLoaded: number;
  diagnostics: SourceDiagnostic[];
}

export class ContentLibrary {
  private readonly index = new MapElementIndex();
  private readonly loadedUrls = new Set<string>();
  readonly diagnostics: SourceDiagnostic[] = [];
  readonly indexes: ContentIndex[] = [];

  get elements(): ElementIndex {
    return this.index;
  }

  get size(): number {
    return this.index.size;
  }

  /** Load an index and everything it references. */
  async loadSource(
    source: ContentSource,
    indexUrl: string,
    options: LoadOptions = {},
  ): Promise<LoadReport> {
    const maxDepth = options.maxDepth ?? 8;
    const root = await source.loadIndex(indexUrl);
    this.indexes.push(root);

    // Before the files, not after. Aurora's app materializes 51 elements that no XML file
    // declares, and content grants and requires them constantly; without them a full corpus
    // has 51 dangling references and every imported character is missing its size. Adding
    // them first means a source that does declare one of these ids overrides the overlay and
    // says so through the usual duplicate-id warning, rather than being quietly overwritten.
    if (root.format === 'aurora' && !options.withoutGeneratedElements) {
      this.addGeneratedElements();
    }

    const queue: Array<{ ref: FileRef; depth: number }> = root.files.map((ref) => ({
      ref,
      depth: 0,
    }));
    let filesLoaded = 0;
    let elementsLoaded = 0;
    let processed = 0;
    /** `<append>` blocks, held until every file is in — see `applyAppends`. */
    const pending: ElementAppend[] = [];

    while (queue.length) {
      const item = queue.shift()!;
      const { ref, depth } = item;
      processed++;
      options.onProgress?.(processed, processed + queue.length, ref.name || ref.url);

      if (this.loadedUrls.has(ref.url)) continue;
      if (options.include && !options.include(ref)) continue;
      if (!ref.isIndex && !isElementFile(ref)) continue;

      this.loadedUrls.add(ref.url);

      try {
        if (ref.isIndex) {
          if (depth >= maxDepth) {
            this.diagnostics.push({
              level: 'warning',
              message: `Stopped at nesting depth ${maxDepth}: ${ref.url}`,
              fileUrl: ref.url,
            });
            continue;
          }
          const nested = await source.loadIndex(ref.url);
          this.indexes.push(nested);
          for (const child of nested.files) queue.push({ ref: child, depth: depth + 1 });
        } else {
          const file = await source.loadFile(ref);
          this.addElements(file.elements);
          if (file.appends?.length) pending.push(...file.appends);
          this.diagnostics.push(...file.diagnostics);
          filesLoaded++;
          elementsLoaded += file.elements.length;
        }
      } catch (error) {
        this.diagnostics.push({
          level: 'error',
          message: `Could not load ${ref.url}: ${(error as Error).message}`,
          fileUrl: ref.url,
        });
      }
    }

    this.applyAppends(pending);
    return { index: root, filesLoaded, elementsLoaded, diagnostics: this.diagnostics };
  }

  /**
   * Fold `<append>` blocks into the elements they name.
   *
   * Last, because an append routinely targets an element in a file loaded later — or in a
   * different index entirely, which is the point of the construct: a supplement extends a
   * core element without editing the core file.
   *
   * An append whose target never loads is a warning, not an error. That is the normal case
   * for a partial source list: the supplement is enabled, the book it extends is not, and
   * the user is not doing anything wrong.
   */
  private applyAppends(appends: ElementAppend[]): void {
    for (const append of appends) {
      const target = this.index.get(append.id);
      if (!target) {
        this.diagnostics.push({
          level: 'warning',
          message: `An <append> targets "${append.id}", which is not in any loaded source. Its ${append.rules.length} rule(s) and ${append.supports.length} support tag(s) were not applied.`,
          elementId: append.id,
          fileUrl: append.fileUrl,
        });
        continue;
      }
      // Re-add rather than mutate in place: the element goes back through `add` so the
      // support index picks up the new tags. An element is a value here, not an identity.
      this.index.add({
        ...target,
        rules: [...target.rules, ...append.rules],
        supports: [...target.supports, ...append.supports],
      });
    }
  }

  /** How many of the loaded elements came from the Aurora overlay rather than from a file. */
  generatedElements = 0;

  private addGeneratedElements(): void {
    if (this.generatedElements) return;
    const generated = auroraGeneratedElements();
    for (const element of generated) this.index.add(element);
    this.generatedElements = generated.length;
  }

  addElements(elements: Iterable<Element>): void {
    for (const element of elements) {
      const existing = this.index.get(element.id);
      if (existing && existing.origin.fileUrl !== element.origin.fileUrl) {
        // Two sources defining the same id. Last one wins for now; Phase 2 turns this
        // into a user-visible conflict resolution step (see ROADMAP).
        this.diagnostics.push({
          level: 'warning',
          message: `"${element.id}" is defined in more than one file; using ${element.origin.fileUrl}.`,
          elementId: element.id,
          fileUrl: element.origin.fileUrl,
        });
      }
      this.index.add(element);
    }
  }
}

function isElementFile(ref: FileRef): boolean {
  return ref.url.toLowerCase().endsWith('.xml') || ref.url.toLowerCase().endsWith('.json');
}
