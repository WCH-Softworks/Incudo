/**
 * Loads of a system's sources that may overlap, and which of them may publish what they loaded.
 *
 * Switching two sources quickly starts two loads, and nothing makes them finish in the order they began: the first is
 * often the slower. Published in the order they finished, the earlier load's content won, with the source switched last
 * in the state before the switch, and the first load to finish said nothing was loading while the other still ran
 * (found on the desktop by ADR 0090's drive; the phone's `ContentSources` had the same shape).
 *
 * So a load publishes only when the sources it loaded are still the ones switched on when it ends, compared by
 * `sourcesLoadKey`; and "loading" ends when a load publishes or when no other load of the same system is running. Not
 * "the load begun last": switching a source off and on again makes an earlier set current again. Nothing is
 * cancelled: a load that does not publish runs to its end, and what it fetched is cached as any load's is.
 */

import type { ConfiguredSource } from '@incudo/content';

/** A load's identity: which sources, in which order, kept which way, with which parts switched off. */
export function sourcesLoadKey(sources: readonly ConfiguredSource[]): string {
  return JSON.stringify(sources.map((source) => [source.id, source.excluded ?? []]));
}

/** What a load that has ended may do. */
export interface LoadEnd {
  /** Its sources are the ones switched on now: what it loaded (or the error it met) is the one to show. */
  publish: boolean;
  /** Nothing still running will publish for this system: the shell may stop saying it is loading. */
  idle: boolean;
}

export class SourceLoads<S = string> {
  private readonly running = new Map<S, number>();

  /**
   * Mark a load of `system` as begun. The function it returns is called once when the load ends, with whether its
   * sources are still the ones switched on.
   */
  begin(system: S): (current: boolean) => LoadEnd {
    this.running.set(system, (this.running.get(system) ?? 0) + 1);
    let ended = false;
    return (current) => {
      if (ended) throw new Error('A load ended twice');
      ended = true;
      const left = (this.running.get(system) ?? 1) - 1;
      if (left > 0) this.running.set(system, left);
      else this.running.delete(system);
      return { publish: current, idle: current || left === 0 };
    };
  }
}
