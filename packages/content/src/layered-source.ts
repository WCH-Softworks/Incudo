/**
 * cache -> network -> bundled, first hit wins.
 *
 * This is what makes "live" safe: a source the user streams still works on a train,
 * because everything it has fetched was written through to the cache.
 */

import type { ContentIndex, ContentSource, ElementFile, FileRef, UpdateStatus } from './source.ts';

export class LayeredContentSource implements ContentSource {
  readonly id: string;
  private readonly layers: ContentSource[];
  /** The layer that can reach the network, if any — used for update checks. */
  private readonly networkLayer: ContentSource | undefined;

  constructor(id: string, layers: ContentSource[], networkLayer?: ContentSource) {
    this.id = id;
    this.layers = layers;
    this.networkLayer = networkLayer;
  }

  async loadIndex(url: string): Promise<ContentIndex> {
    return this.firstSuccess((layer) => layer.loadIndex(url));
  }

  async loadFile(ref: FileRef): Promise<ElementFile> {
    return this.firstSuccess((layer) => layer.loadFile(ref));
  }

  async checkForUpdates(index: ContentIndex): Promise<UpdateStatus> {
    if (!this.networkLayer) return { state: 'unknown', reason: 'Offline.' };
    return this.networkLayer.checkForUpdates(index);
  }

  /**
   * Every layer's reason, in the order they were tried, and nothing else. The caller names the
   * address (ContentLibrary: "Could not load <url>: …"), and the layers of one source share its id,
   * so a label per layer or a headline here repeated the URL up to six times in one message.
   */
  private async firstSuccess<T>(attempt: (layer: ContentSource) => Promise<T>): Promise<T> {
    const failures: string[] = [];
    for (const layer of this.layers) {
      try {
        return await attempt(layer);
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
    throw new Error(failures.join('; '));
  }
}
