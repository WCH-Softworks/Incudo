/**
 * A ContentLibrary is everything currently loaded: several sources, resolved into one
 * element index the engine can query. It walks nested indexes and can load lazily.
 */

import { MapElementIndex, type Element, type ElementIndex } from '@incudo/core';
import type { ContentIndex, ContentSource, FileRef, SourceDiagnostic } from './source.ts';

export interface LoadOptions {
  /** Stop after this many nested index levels. Content from the internet can be cyclic. */
  maxDepth?: number;
  /** Called as each file finishes, for progress UI. */
  onProgress?: (loaded: number, total: number, current: string) => void;
  /** Skip files whose name matches; used to avoid pulling images and other non-XML refs. */
  include?: (ref: FileRef) => boolean;
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

    const queue: Array<{ ref: FileRef; depth: number }> = root.files.map((ref) => ({
      ref,
      depth: 0,
    }));
    let filesLoaded = 0;
    let elementsLoaded = 0;
    let processed = 0;

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

    return { index: root, filesLoaded, elementsLoaded, diagnostics: this.diagnostics };
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
