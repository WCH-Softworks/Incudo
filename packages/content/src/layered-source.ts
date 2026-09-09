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
    return this.firstSuccess((layer) => layer.loadIndex(url), `index ${url}`);
  }

  async loadFile(ref: FileRef): Promise<ElementFile> {
    return this.firstSuccess((layer) => layer.loadFile(ref), `file ${ref.url}`);
  }

  async checkForUpdates(index: ContentIndex): Promise<UpdateStatus> {
    if (!this.networkLayer) return { state: 'unknown', reason: 'Offline.' };
    return this.networkLayer.checkForUpdates(index);
  }

  private async firstSuccess<T>(
    attempt: (layer: ContentSource) => Promise<T>,
    what: string,
  ): Promise<T> {
    const failures: string[] = [];
    for (const layer of this.layers) {
      try {
        return await attempt(layer);
      } catch (error) {
        failures.push(`${layer.id}: ${(error as Error).message}`);
      }
    }
    throw new Error(`Could not load ${what}. Tried ${failures.join('; ')}`);
  }
}
