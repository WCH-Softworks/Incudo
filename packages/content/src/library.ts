/**
 * A ContentLibrary is everything currently loaded: several sources, resolved into one
 * element index the engine can query. It walks nested indexes and loads every file they name.
 *
 * Every file, on purpose: the builder lists candidates by type, and an Aurora index cannot say what
 * a file holds without fetching it. ADR 0051 measured lazy per-file loading and declined it.
 */

import {
  auroraGeneratedElements,
  improvementOptionElements,
  type ElementAppend,
} from '@incudo/aurora-import';
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
  /**
   * How many requests a load has in flight at once, indexes and element files together. ADR
   * 0029 measured this against the real AuroraLegacy index and settled on
   * {@link DEFAULT_CONCURRENCY}.
   *
   * Raising it does **not** make the load non-deterministic: a batch is applied to the index
   * in the order the refs appeared, not in the order the fetches finished, so which file wins
   * a duplicate id and what order the diagnostics come out in are unchanged. A nested index is
   * *fetched* as soon as the index naming it is read (ADR 0051) and *applied* when the queue
   * reaches it, which is where it always was.
   */
  concurrency?: number;
}

/**
 * Six at a time. Measured, not guessed — see ADR 0029: sequentially, the 244-file
 * AuroraLegacy index takes about a minute over the network, and almost all of that is
 * round-trip latency rather than bandwidth.
 */
export const DEFAULT_CONCURRENCY = 6;

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

    const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    const limit = limiter(concurrency);

    // Indexes fetched ahead of the queue — ADR 0051. Sixty of the first sixty-three requests of an
    // AuroraLegacy load are indexes, and walking them one at a time was about 13 s of a cold first
    // load. Each is asked for the moment the index naming it is read, so a chain of them costs its
    // depth in round trips rather than its length. Only what the walk below would load is asked
    // for: the same depth limit, `include` and "already loaded" checks, so the URLs a load fetches
    // are the same set as before, and the queue still decides when each one is applied.
    const indexFetches = new Map<string, Promise<ContentIndex>>();
    const prefetch = (ref: FileRef, depth: number): void => {
      if (!ref.isIndex || depth >= maxDepth) return;
      if (indexFetches.has(ref.url) || this.loadedUrls.has(ref.url)) return;
      if (options.include && !options.include(ref)) return;
      const fetching = limit(() => source.loadIndex(ref.url), true);
      indexFetches.set(ref.url, fetching);
      // A failure is reported when the queue reaches this index, as it always was; here it is only
      // kept from counting as unhandled.
      fetching.then(
        (nested) => {
          for (const child of nested.files) prefetch(child, depth + 1);
        },
        () => undefined,
      );
    };
    for (const ref of root.files) prefetch(ref, 0);

    while (queue.length) {
      const item = queue.shift()!;
      const { ref, depth } = item;
      processed++;
      options.onProgress?.(processed, processed + queue.length, ref.name || ref.url);

      if (!this.shouldLoad(ref, options)) continue;

      if (ref.isIndex) {
        // Applied here, before any more files: the children it names are what the next batch is
        // made of. Usually already fetched (`prefetch`, above), so this waits for nothing.
        try {
          if (depth >= maxDepth) {
            this.diagnostics.push({
              level: 'warning',
              message: `Stopped at nesting depth ${maxDepth}: ${ref.url}`,
              fileUrl: ref.url,
            });
            continue;
          }
          const nested = await (indexFetches.get(ref.url) ?? limit(() => source.loadIndex(ref.url), true));
          this.indexes.push(nested);
          for (const child of nested.files) queue.push({ ref: child, depth: depth + 1 });
        } catch (error) {
          this.diagnostics.push({
            level: 'error',
            message: `Could not load ${ref.url}: ${(error as Error).message}`,
            fileUrl: ref.url,
          });
        }
        continue;
      }

      // Take the run of element files at the head of the queue and fetch them together.
      // The skip checks happen here, synchronously, so two refs to the same URL inside one
      // batch cannot both get past `loadedUrls`.
      const batch: FileRef[] = [ref];
      while (batch.length < concurrency && queue[0] && !queue[0].ref.isIndex) {
        const candidate = queue.shift()!;
        processed++;
        options.onProgress?.(processed, processed + queue.length, candidate.ref.name || candidate.ref.url);
        if (!this.shouldLoad(candidate.ref, options)) continue;
        batch.push(candidate.ref);
      }

      const results = await Promise.all(
        batch.map(async (fileRef) => {
          try {
            return { ref: fileRef, file: await limit(() => source.loadFile(fileRef)) };
          } catch (error) {
            return { ref: fileRef, error: error as Error };
          }
        }),
      );

      // Applied in the order the refs appeared, never in the order they finished. That is
      // what keeps "last definition of an id wins" and the diagnostic order identical to a
      // sequential load.
      for (const result of results) {
        if ('error' in result && result.error) {
          this.diagnostics.push({
            level: 'error',
            message: `Could not load ${result.ref.url}: ${result.error.message}`,
            fileUrl: result.ref.url,
          });
          continue;
        }
        const file = result.file!;
        this.addElements(file.elements);
        if (file.appends?.length) pending.push(...file.appends);
        this.diagnostics.push(...file.diagnostics);
        filesLoaded++;
        elementsLoaded += file.elements.length;
      }
    }

    this.applyAppends(pending);
    // After the appends, because an append may carry the `<supports>` tags that say an option is
    // already declared; and after every file, because the classes that ask for one are content.
    if (root.format === 'aurora' && !options.withoutGeneratedElements) {
      this.addImprovementOptions();
    }
    return { index: root, filesLoaded, elementsLoaded, diagnostics: this.diagnostics };
  }

  /** Everything that used to sit between `queue.shift()` and the fetch, in one place. */
  private shouldLoad(ref: FileRef, options: LoadOptions): boolean {
    if (this.loadedUrls.has(ref.url)) return false;
    if (options.include && !options.include(ref)) return false;
    if (!ref.isIndex && !isElementFile(ref)) return false;
    this.loadedUrls.add(ref.url);
    return true;
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

  /**
   * The ability score improvement Aurora's app offers at each class level and no file declares —
   * see `improvement-options.ts`. Derived from what is loaded rather than listed, so it runs
   * after every source and is safe to run again: it only adds what no element already has.
   */
  private addImprovementOptions(): void {
    const { elements } = improvementOptionElements(this.index.all());
    for (const element of elements) this.index.add(element);
    this.generatedElements += elements.length;
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

/**
 * At most `size` pieces of work in flight, urgent ones first when a slot frees up. An index is
 * urgent because each one unlocks more work and an element file never does (ADR 0051).
 */
function limiter(size: number): <T>(work: () => Promise<T>, urgent?: boolean) => Promise<T> {
  let active = 0;
  const urgent: Array<() => void> = [];
  const waiting: Array<() => void> = [];
  const next = (): void => {
    while (active < size) {
      const start = urgent.shift() ?? waiting.shift();
      if (!start) return;
      active++;
      start();
    }
  };
  return <T>(work: () => Promise<T>, isUrgent = false) =>
    new Promise<T>((resolve, reject) => {
      (isUrgent ? urgent : waiting).push(() => {
        Promise.resolve()
          .then(work)
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}

function isElementFile(ref: FileRef): boolean {
  return ref.url.toLowerCase().endsWith('.xml') || ref.url.toLowerCase().endsWith('.json');
}
