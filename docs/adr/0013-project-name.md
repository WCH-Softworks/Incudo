# 0013 — The project is called Incudo

**Status:** Accepted · 2026-09-09

## Context

The project began as **HeroForge** and was pushed to GitHub under that name. Two names were
then rejected on evidence, and the reasoning is recorded here so nobody relitigates it.

### Why not HeroForge

- **Hero Forge** (heroforge.com) — custom 3D-printed miniatures. Same D&D audience, adjacent
  category, and dominant in search for the term.
- **HeroForge Anew** — an existing Excel/VBA D&D 3.5 character builder. Same product category.
  It was itself a revival of an abandoned builder, so this project would have been the second
  revival-of-an-abandoned-character-builder called HeroForge.
- **heroforgeapp.com** — "HeroForge: AI Character Creator".
- **github.com/izakman/heroforge** — an existing character-builder repository.
- **Hero Lab** (Lone Wolf Development) — the commercial system-agnostic character builder, i.e.
  this project's closest conceptual competitor. Any `Hero-` name sits between it and Hero Forge.

The damage is not legal, it is search. An open-source project with no marketing budget cannot
afford to lose its own name in search results.

### Why not Armature

Armature was the leading candidate and failed its trademark check:

- **ARMATURE**, Reg. 3924624, Class 9 — *"computer software development tools; computer software
  for computer system and application development."* Live, renewed 2021.
- **ARMATURE STUDIO**, Ser. 97630270, owned by **Meta Platforms** — *"downloadable electronic
  game software… video games, computer games, interactive multimedia games."* Live.
- `github.com/Armature` taken; npm `armature` taken.

Enforcement risk against a free OSS tool is low, but the standard that rejected HeroForge —
the name is already occupied in the adjacent space — rejects Armature more strongly, since one
of the marks is games software owned by Meta. Applying the standard inconsistently would have
made it worthless.

Also considered and rejected: **Millwright** (trademark-clean, but `-wright` has a silent W with
no rule a non-English speaker could apply, and four plausible misspellings); **Sprue**
(clean, but also means coeliac disease); **Fabricate** (a 5e spell, *and* an existing Foundry VTT
module whose own tagline is "a system-agnostic crafting module").

## Decision

**Incudo** — a coinage from Latin *incus, incudis*, "anvil".

Verified clean on every axis before adoption:

| check | result |
|---|---|
| npm `incudo` | free |
| github.com/incudo | free |
| USPTO | no INCUDO mark (only `INCUDOKNIT`, toys, unrelated) |
| TTRPG space | nothing — the word is invented |

It also satisfies the constraint that killed Millwright: **in-KU-do** has no silent letters and
no digraphs, so Portuguese, Spanish, Italian, French and English speakers all read it correctly
on sight, and there is no plausible misspelling.

Naming scheme:

| | |
|---|---|
| packages | `@incudo/core`, `@incudo/content`, `@incudo/aurora-import`, `@incudo/ui` |
| CLI | `incudo` |
| character save | `.incu` |
| content bundle | `.incuc` |
| cache | `.incudo-cache` |

## Consequences

- Coining sidesteps the collision problem permanently. That is the point, and it is why the
  search was widened to invented names after two real words failed.
- The name carries no meaning to a new user. Neither did Aurora, the tool this one replaces —
  a name needs to be ownable and memorable more than it needs to be descriptive.
- Renaming cost was near zero: no users, no published packages, one commit. Deliberately done
  before anything depended on it.

## Rule going forward

**A name is not adopted until npm, GitHub and USPTO have all been checked.** Both rejected names
looked fine on a casual search and failed on a real one.
