/**
 * Content bundles for this package's tests: a source as the library is handed it, written file by file. Not exported
 * from the package.
 */

import type { ContentBundle, ContentDiagnostic, ContentPart, ContentSourceInfo, Element, ElementExtension } from '@incudo/core';

import type { SourceConverter } from './source.ts';

export interface TestFile {
  url: string;
  name?: string;
  elements?: Element[];
  extensions?: ElementExtension[];
  diagnostics?: ContentDiagnostic[];
  /** Written by a conversion: loaded whatever parts are off, and only where nothing declares its ids. */
  generated?: boolean;
}

/** A source's bundle: its files in order, each element's origin naming its file, and a flat parts tree unless given one. */
export function testBundle(url: string, files: TestFile[], info: Partial<ContentSourceInfo> = {}): ContentBundle {
  const elements = files.flatMap((file) =>
    (file.elements ?? []).map((element) => ({ ...element, origin: { sourceId: url, fileUrl: file.url } })),
  );
  const extensions = files.flatMap((file) => (file.extensions ?? []).map((extension) => ({ ...extension, fileUrl: file.url })));
  const diagnostics = files.flatMap((file) => file.diagnostics ?? []);
  const parts: ContentPart = info.parts ?? {
    name: url,
    title: url,
    url,
    isIndex: true,
    children: files.filter((file) => !file.generated).map((file) => ({ name: file.name ?? file.url, url: file.url, isIndex: false })),
  };
  return {
    formatVersion: 1,
    elements,
    ...(extensions.length ? { extensions } : {}),
    source: {
      name: url,
      url,
      ...info,
      parts,
      files: files.map((file) => ({ url: file.url, ...(file.name ? { name: file.name } : {}), ...(file.generated ? { generated: true } : {}) })),
      ...(diagnostics.length ? { diagnostics } : {}),
    },
  };
}

/**
 * A converter for tests: a "source" at an address is a content bundle served as JSON, and a "file" is a JSON list of
 * element ids. What it does is what a conversion must: fetch, record the ETag, fall back to the previous conversion
 * when the fetch fails, and say which version wrote it.
 */
export function testConverter(version = 1): SourceConverter & { version: number } {
  return {
    format: 'test',
    version,
    async convertSource({ fetcher, url, sourceId, previous }) {
      let text: string;
      let etag: string | undefined;
      try {
        const result = await fetcher.fetchText(url);
        text = result.text;
        etag = result.etag;
      } catch (error) {
        if (!previous) throw error;
        return { bundle: previous, report: { fetched: 0, unchanged: 0, kept: [{ url, reason: (error as Error).message }] } };
      }
      const bundle = JSON.parse(text) as ContentBundle;
      bundle.elements = bundle.elements.map((element) => ({ ...element, origin: { ...element.origin, sourceId } }));
      bundle.source = {
        ...(bundle.source ?? { name: url }),
        ...(etag ? { etags: { [url]: etag } } : {}),
        converted: { from: 'test', converter: this.version },
      };
      return { bundle, report: { fetched: 1, unchanged: 0, kept: [] } };
    },
    convertFile(text, { url, name }) {
      const ids = JSON.parse(text) as string[];
      if (!ids.length) throw new Error(`${name} holds no elements.`);
      return testBundle(url, [{ url, name, elements: ids.map((id) => testElement(id)) }], { name: name.replace(/\.xml$/i, ''), converted: { from: 'test', converter: this.version } });
    },
    async latestVersion(fetcher, url) {
      return (JSON.parse((await fetcher.fetchText(url)).text) as ContentBundle).source?.version;
    },
  };
}

/** A plain element, for a test. */
export function testElement(id: string, extra: Partial<Element> = {}): Element {
  return { id, type: 'Widget', name: id, source: 'Test', setters: {}, rules: [], supports: [], origin: { sourceId: 'test' }, ...extra };
}
