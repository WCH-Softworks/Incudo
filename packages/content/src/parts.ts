/**
 * The parts of a source — ADR 0055.
 *
 * A source may record parts the user switched off (`ConfiguredSource.excluded`). This file says what a load then
 * skips, and reads the tree the user chooses from: every nested index and element file a source names, from its
 * indexes alone, listing exactly what a load would consider.
 */

import { DEFAULT_CONCURRENCY, DEFAULT_MAX_DEPTH, isElementFile } from './library.ts';
import type { ConfiguredSource } from './profile.ts';
import type { ContentSource, FileRef } from './source.ts';

/**
 * What a load of this source includes, for `LoadOptions.include`: every ref whose URL is not switched off. Matching by
 * URL is how the load already decides a file was loaded, so a part named twice is off in both places, and a switched-off
 * index is never read, so nothing under it is either. Undefined when nothing is switched off.
 */
export function partsFilter(source: Pick<ConfiguredSource, 'excluded'>): ((ref: FileRef) => boolean) | undefined {
  if (!source.excluded?.length) return undefined;
  const off = new Set(source.excluded);
  return (ref) => !off.has(ref.url);
}

/** One part of a source: a nested index or an element file, as its parent names it. */
export interface IndexTreeNode {
  /** What the parent index calls it; for the top index, what it calls itself. */
  name: string;
  url: string;
  isIndex: boolean;
  /**
   * An index's own parts, in the order it lists them. Absent for a file, and for an index that could not be read,
   * was named earlier in the tree, or sits below the depth a load follows.
   */
  children?: IndexTreeNode[];
  /**
   * What an index that was read calls itself (`<info><name>`), which is usually more readable than the file name its
   * parent gives it: "Lost Mine of Phandelver" rather than `lost-mines-phandelver.index`.
   */
  title?: string;
  /** An index's own description, when it has one. */
  description?: string;
  /** Why this index could not be read. It can still be switched off. */
  failed?: string;
  /**
   * Named earlier in the tree too. A load reads a URL once, at its first mention, so its parts are listed there;
   * switching it off here switches that one off as well.
   */
  repeated?: boolean;
  /** Below the depth a load follows, so a load would not read it. */
  tooDeep?: boolean;
}

export interface ReadTreeOptions {
  maxDepth?: number;
  concurrency?: number;
}

/**
 * Read a source's tree of parts from its indexes, without loading a single element file.
 *
 * Level by level, the way the load's queue reaches them, so "first mention" means what it does for the load; each level
 * is read at most `concurrency` at a time. Through whatever source the caller hands in: the composed one a load uses,
 * so the indexes read here are cached for the load that follows. Throws only when the top index cannot be read.
 */
export async function readIndexTree(
  source: ContentSource,
  url: string,
  options: ReadTreeOptions = {},
): Promise<IndexTreeNode> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  const top = await source.loadIndex(url);
  const root: IndexTreeNode = { name: top.name, title: top.name, url, isIndex: true, description: top.description };
  // The top index too: one that names it again lists nothing new, since everything below it is already here.
  const seen = new Set<string>([url]);

  /** The parts an index lists, as nodes, with the load's own skip rules; the indexes among them still to be read. */
  const expand = (node: IndexTreeNode, files: FileRef[], depth: number): IndexTreeNode[] => {
    const next: IndexTreeNode[] = [];
    node.children = [];
    for (const ref of files) {
      if (!ref.isIndex && !isElementFile(ref)) continue;
      const child: IndexTreeNode = { name: ref.name || ref.url, url: ref.url, isIndex: ref.isIndex };
      node.children.push(child);
      if (seen.has(ref.url)) {
        child.repeated = true;
        continue;
      }
      seen.add(ref.url);
      if (!ref.isIndex) continue;
      if (depth >= maxDepth) child.tooDeep = true;
      else next.push(child);
    }
    return next;
  };

  let level = expand(root, top.files, 0);
  for (let depth = 1; level.length; depth++) {
    const read: Array<{ node: IndexTreeNode; files: FileRef[] }> = [];
    for (let start = 0; start < level.length; start += concurrency) {
      const batch = level.slice(start, start + concurrency);
      await Promise.all(
        batch.map(async (node) => {
          try {
            const index = await source.loadIndex(node.url);
            if (index.name) node.title = index.name;
            if (index.description) node.description = index.description;
            read.push({ node, files: index.files });
          } catch (error) {
            node.failed = (error as Error).message;
          }
        }),
      );
    }
    // Expanded in the order the level lists them, never the order the reads finished.
    read.sort((a, b) => level.indexOf(a.node) - level.indexOf(b.node));
    const next: IndexTreeNode[] = [];
    for (const { node, files } of read) next.push(...expand(node, files, depth));
    level = next;
  }
  return root;
}
