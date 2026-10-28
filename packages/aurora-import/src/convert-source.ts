/**
 * An Aurora source converted into an Incudo content source — ADR 0119 decisions 1, 3 and 10.
 *
 * Aurora is an input format and nothing else: this reads an Aurora index and every file it reaches, once, and writes
 * one Incudo content file (`ContentBundle`). Nothing past it reads Aurora. What Aurora's app did at run time is written
 * down here as ordinary content:
 *
 *  - the elements its app materializes and no file declares (`generated-elements.ts`), as the source's first file;
 *  - the ability score improvement options it offers at each class level (`improvement-options.ts`), as its last;
 *  - each `<append>` as an extension: rules and tags for an element by id, which the content library applies to that
 *    element whichever source declares it. Kept as extensions rather than folded here because a part switched off must
 *    take what it adds with it, and parts are switched at load, not at conversion.
 *
 * Every part is converted, switched off or not: switching one on again then needs no download. A conversion reads the
 * network for everything, and no Aurora file is kept (decision 10). Given the previous conversion, a file that cannot
 * be fetched keeps what the previous one held for it, and is reported, so a refresh with a host down loses nothing.
 */

import type {
  ContentBundle,
  ContentDiagnostic,
  ContentFile,
  ContentPart,
  Element,
  ElementExtension,
  Fetcher,
} from '@incudo/core';

import { auroraGeneratedElements } from './generated-elements.ts';
import { improvementOptionElements } from './improvement-options.ts';
import { parseAuroraElements } from './parse-elements.ts';
import { parseAuroraIndex, type AuroraFileRef, type AuroraIndex } from './parse-index.ts';

/**
 * Which version of the converter wrote a conversion. Bump it when the same Aurora files come to convert into something
 * different; a source converted by another version is converted again. 5 since a source is converted whole, into one
 * Incudo content file (ADR 0119), 6 since a `!` operand is a `not` filter node; 4 was ADR 0129's.
 */
export const CONVERTER_VERSION = 6;

/** What a converted source's `converted.from` says. */
export const AURORA_FORMAT = 'aurora';

/** The address the converter gives the elements Aurora's app materializes, as the source's first file. */
export const APP_ELEMENTS_URL = 'incudo:aurora/app-elements';
/** The address it gives the improvement options it derives, as the source's last file. */
export const IMPROVEMENT_OPTIONS_URL = 'incudo:aurora/improvement-options';

/** How many requests a conversion has in flight at once (ADR 0029's measurement). */
export const CONVERT_CONCURRENCY = 6;
/** How many nested index levels it follows before it stops and warns. Content from the internet can be cyclic. */
export const CONVERT_MAX_DEPTH = 8;

export interface ConvertSourceOptions {
  fetcher: Fetcher;
  /** The top index's address. */
  url: string;
  /** Recorded as every element's `origin.sourceId`. */
  sourceId: string;
  /** Read an Aurora download folder rather than a repository: see `ParseIndexOptions.resolveByName`. */
  resolveByName?: boolean;
  concurrency?: number;
  maxDepth?: number;
  /** Called as each file arrives, for progress. */
  onProgress?: (done: number, total: number, current: string) => void;
  /** The source's previous conversion: what a file that cannot be fetched falls back to. */
  previous?: ContentBundle;
  /** Leave out what Aurora's app generates: for looking at what the files alone say. */
  withoutGenerated?: boolean;
  /** When the conversion is made, as written in it; left out, nothing is written. */
  at?: string;
}

export interface ConversionReport {
  /** Files and indexes that came over the network. */
  fetched: number;
  /** Ones a conditional request said were current. Always 0 today: a conversion reads everything (decision 10). */
  unchanged: number;
  /** Files and indexes that could not be fetched and were kept from the previous conversion, with why. */
  kept: Array<{ url: string; reason: string }>;
}

export interface ConvertedSource {
  bundle: ContentBundle;
  report: ConversionReport;
}

/** A converted source's `Element`s as the bundle keeps them, grouped by the file that declares them. */
function previousFiles(previous: ContentBundle | undefined): Map<string, { elements: Element[]; extensions: ElementExtension[]; diagnostics: ContentDiagnostic[] }> {
  const files = new Map<string, { elements: Element[]; extensions: ElementExtension[]; diagnostics: ContentDiagnostic[] }>();
  if (!previous) return files;
  const of = (url: string) => {
    let entry = files.get(url);
    if (!entry) files.set(url, (entry = { elements: [], extensions: [], diagnostics: [] }));
    return entry;
  };
  for (const element of previous.elements) if (element.origin?.fileUrl) of(element.origin.fileUrl).elements.push(element);
  for (const extension of previous.extensions ?? []) if (extension.fileUrl) of(extension.fileUrl).extensions.push(extension);
  for (const diagnostic of previous.source?.diagnostics ?? []) if (diagnostic.fileUrl) of(diagnostic.fileUrl).diagnostics.push(diagnostic);
  return files;
}

/** Every index the previous conversion read, by address, as the refs it named. */
function previousIndexes(previous: ContentBundle | undefined): Map<string, AuroraIndex> {
  const indexes = new Map<string, AuroraIndex>();
  const walk = (part: ContentPart | undefined): void => {
    if (!part?.isIndex || !part.children) return;
    indexes.set(part.url, {
      url: part.url,
      name: part.title ?? part.name,
      description: part.description,
      files: part.children.map((child) => ({ name: child.name, url: child.url, isIndex: child.isIndex })),
    });
    for (const child of part.children) walk(child);
  };
  walk(previous?.source?.parts);
  if (indexes.size && previous?.source?.parts) {
    const top = indexes.get(previous.source.parts.url)!;
    top.version = previous.source.version;
    top.author = previous.source.author;
  }
  return indexes;
}

/** Whether a ref names a file a conversion reads as elements: images and other refs an index names are skipped. */
export function isAuroraElementFile(ref: Pick<AuroraFileRef, 'url'>): boolean {
  return ref.url.toLowerCase().endsWith('.xml');
}

/**
 * Convert an Aurora source: its top index and everything it reaches. Throws only when the top index can be read from
 * neither the network nor the previous conversion.
 */
export async function convertAuroraSource(options: ConvertSourceOptions): Promise<ConvertedSource> {
  const { fetcher, sourceId } = options;
  const maxDepth = options.maxDepth ?? CONVERT_MAX_DEPTH;
  const limit = limiter(Math.max(1, options.concurrency ?? CONVERT_CONCURRENCY));
  const report: ConversionReport = { fetched: 0, unchanged: 0, kept: [] };
  const etags: Record<string, string> = {};
  const oldFiles = previousFiles(options.previous);
  const oldIndexes = previousIndexes(options.previous);

  const fetchText = async (url: string): Promise<string> => {
    const result = await fetcher.fetchText(url);
    report.fetched++;
    if (result.etag !== undefined) etags[url] = result.etag;
    return result.text;
  };

  const readIndex = async (url: string): Promise<AuroraIndex> => {
    try {
      return parseAuroraIndex(await fetchText(url), url, { resolveByName: options.resolveByName });
    } catch (error) {
      const kept = oldIndexes.get(url);
      if (!kept) throw error;
      report.kept.push({ url, reason: (error as Error).message });
      return kept;
    }
  };

  const top = await readIndex(options.url).catch((error: unknown) => {
    throw new Error(`Could not load ${options.url}: ${(error as Error).message}`);
  });

  // Indexes are asked for as soon as the index naming them is read (ADR 0051), and applied in the order the walk reaches
  // them, so a chain of them costs its depth in round trips and the result does not depend on which answered first.
  const indexFetches = new Map<string, Promise<AuroraIndex>>();
  const seen = new Set<string>([options.url]);
  const prefetch = (ref: AuroraFileRef, depth: number): void => {
    if (!ref.isIndex || depth >= maxDepth || indexFetches.has(ref.url) || seen.has(ref.url)) return;
    const fetching = limit(() => readIndex(ref.url), true);
    indexFetches.set(ref.url, fetching);
    fetching.then((nested) => nested.files.forEach((child) => prefetch(child, depth + 1)), () => undefined);
  };
  top.files.forEach((ref) => prefetch(ref, 0));

  const root: ContentPart = { name: top.name, title: top.name, url: options.url, isIndex: true, description: top.description };
  const diagnostics: ContentDiagnostic[] = [];
  const files: ContentFile[] = [];
  const elements: Element[] = [];
  const extensions: ElementExtension[] = [];

  /** The walk's queue: parts in the order a load reaches them, each with its node in the tree. */
  const queue: Array<{ ref: AuroraFileRef; depth: number; part: ContentPart }> = [];
  const expand = (parent: ContentPart, refs: AuroraFileRef[], depth: number): void => {
    parent.children = [];
    for (const ref of refs) {
      if (!ref.isIndex && !isAuroraElementFile(ref)) continue;
      const part: ContentPart = { name: ref.name || ref.url, url: ref.url, isIndex: ref.isIndex };
      parent.children.push(part);
      if (seen.has(ref.url)) {
        part.repeated = true;
        continue;
      }
      seen.add(ref.url);
      queue.push({ ref, depth, part });
    }
  };
  expand(root, top.files, 0);

  let done = 0;
  while (queue.length) {
    const { ref, depth, part } = queue.shift()!;
    if (ref.isIndex) {
      done++;
      options.onProgress?.(done, done + queue.length, ref.name || ref.url);
      if (depth >= maxDepth) {
        part.tooDeep = true;
        diagnostics.push({ level: 'warning', message: `Stopped at nesting depth ${maxDepth}: ${ref.url}`, fileUrl: ref.url });
        continue;
      }
      try {
        const nested = await (indexFetches.get(ref.url) ?? limit(() => readIndex(ref.url), true));
        if (nested.name) part.title = nested.name;
        if (nested.description) part.description = nested.description;
        expand(part, nested.files, depth + 1);
      } catch (error) {
        part.failed = (error as Error).message;
        diagnostics.push({ level: 'error', message: `Could not load ${ref.url}: ${(error as Error).message}`, fileUrl: ref.url });
      }
      continue;
    }

    // The run of element files at the head of the queue is fetched together and applied in the order it was named.
    const batch = [{ ref, part }];
    while (queue[0] && !queue[0].ref.isIndex) batch.push(queue.shift()!);
    const texts = await Promise.all(
      batch.map(({ ref: fileRef }) =>
        limit(() => fetchText(fileRef.url)).then(
          (text) => ({ text }),
          (error: unknown) => ({ error: error as Error }),
        ),
      ),
    );
    batch.forEach(({ ref: fileRef }, i) => {
      done++;
      options.onProgress?.(done, done + queue.length, fileRef.name || fileRef.url);
      const answer = texts[i]!;
      if ('error' in answer) {
        const kept = oldFiles.get(fileRef.url);
        if (kept) {
          report.kept.push({ url: fileRef.url, reason: answer.error.message });
          files.push({ url: fileRef.url, ...(fileRef.name ? { name: fileRef.name } : {}) });
          elements.push(...kept.elements);
          extensions.push(...kept.extensions);
          diagnostics.push(...kept.diagnostics);
        } else {
          diagnostics.push({ level: 'error', message: `Could not load ${fileRef.url}: ${answer.error.message}`, fileUrl: fileRef.url });
        }
        return;
      }
      files.push({ url: fileRef.url, ...(fileRef.name ? { name: fileRef.name } : {}) });
      const parsed = parseAuroraElements(answer.text, { sourceId, fileUrl: fileRef.url });
      elements.push(...lastOfEachId(parsed.elements, fileRef.url, diagnostics));
      extensions.push(...parsed.appends);
      diagnostics.push(...parsed.diagnostics);
    });
  }

  const generated = options.withoutGenerated ? [] : withOrigin(auroraGeneratedElements({ sourceId }), APP_ELEMENTS_URL);
  // Derived from the source's own content with its extensions applied, since an extension may carry the tags that say an
  // option is already declared.
  const options_ = options.withoutGenerated
    ? []
    : withOrigin(improvementOptionElements(folded([...generated, ...elements], extensions), { sourceId }).elements, IMPROVEMENT_OPTIONS_URL);

  const bundle: ContentBundle = {
    formatVersion: 1,
    elements: [...generated, ...elements, ...options_],
    ...(extensions.length ? { extensions } : {}),
    source: {
      name: top.name,
      url: options.url,
      ...(top.version !== undefined ? { version: top.version } : {}),
      ...(top.description !== undefined ? { description: top.description } : {}),
      ...(top.author !== undefined ? { author: top.author } : {}),
      parts: root,
      files: [
        ...(generated.length ? [{ url: APP_ELEMENTS_URL, name: "Aurora's own elements", generated: true }] : []),
        ...files,
        ...(options_.length ? [{ url: IMPROVEMENT_OPTIONS_URL, name: 'Ability score improvement options', generated: true }] : []),
      ],
      ...(diagnostics.length ? { diagnostics } : {}),
      ...(Object.keys(etags).length ? { etags } : {}),
      converted: { from: AURORA_FORMAT, converter: CONVERTER_VERSION, ...(options.at ? { at: options.at } : {}) },
    },
  };
  return { bundle, report };
}

export interface ConvertFileOptions {
  /** The file's address as a source: its id, every element's `origin.sourceId` and its one file's URL. */
  url: string;
  /** What the source is called when the file names nothing. */
  name: string;
  at?: string;
}

/**
 * Convert one Aurora elements file a user added (ADR 0056) into a source of its own. Refused with a sentence when it
 * holds nothing to add: an index alone names files at addresses, and anything else holds no element.
 */
export function convertAuroraFile(text: string, options: ConvertFileOptions): ContentBundle {
  const parsed = parseAuroraElements(text, { sourceId: options.url, fileUrl: options.url });
  if (!parsed.elements.length && !parsed.appends.length) {
    if (parseAuroraIndex(text, options.url).files.length) {
      throw new Error(`${options.name} is an index: it lists files at their addresses. Add it by its address instead.`);
    }
    throw new Error(`${options.name} holds no Aurora elements.`);
  }
  const name = parsed.name || options.name.replace(/\.xml$/i, '');
  // A file may hold a class of its own, so it is offered its improvements as a source at an address is.
  const improvements = withOrigin(
    improvementOptionElements(folded(parsed.elements, parsed.appends), { sourceId: options.url }).elements,
    IMPROVEMENT_OPTIONS_URL,
  );
  return {
    formatVersion: 1,
    elements: [...parsed.elements, ...improvements],
    ...(parsed.appends.length ? { extensions: parsed.appends } : {}),
    source: {
      name,
      url: options.url,
      ...(parsed.version !== undefined ? { version: parsed.version } : {}),
      parts: { name, title: name, url: options.url, isIndex: false },
      files: [
        { url: options.url, name: options.name },
        ...(improvements.length ? [{ url: IMPROVEMENT_OPTIONS_URL, name: 'Ability score improvement options', generated: true }] : []),
      ],
      ...(parsed.diagnostics.length ? { diagnostics: parsed.diagnostics } : {}),
      converted: { from: AURORA_FORMAT, converter: CONVERTER_VERSION, ...(options.at ? { at: options.at } : {}) },
    },
  };
}

/**
 * One element per id in a file: Incudo's content format declares an id once per file, and Aurora's app used the last of
 * two (the 2024 Dungeon Master's Guide gives Walloping Ammunition Adamantine Ammunition's id). The later is kept, in its
 * place, and the earlier is reported rather than dropped without a word.
 */
function lastOfEachId(elements: Element[], fileUrl: string, diagnostics: ContentDiagnostic[]): Element[] {
  const last = new Map<string, number>();
  elements.forEach((element, i) => last.set(element.id, i));
  if (last.size === elements.length) return elements;
  return elements.filter((element, i) => {
    if (last.get(element.id) === i) return true;
    diagnostics.push({
      level: 'warning',
      message: `"${element.id}" is declared twice in ${fileUrl}; using the later one, "${elements[last.get(element.id)!]!.name}", over "${element.name}".`,
      elementId: element.id,
      fileUrl,
    });
    return false;
  });
}

function withOrigin(elements: Element[], fileUrl: string): Element[] {
  return elements.map((element) => ({ ...element, origin: { sourceId: element.origin.sourceId, fileUrl } }));
}

/** The elements with every extension naming one of them applied, for deriving from; the bundle keeps them apart. */
function folded(elements: Element[], extensions: ElementExtension[]): Element[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const extension of extensions) {
    const target = byId.get(extension.id);
    if (!target) continue;
    byId.set(extension.id, {
      ...target,
      rules: [...target.rules, ...extension.rules],
      supports: [...target.supports, ...extension.supports],
    });
  }
  return [...byId.values()];
}

/** At most `size` pieces of work in flight, urgent ones first: an index unlocks more work and a file never does. */
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

/**
 * Aurora's converter, in the shape `@incudo/content`'s `SourceConverter` asks for: the app hands it to the content
 * package, which imports nothing of Aurora (ADR 0119).
 */
export const auroraConverter = {
  format: AURORA_FORMAT,
  version: CONVERTER_VERSION,
  convertSource: convertAuroraSource,
  convertFile: convertAuroraFile,
  async latestVersion(fetcher: Fetcher, url: string, options: { resolveByName?: boolean } = {}): Promise<string | undefined> {
    const result = await fetcher.fetchText(url);
    return parseAuroraIndex(result.text, url, options).version;
  },
};
