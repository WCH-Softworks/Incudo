# 0004 — Content sources are composable; live and offline are both first-class

**Status:** Accepted · 2026-09-09 · **open questions answered by
[ADR 0028](./0028-sources-are-a-profile-characters-carry-an-allowlist.md) and
[ADR 0029](./0029-a-cache-is-keyed-by-source-and-evicted-by-version.md)**

> **Both open questions below are now closed, and one mitigation here was changed.** Pinning a
> character to a source version is answered **no** (ADR 0028): a save already carries its content,
> so a git ref would buy nothing and require every source to be a git host. The rate-limit
> question is measured in ADR 0029 — 238 files, 44.8 s cold and sequential, 1.2 s at six at a
> time, no failures and no throttling at six or twelve. And "versioned cache keys" below is
> **not** what was built: the key is per source and per URL, the version is a stamp beside it,
> and a refresh evicts that source's cache. ADR 0029 says why.
>
> **"Lazy per-file" is withdrawn** ([ADR 0051](./0051-lazy-loading-is-declined-and-the-index-walk-stops-waiting-on-itself.md)).
> A character holds a dozen of AuroraLegacy's 740 files, but building one is offered choices from 373 of them, and an
> Aurora index cannot say what a file holds without fetching it. `HttpContentSource` still fetches per file; the
> library loads every file a source lists, and "a character that uses two of forty files pays for two" is true of a
> save (ADR 0012), not of a build.

## Context

Aurora downloads content: you paste an index URL into "Additional Content" and it fetches
everything into a folder. That is good for offline play and bad for everything else — you cannot
browse a source before committing to it, updates are a manual re-download, and a phone with a
few hundred MB of homebrew is a poor experience.

The requirement is that Incudo offer both: read straight from the repo, or download for
offline.

## Decision

One interface, several implementations, composed rather than chosen once:

```ts
interface ContentSource {
  loadIndex(url: string): Promise<ContentIndex>;
  loadFile(ref: FileRef): Promise<ElementFile>;
  checkForUpdates(index: ContentIndex): Promise<UpdateStatus>;
}
```

- `HttpContentSource` — fetch on demand, resolve URLs relative to the index, lazy per-file
- `CachedContentSource` — versioned local copy, fully offline
- `BundledContentSource` — shipped with the app (SRD-safe only)
- `LayeredContentSource` — cache → network → bundled, first hit wins

The user-facing setting is **per source**: *stream* or *download*, switchable at any time.
Defaults: desktop streams, mobile downloads.

Critically, **live mode still writes through to the cache.** A streamed source that has been used
once is usable offline afterwards; going offline degrades to "what you last saw" rather than
failing. There is no separate "offline mode" switch to forget to flip.

## Consequences

**Good**
- Browse a homebrew index before deciding to keep it — impossible in Aurora.
- Updates are checked against `index.update.version`, not re-downloaded blindly.
- Lazy per-file loading means a character that uses two of forty files pays for two.
- Mobile does not need to pull hundreds of MB to open a character sheet.

**Bad / accepted**
- Cache invalidation is now a real problem the project owns. Mitigated by versioned cache keys
  and by recording, in the character file, which source versions it was built against.
- A streamed source can change under a character between sessions. This is *why* `Character.sources`
  records versions: the app warns instead of silently changing someone's character.
- More moving parts than "download a folder". Accepted — this is a headline feature.

## Open questions

- Should a character be *pinnable* to a source version (fetch that git ref)? Attractive for
  reproducibility; needs the source to be a git host. Defer until Phase 2.
- Rate limits on raw.githubusercontent.com under lazy per-file loading — needs measuring.
