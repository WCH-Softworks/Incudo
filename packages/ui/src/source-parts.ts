/**
 * Choosing the parts of a source — ADR 0055.
 *
 * The Sources pane renders this and computes nothing: what each part is called, whether it is on, whether it can load at
 * all given the parts above it, and how many element files it holds and how many of those will load. The toggling is
 * here too, so "switching off Core leaves a book on that cannot load" is a thing a test can say.
 *
 * The total of files that will load is worked out the way the load walks (level by level, each URL once, a switched-off
 * part never read), so it is the number a load reports. The per-part counts are for reading the tree and attribute each
 * file to the place it is listed first.
 */

import type { IndexTreeNode } from '@incudo/content';

export interface PartView {
  /** Unique within the tree, for a renderer's keys: the path of positions from the top. */
  key: string;
  url: string;
  /** What to call it: what an index calls itself when it was read, otherwise what its parent lists it as. */
  label: string;
  /** What its parent lists it as, a file name in Aurora's indexes; for showing beside `label` when they differ. */
  listedAs: string;
  isIndex: boolean;
  description?: string;
  /** Its own switch. */
  on: boolean;
  /** False when a part above it is off: it cannot load whatever its own switch says. */
  reachable: boolean;
  /** Element files at or under it, each counted where it is listed first. 1 for a file listed here first. */
  files: number;
  /** Of `files`, how many will load as the switches stand. */
  filesLoading: number;
  /** Why this index could not be read; it can still be switched off. */
  failed?: string;
  /** Listed earlier in the tree too; its switch is that part's switch. */
  repeated?: boolean;
  /** Below the depth a load follows. */
  tooDeep?: boolean;
  children: PartView[];
}

export interface PartsView {
  /** What the source calls itself. */
  name: string;
  description?: string;
  parts: PartView[];
  /** Element files the source lists, and how many of them will load. */
  files: number;
  filesLoading: number;
  /** Parts switched off that the tree still names, in the order it names them. */
  excluded: string[];
}

export function partsView(tree: IndexTreeNode, excluded: readonly string[]): PartsView {
  const off = new Set(excluded);
  const loading = filesThatLoad(tree, off);

  const view = (node: IndexTreeNode, key: string, reachable: boolean): PartView => {
    const on = !off.has(node.url);
    const children = (node.children ?? []).map((child, i) => view(child, `${key}.${i}`, reachable && on));
    const firstFile = !node.isIndex && !node.repeated;
    const files = firstFile ? 1 : children.reduce((sum, child) => sum + child.files, 0);
    const filesLoading = !reachable || !on
      ? 0
      : firstFile
        ? loading.has(node.url) ? 1 : 0
        : children.reduce((sum, child) => sum + child.filesLoading, 0);
    return {
      key,
      url: node.url,
      label: node.title || node.name,
      listedAs: node.name,
      isIndex: node.isIndex,
      description: node.description,
      on,
      reachable,
      files,
      filesLoading,
      failed: node.failed,
      repeated: node.repeated,
      tooDeep: node.tooDeep,
      children,
    };
  };

  const parts = (tree.children ?? []).map((child, i) => view(child, `${i}`, true));
  return {
    name: tree.title || tree.name,
    description: tree.description,
    parts,
    files: parts.reduce((sum, part) => sum + part.files, 0),
    filesLoading: loading.size,
    excluded: excludedWithin(tree, excluded),
  };
}

/** Switch one part on if it is off, or off if it is on. Returns a new list. */
export function togglePart(excluded: readonly string[], url: string): string[] {
  return excluded.includes(url) ? excluded.filter((entry) => entry !== url) : [...excluded, url];
}

/**
 * The switched-off parts the tree still names, in the order it names them, each once. What a chooser saves: a part
 * upstream stopped listing is not carried forward, since there is nothing left to show it by.
 */
export function excludedWithin(tree: IndexTreeNode, excluded: readonly string[]): string[] {
  const off = new Set(excluded);
  const found: string[] = [];
  const walk = (node: IndexTreeNode): void => {
    for (const child of node.children ?? []) {
      if (off.has(child.url) && !found.includes(child.url)) found.push(child.url);
      walk(child);
    }
  };
  walk(tree);
  return found;
}

/**
 * The element files a load reads with these parts off: level by level from the top, each URL once at its first
 * mention, a switched-off part neither loaded nor, for an index, read. A part the tree lists again later stands for
 * the first listing's parts, since that is the index the load would read there.
 */
function filesThatLoad(tree: IndexTreeNode, off: ReadonlySet<string>): Set<string> {
  const expanded = new Map<string, IndexTreeNode>();
  const index = (node: IndexTreeNode): void => {
    for (const child of node.children ?? []) {
      if (child.isIndex && child.children && !expanded.has(child.url)) expanded.set(child.url, child);
      index(child);
    }
  };
  index(tree);

  const loaded = new Set<string>();
  const seen = new Set<string>([tree.url]);
  let level = tree.children ?? [];
  while (level.length) {
    const next: IndexTreeNode[] = [];
    for (const node of level) {
      if (off.has(node.url) || seen.has(node.url)) continue;
      seen.add(node.url);
      if (node.isIndex) next.push(...(expanded.get(node.url)?.children ?? []));
      else loaded.add(node.url);
    }
    level = next;
  }
  return loaded;
}
