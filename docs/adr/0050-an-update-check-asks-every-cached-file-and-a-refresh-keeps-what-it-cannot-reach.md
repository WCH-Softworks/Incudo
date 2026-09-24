# 0050 — An update check asks every cached file, and a refresh keeps what it cannot reach

**Status:** Accepted · 2026-09-24 · amends [0029](./0029-a-cache-is-keyed-by-source-and-evicted-by-version.md) ·
builds on [0004](./0004-live-vs-downloaded-content.md) · **port:** `Fetcher.conditional` and
`FetchResult.notModified` in `packages/core/src/platform.ts` · **shell:** `tauri-plugin-http` replaced by the
app's own `fetch_content_text` command (decision 5)

## Context

Phase 3's first item is "live mode hardening: HTTP caching, ETags, offline fallback, partial index loading". ADR
0029 did the caching. This measures what is left and does the next two.

### "Check for updates" cannot see an update to the source everyone uses

`checkSourceForUpdates` compares the version in the **top** index with the one stamped when it was loaded. Every
Aurora file carries its own `<update version>`, and the top index is a list of other indexes. Measured on
2026-09-24:

| | |
|---|---|
| AuroraLegacy.index version | **0.0.1**, last changed upstream **2023-10-01** |
| upstream commits since 2026-06-01 | 10 |
| index files at 0.0.1 | 20 of 60, the top one among them |

So the check says "Up to date at 0.0.1" whatever upstream does, and the one source the 5e definition suggests is
the one it can never flag. Comparing nested versions would help only as far as each index is bumped when a file
under it changes, and nothing enforces that.

### The host answers conditional requests, but only outside a browser

Measured against `raw.githubusercontent.com` on one element file:

| | |
|---|---|
| `ETag` | present, strong, 64 hex digits; not the SHA-256 of the file as checked out, so it cannot be computed locally |
| `If-None-Match` with it | **304**, 0 bytes, 68 ms (a full 200 is 112 KB, 94 ms) |
| `Access-Control-Allow-Origin` | `*` |
| `Access-Control-Expose-Headers` | absent, so a page cannot read `ETag` |
| preflight for `If-None-Match` from `http://localhost:5173` | **403** |

A conditional request is cheap and exact, and it is only possible where there is no CORS: in the Tauri build, whose
HTTP plugin is not a browser. In the browser build, sending `If-None-Match` would make the request need a
preflight, the preflight fails, and so would every fetch that carried one.

### A refresh throws the cache away before it knows it can replace it

ADR 0029's refresh evicts a source's whole cache and then reloads. It named the cost itself: "a refresh over a bad
connection can leave a source with less cached content than it started with". Offline, a refresh leaves nothing.

## Decision

### 1. A fetcher says whether it can make a conditional request

`Fetcher.conditional?: boolean`. A fetcher that sets it sends `FetchOptions.etag` as `If-None-Match`, returns the
response's `ETag`, and answers a 304 with `notModified: true` and empty text instead of throwing. A fetcher that
does not set it **ignores `etag`** and never reports one. The desktop fetcher sets it under Tauri and not in a
browser; a test fetcher sets it when the test says so.

### 2. The ETag is cached beside the file

Written through with the text, at `content/<source>/.etag/<url>`, inside the source's prefix so ADR 0029's per-source
eviction still takes everything. A 200 without an ETag removes a stale one.

### 3. An update check asks every file the source has cached, and still writes nothing

When the fetcher is conditional and the source has ETags cached, the check sends one conditional request per cached
file, six at a time, as a load does. It reports `outdated` with how many files changed and how many were asked, or
`current` with how many were asked. A file the network cannot reach is counted as unanswered and the check says so;
if none answers, the state is `unknown`. With no ETags, which is the browser build and any host that sends none, it
compares versions as before and says that is all it could do.

It still writes nothing: not the text, not the ETag, not the stamp. ADR 0029's reason stands.

A file **added** upstream is seen only through the index that names it: that index changes, so the source is
reported outdated. A file removed upstream is the same.

### 4. A refresh is network first, keeps what it cannot reach, and prunes what nothing names

Refresh no longer evicts first. It loads the source with the network in front of the cache:

- a file with a cached ETag is asked conditionally: **304 keeps the cached copy** without downloading it, 200
  replaces it;
- a file the network cannot reach is served from the cache and **reported as kept**, with the reason;
- a file neither can supply is an error, as it was;
- afterwards, every cached key under the source that the load did not touch is removed: a file upstream dropped
  from its index. Nothing is pruned if the top index could not be read at all.

It reports how many files were fetched, how many were unchanged, which were kept and why, and how many were removed.
The version stamp is written as before. Refreshing with no network at all now leaves the cache as it was.

### 5. The Tauri build fetches content through its own command, over one client

Found by running it, not by a test. The first build of decisions 1 to 4 went through `tauri-plugin-http`, and in
the Tauri window on Windows a check of the 800 cached files (740 element files and 60 indexes) took **113 s** the
first time and did not finish in 300 s the second, holding the window busy. Timed one at a time, most conditional
requests took about 200 ms and 58 of 720 stalled for 3.2, 7.2 or 15.2 s, one for 28 s: TCP connection retries.
The plugin (2.6.0, and 2.7.0 does the same) builds a new `reqwest` client for every request, so every file opened
its own connection. Replayed from Node, 400 conditional requests over reused connections took **1.3 s**, and the
same 400 each on a new connection failed with connect timeouts: the host throttles new connections.

So the shell has one command, `fetch_content_text` in `src-tauri/src/lib.rs`: a URL and an optional ETag in, a
status, text and ETag out, over **one client kept for the life of the window**, https only, redirects followed
only to https, a 15 s connect timeout and a 120 s request timeout. `DesktopFetcher` calls it under Tauri and
`window.fetch` in a browser. The plugin is removed, and with it the capability that let the page make any https
request of its own. It knows nothing about content; it is a transport, like `allow_library_folder` is a scope.

## What was measured after it was built

In the Tauri window on Windows, against AuroraLegacy/elements, 800 files:

| | through the plugin | through the command |
|---|---|---|
| check, ETags cached, app idle | 113 s, then over 300 s | **3.1 s** (25 s on a first run just after start-up) |
| refresh, nothing changed | (evicted and re-downloaded everything under ADR 0029) | **6.2 s**, 0 downloaded, 800 unchanged, reload included |
| refresh, no ETags cached (a full download) | 81 s | **10.8 s** |

- A cache written before this has no ETags, so the first check says only the index version could be compared, and
  the first refresh downloads everything once and caches them. Seen in the window, in that order.
- In the browser build the check says the same about the index version (0.5 s) and a refresh downloads all 800
  and keeps what fails, as designed.
- `packages/content/src/revalidate.test.ts` holds decisions 1 to 4 with a fake host (ETags cached only by a
  conditional fetcher; a check that counts and writes nothing; a refresh that downloads only what changed, keeps
  everything offline, and prunes what the index stopped naming; a non-conditional fetcher never handed an ETag),
  each checked by breaking it.
- **Not measured:** a refresh with the network cut in the window (the test holds it; the window was not taken
  offline), a host that sends no ETag, and macOS or Linux.

## What this does not do

- **Partial index loading** (ADR 0029's "the gap is named"). `stream` still loads every file of a source on first
  use. Lazy loading needs an index that can miss and a builder that can wait; it is the rest of this roadmap item.
- **Nothing refreshes on its own.** A check reports and a refresh is asked for (ADR 0029).
- **The browser build gets the offline fallback and the prune, not the conditional requests.** Its check is still
  the version comparison, and it says so.
- **A 304 is trusted.** A host that answered 304 for changed content would keep a stale copy until the next refresh
  that got a 200. Nothing here can tell.

## Consequences

- "Check for updates" can flag the AuroraLegacy source for the first time, and says how much changed.
- A refresh downloads only what changed, where the host allows conditional requests, and a refresh that cannot reach
  the network costs nothing.
- The cache holds one more small key per file.
- `Fetcher` gains an optional flag and `FetchResult` an optional field; a fetcher that knows neither behaves exactly as
  before.
- The desktop shell has a second piece of Rust. ADR 0001 said the Rust side is "the generated shell plus plugins";
  a plugin that opens a connection per request turned out to be the slowest part of the app, and a transport is
  still not application code.

## Alternatives considered

- **Compare every nested index's version.** Cheaper (60 requests), and only as good as upstream's discipline about
  bumping an index when a file under it changes, which the top index already shows is not kept.
- **Fetch every file in full and compare text.** Exact and works in a browser, but a check would download the whole
  corpus (tens of megabytes) to say "nothing changed". Rejected for the check; it is what a refresh without ETags
  does anyway.
- **The GitHub API's commit list.** Exact for one host and nothing else; the product is "any content index".
- **Keep evicting first.** Rejected: the failure ADR 0029 named is the common case on a train.
