# 0113 — A 2014 Druid's Wild Shape tier is a table in the system definition

**Status:** Accepted · 2026-10-13 · answers ROADMAP Phase 4's "A druid's Wild Shape tier on the sheet" · builds on
[0005](./0005-aurora-import.md), [0022](./0022-kinds-contribute-systems-do-not-ship-content.md),
[0074](./0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md),
[0076](./0076-content-s-sheet-hints-are-read-every-description-kept-chosen-by-the-level-the-element-gates-at.md) ·
**format:** none; a system-definition change only

## Context

The maintainer's calls (2026-10-12): the sheet shows the tier the character is at, not the whole table, and the tier is a
table in the system definition. Measured (AuroraLegacy/elements at `c28ce6c`):

- **The 2014 Player's Handbook states the Beast Shapes table only as prose**: 2nd level, CR 1/4, no flying or swimming
  speed; 4th, CR 1/2, no flying speed; 8th, CR 1. Its Wild Shape element states only `druid wildshape:hours` as a rule,
  and its sheet line says nothing of the tier.
- **The 2014 Circle of the Moon states its rule**: Circle Forms writes `circle forms:cr` (1, then 2 to 6 at 6, 9, 12, 15,
  18) and its sheet line reads "a CR as high as {{circle forms:cr}}". Its other limits are the table's.
- **The 2024 Player's Handbook needs nothing.** Its Wild Shape's sheet line is gated by level (ADR 0076) and states the
  tier at each: "Known Forms of CR 1/4 or lower without a Fly Speed", then CR 1/2, then CR 1 with no limit; the 2024
  Moon's line reads `{{circle forms:cr}}`. The sheet already shows it.

## Decision

5e's player character declares three stats and gated contributions (ADR 0022), all keyed on holding the 2014 Wild Shape
feature, so a 2024 druid, a replaced feature and every other class read none:

- `wild shape:max cr`, "Highest Challenge Rating": the text "1/4", "1/2" or "1" by druid level, or, holding Circle
  Forms, content's `circle forms:cr`;
- `wild shape:limits`, "Limitations": "No flying or swimming speed", "No flying speed", or "None";
- `wild shape:tier`, unshown, 1 while the feature is held: what the section's `showWhen` reads.

A Wild Shape section after Senses shows the first two, its description saying the beast must also be one the character
has seen. No engine or format change: a literal contribution is text (ADR 0022's shape), and a requirement on druid level
is content's own `[level:druid:N]`.

## Evidence

`tools/verify/src/wild-shape.test.ts`, on the real corpus through the builder: a 2014 Druid at 2, 4 and 8 reads each row
of the table; a 2014 Moon druid at 6 reads 2 and keeps the table's limits; a 2024 Druid and a 2014 Wizard show no
section, and the 2024 Druid's own sheet line names its tier. Each fails with the declaration's matching part removed.
Driven in the browser build (2026-10-13): a new 2014 Human Druid shows no section at 1, "1/2" and "No flying speed" at 4,
and with the Circle of the Moon "2" and "No flying speed" at 6. Not the Tauri window or the phone.

## What this does not do

- Check that a beast the character turns into fits; nothing on the sheet lists beasts seen.
- The UA druids and any homebrew Wild Shape, which hold neither feature.
