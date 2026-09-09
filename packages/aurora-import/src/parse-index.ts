/**
 * Aurora `.index` files.
 *
 * An index carries metadata plus a list of files, each of which may itself be an index.
 * URLs are absolute in practice, but they are resolved against the index URL anyway so a
 * local checkout and a relative-URL index both work.
 */

import { parseXml, firstChild, childrenNamed, findFirst, type XmlNode } from './xml.ts';

export interface AuroraFileRef {
  name: string;
  url: string;
  /** True when the referenced file is itself an index. */
  isIndex: boolean;
}

export interface AuroraIndex {
  /** The URL this index was loaded from; the identity of the source. */
  url: string;
  name: string;
  description?: string;
  author?: string;
  authorUrl?: string;
  /** The version an update check compares against. */
  version?: string;
  /** Where the index says to look for its own updates. */
  selfUrl?: string;
  files: AuroraFileRef[];
}

export interface ParseIndexOptions {
  /**
   * Read an Aurora *download folder* rather than a repository.
   *
   * Aurora's downloader does not mirror the upstream repo. It gives every index a folder
   * named after it, and drops that index's files inside by their `name` attribute —
   * recursively. So `custom/AuroraLegacy.index` puts `core.index` at
   * `custom/AuroraLegacy/core.index`, which in turn puts `players-handbook.index` at
   * `custom/AuroraLegacy/core/players-handbook.index`, and so on.
   *
   * For AuroraLegacy this happens to coincide with the repo layout; for the original
   * `aurorabuilder/elements` third-party index it does not, which is how the rule was
   * found. Verified against a real 740-file Aurora install.
   */
  resolveByName?: boolean;
}

export function parseAuroraIndex(
  xml: string,
  url: string,
  options: ParseIndexOptions = {},
): AuroraIndex {
  const doc = parseXml(xml);
  const index = findFirst(doc, 'index') ?? doc;
  const info = firstChild(index, 'info');

  const update = info ? firstChild(info, 'update') : undefined;
  const selfFile = update ? firstChild(update, 'file') : undefined;
  const author = info ? firstChild(info, 'author') : undefined;

  const filesNode = firstChild(index, 'files');
  const files = (filesNode ? childrenNamed(filesNode, 'file') : []).map((node) =>
    toFileRef(node, url, options.resolveByName ?? false),
  );

  return {
    url,
    name: textOf(info, 'name') ?? 'Unnamed source',
    description: textOf(info, 'description'),
    author: author?.text.trim() || undefined,
    authorUrl: author?.attrs['url'],
    version: update?.attrs['version'],
    selfUrl: selfFile ? resolveUrl(selfFile.attrs['url'] ?? '', url) : undefined,
    files,
  };
}

function toFileRef(node: XmlNode, baseUrl: string, resolveByName: boolean): AuroraFileRef {
  const name = node.attrs['name'] ?? '';
  const remote = node.attrs['url'] ?? name;
  const isIndex =
    name.toLowerCase().endsWith('.index') || remote.toLowerCase().endsWith('.index');

  if (resolveByName && name !== '') {
    // Children live in a folder named after this index, addressed by `name`.
    const folder = baseUrl.replace(/\.index$/i, '');
    const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
    return { name, url: `${folder}${sep}${name}`, isIndex };
  }

  return { name, url: resolveUrl(remote, baseUrl), isIndex };
}

function textOf(node: XmlNode | undefined, name: string): string | undefined {
  if (!node) return undefined;
  const child = firstChild(node, name);
  const value = child?.text.trim();
  return value || undefined;
}

/**
 * Resolve a possibly-relative URL against the index's own location.
 * Works for http(s) and for plain filesystem paths, so a local checkout of a content
 * repo can be validated without a server.
 */
export function resolveUrl(raw: string, baseUrl: string): string {
  if (raw === '') return raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl)) {
    try {
      return new URL(raw, baseUrl).toString();
    } catch {
      return raw;
    }
  }
  // Filesystem-ish base: join on the last separator.
  const sep = baseUrl.includes('\\') && !baseUrl.includes('/') ? '\\' : '/';
  const cut = Math.max(baseUrl.lastIndexOf('/'), baseUrl.lastIndexOf('\\'));
  const dir = cut === -1 ? '' : baseUrl.slice(0, cut);
  return dir ? `${dir}${sep}${raw}` : raw;
}
