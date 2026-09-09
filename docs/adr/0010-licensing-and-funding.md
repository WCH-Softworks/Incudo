# 0010 — A system ships officially only if its licence permits donation-funded third-party tools

**Status:** Accepted · 2026-09-09

## Context

Incudo is free and open source, with a Ko-fi link. That link is the entire funding model, and
it is also the thing that complicates licensing: some game publishers permit third-party tools,
but restrict monetization, and "accepting donations for a tool that implements our rules" is
exactly the grey area those clauses are written about.

The project's position, in the owner's words: *unless the system we're incorporating allows for
Ko-fi (or other donation-based funding) to be done by third-party apps, we'll never support it
officially.*

Note the shape of the risk. Incudo ships **no rulebook content** — users point it at content
indexes themselves. But an *official* `systems/<id>/system.json` is Incudo asserting support
for a game, and it necessarily encodes rules structure (stat names, progression, what a build
step is). That is a much smaller surface than reproducing text, but it is not zero.

## Decision

**A system is only added to `systems/` after its licence has been read and recorded as
permitting third-party tools that accept donations.** No exceptions, no "probably fine".

Each official system carries a `licence` block naming the licence, the attribution required, and
the date it was checked:

```jsonc
"licence": {
  "id": "CC-BY-4.0",
  "name": "Creative Commons Attribution 4.0 International",
  "source": "System Reference Document 5.2.1",
  "attribution": "This work includes material from the System Reference Document 5.2.1 ...",
  "permitsCommercialUse": true,
  "verified": "2026-09-09",
  "url": "https://www.dndbeyond.com/srd"
}
```

`docs/LICENSING.md` holds the full checklist and the per-system record.

### Where things stand

- **D&D 5e — clear.** SRD 5.1 and SRD 5.2/5.2.1 are released under **CC-BY-4.0**, which permits
  commercial use with attribution and is irrevocable. Donations are unambiguously fine. This is
  the system Incudo ships first, and the licence position is the reason it is safe to.
- **Pathfinder 2e — needs the licence read before any work starts.** Paizo's ORC License is an
  open, irrevocable, system-neutral licence and Pathfinder 2e Remaster content is published
  under it, which is promising. But "promising" is not the standard set above: the ORC text and
  Paizo's Compatibility License must be read in full and recorded before `systems/pf2e` exists.
- **Everything else — unassessed.** Assume not permitted until checked.

### What users may still do

This policy governs **what the project distributes**, not what users may do on their own
machines. Anyone can write a `system.json` for any game and use it locally
([ADR 0011](./0011-user-systems.md)). Incudo does not host it, index it, link to it, or
bless it. That separation is the point: the tool stays general, the project's distribution stays
conservative.

## Consequences

**Good**
- The funding model and the licensing policy cannot come into conflict later, because the check
  happens before the work.
- Users are not blocked by a policy that exists to protect the project.
- Recording `verified` dates means a licence change is detectable rather than assumed away.

**Bad / accepted**
- Some popular systems may never ship officially, even where users can add them locally. That is
  the trade, taken deliberately.
- Licence review is unglamorous work that gates fun work.
- This is not legal advice, and none of the people writing it are lawyers. The mitigation is to
  be conservative and to record reasoning, not to be confident.

## Consequence for the Ko-fi link

The link goes on the README and in the app's About screen, described as supporting **Incudo's
development** — never as buying access to content, and never on a screen that displays licensed
material. Nothing in Incudo is paywalled, ever; that is what keeps "donation" accurate.
