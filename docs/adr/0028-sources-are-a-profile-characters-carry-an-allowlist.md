# 0028 — Configured sources are a profile; a character's sources are a record it carries

**Status:** Accepted · 2026-09-11
**Answers an open question in:** [ADR 0004](./0004-live-vs-downloaded-content.md)

## Context

Two lists of sources exist in this project and nothing has ever said how they relate.

- `Character.sources` — an allowlist with versions, written into every save since
  [ADR 0007](./0007-native-formats.md) and carrying `{ id, name, version, mode }`. The Aurora
  importer fills it by inverting a 37,235-entry exclusion list down to the one to four sources a
  character actually draws on.
- The sources the **user** has configured. These did not exist: the app had one text box holding
  one URL, and nothing persisted.

[ADR 0004](./0004-live-vs-downloaded-content.md) says a recorded version is *why* the app "warns
instead of silently changing someone's character", and nothing implements that.

It also left an open question: *should a character be pinnable to a source version?* — deferred
to Phase 2, which is now.

## Decision

### Two lists, and only one direction of travel

**The profile is the user's.** Which sources exist, what the user calls them, whether they are
enabled, whether they stream or download, and the version last seen. It lives in the injected
`Storage` under `sources/profile.json`. It is never written into a character.

**A character's `sources` is a record of what that character was built against.** It is
provenance and an update path, exactly as ADR 0012 says, and it is written only when a character
is saved after actually drawing on that source. Opening a character does **not** stamp the
profile's current versions onto it; that would destroy the one piece of information the warning
needs.

### The profile is never consulted to open a character

Opening derives from the container's embedded content (ADR 0012) and reads the profile not at
all. The profile is consulted when *building* — it is what decides which elements are available
to choose from next. A character opens identically with an empty profile, which is the property
[ADR 0027](./0027-a-library-is-a-folder.md)'s library screen is built on.

### Three states, computed and reported, never acted on

For each `SourceRef` a character carries, against the profile:

| state | meaning | what the app does |
|---|---|---|
| `present` | the profile has this source at this version | nothing |
| `moved` | the profile has it at a different version | says so, and offers a refresh |
| `missing` | the profile has no such source | says so, names it, and offers to add it |

In every case the character **derives from what it embeds** and nothing changes until the user
asks. `missing` is not an error and must never read like one: a character built from a homebrew
index the user has since removed is a perfectly good character, and the only thing it cannot do
is offer new choices from that source.

A source being *disabled* is not `missing`. Disabling is about what the builder offers, not about
what a character is.

### Removing a source changes no character

It removes it from the profile and leaves every save alone. A save that embeds that source's
content keeps working forever, which was the whole trade ADR 0012 bought.

### Pinning: no

ADR 0004's open question — *should a character be pinnable to a source version, fetching that git
ref?* — is answered **no**, and closed.

A character is already pinned, in the strongest sense available: it carries the content it uses,
byte for byte, inside its own file. A git ref would buy reproducibility that the container
already gives, in exchange for requiring every content source to be a git host — which is a
narrowing of "point it at any index you like" made for no gain. The recorded version stays what
ADR 0004 said it was: provenance, and the trigger for an offer to refresh.

## Consequences

**Good**

- The warning ADR 0004 promised exists, and it is three named states rather than a vague
  "something changed".
- Adding, naming, enabling, disabling and removing sources are all operations on one small JSON
  document that no character depends on.
- A save from someone else's machine is legible: it says which sources it came from, and the app
  can say which of those you have.

**Bad / accepted**

- The user now has two places where a source is named — the profile and each character — and they
  can disagree. That disagreement is the feature; it is the only reason the warning can exist.
- A character whose sources are all `missing` still shows its recorded names and versions, which
  may be URLs that no longer resolve. Kept, because losing them loses the only clue about where
  the content came from.
- Nothing deduplicates a source added twice under two URLs that serve the same index. The id is
  the URL; two URLs are two sources.

## Alternatives considered

- **One list: the character's sources *are* the profile.** Opening a character would configure
  the app. Rejected immediately — opening someone else's save would silently rewrite your
  content setup, and ADR 0004's whole warning exists to prevent the reverse of that.
- **The profile as an allowlist gating what a character may open.** This is Aurora's model, and
  it is exactly what ADR 0012 exists to end.
- **Stamping the profile's versions onto a character on open**, so the two never disagree. Makes
  the warning permanently impossible to fire. Rejected.
