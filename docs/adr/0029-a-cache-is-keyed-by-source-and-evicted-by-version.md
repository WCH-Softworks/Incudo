# 0029 — A source's cache is keyed by source, evicted by version, and filled six files at a time

**Status:** Accepted · 2026-09-11
**Answers the open problems in:** [ADR 0004](./0004-live-vs-downloaded-content.md)

## Context

ADR 0004 designed four content sources and composed them: cache → network → bundled, first hit
wins. `CachedContentSource` and `LayeredContentSource` were both written. **The app composed
neither.** `apps/desktop/src/content.ts` built a bare `HttpContentSource` with `writeThrough`,
which writes a cache that nothing has ever read back — so reloading the page re-fetched every
file, measured below at about three quarters of a minute, every time.

ADR 0004 named the two things it did not settle:

> Cache invalidation is now a real problem the project owns. Mitigated by versioned cache keys …

> Rate limits on raw.githubusercontent.com under lazy per-file loading — needs measuring.

Neither was owned by anything. This is both of them.

## Decision

### Compose the layers that already exist

Each enabled source in the profile ([ADR 0028](./0028-sources-are-a-profile-characters-carry-an-allowlist.md))
becomes `LayeredContentSource([cache, http], http)` — the cache first, the network behind it,
and the network layer named separately so update checks have something to ask. The HTTP layer
keeps its `writeThrough`, so a streamed source becomes offline-capable by being used. No new
class. ADR 0004's design was right; it was simply never wired up.

### The key is the source and the URL. The version is a stamp beside it.

`content/<sourceId>/<url>`, which is what `cacheKey` has always produced. Per-source, so one
source's cache can be evicted without touching another's, and the source id is the index URL, so
two indexes cannot collide.

The last-seen version is stored **beside** the cache, at `content/<sourceId>/.version`, not
inside the key.

ADR 0004 said "versioned cache keys" and this departs from it deliberately. Putting the version
in the key makes an update a *copy*: generation N-1 stays on disk forever because nothing is
responsible for reaping it, and a user with twenty sources that update monthly grows without
bound while every byte after the first generation is dead. One generation plus an explicit
eviction is bounded, and the thing that makes versioned keys attractive — being able to roll back
— is not a feature this project offers.

### `checkForUpdates` never writes

It fetches the index, compares its version against the stamp, and returns
`{state: 'current' | 'outdated' | 'unknown'}`. Reporting is the whole job. A check that quietly
refreshed would be the silent update ADR 0012 spent a whole section refusing.

### Refreshing evicts that source's cache, and nothing else

`storage.list('content/<sourceId>/')`, remove each key, re-stamp the version, reload. One source
at a time, never a global flush, because a global flush punishes the twenty sources that did not
change for the one that did.

**There is no TTL.** Cached content is re-fetched when the user asks and at no other time. Opt-in
beats silent, which is the same sentence ADR 0012 uses about content refreshes reaching a
character.

### Fetching is parallel: six files at a time

Measured against the live AuroraLegacy `core.index` (238 element files) on this machine:

| | time | failures |
|---|---|---|
| sequential, cold | **44.8 s** | 0 |
| sequential, warm | 4.5 s | 0 |
| 6 at a time, warm | **1.2 s** | 0 |
| 12 at a time, warm | 1.0 s | 0 |

The cold sequential run is the one CLAUDE.md has been describing as "244 files, about a minute",
and it reproduces. What the numbers say is that essentially all of it is round-trip latency:
warming the CDN takes sequential from 44.8 s to 4.5 s, and overlapping six requests takes it to
1.2 s. **No request failed and nothing rate-limited, at 6 or at 12.** Twelve buys two tenths of a
second over six, which is not worth being twice as rude to a host that is doing this for free, so
six it is.

Honest limits on that measurement: one machine, one network, one index, warm and cold runs that
could not be made cold again on demand. It is enough to answer "parallelise?" with yes and
"how hard?" with "not very".

Determinism is preserved rather than traded away. A batch is applied to the element index **in
the order the refs appeared**, never in the order the fetches finished, so which file wins a
duplicate id and what order the diagnostics come out in are byte-identical to a sequential load.
Nested indexes are still resolved one at a time — the next batch is not known until one is
parsed. The corpus baseline (740 files, 12,058 elements, 0 errors, 1 unresolved, 57 warnings) is
unchanged, which is the check that matters.

### What `stream` and `download` actually mean today

They are recorded per source (`SourceMode`, in the profile and on every `SourceRef`) and they
differ in exactly one thing: **when** the files are fetched.

- `download` — fetched when the source is added, and kept. Offline from then on.
- `stream` — nothing is fetched until the source is first used, and what is fetched is written
  through, so it is offline from then on too.

**The gap is named rather than papered over.** ADR 0004's `stream` is *lazy per-file* loading —
"a character that uses two of forty files pays for two" — and that is not what this is.
`ContentLibrary` builds a whole `ElementIndex` up front because the builder asks it for candidate
lists, and genuinely lazy loading needs an index that can miss and a caller that can wait. Until
that exists, the toggle is a real setting with a small real effect, and this paragraph is the
record that it is not yet the big one.

## Consequences

**Good**

- A reload costs nothing. The second load of a source is local, which is the difference between
  an app you can iterate on and one you make coffee during.
- The first load is roughly forty times faster on a cold cache.
- Eviction is per source, explicit, and bounded; disk does not grow behind the user's back.
- `checkForUpdates` and `UpdateStatus` finally have a caller, three months after being written.

**Bad / accepted**

- A source with no version in its index reads as `unknown` forever and can only be refreshed by
  hand. Aurora indexes usually carry one; some homebrew does not.
- Six concurrent requests is a guess dressed in one measurement. It is polite, it is fast enough,
  and it is one constant to change.
- The cache and the library are different things in different places: the library is a folder the
  user picked (ADR 0027), the cache is app-managed storage they never see. Deliberate — one is
  their data and the other is a copy of someone else's.
- Evicting on refresh means a refresh over a bad connection can leave a source with less cached
  content than it started with. The layered source degrades to what it has, so this is slow
  rather than broken, but it is a real regression case.

## Alternatives considered

- **Versioned cache keys**, as ADR 0004 sketched. Rejected above: unbounded, unreaped.
- **A TTL.** Re-fetching on a timer is the silent update this project keeps refusing, and it
  would do it while the user is offline on a train, which is exactly when it hurts.
- **One flat cache across sources**, keyed by URL alone. Cheaper, and it makes "remove this
  source and its downloaded copy" impossible to implement.
- **Unlimited concurrency.** Faster by two tenths of a second, and it makes a rate limit a
  problem the user discovers rather than one the project avoided.
