# The Aurora save format

Reverse-engineered from 8 real `.dnd5e` files (2024–2026, Aurora save `version="1.0.3"`).
This is the reference for importing existing characters, and — just as usefully — a catalogue
of what **not** to do in HeroForge's own format.

## Shape

Saves are XML. The extension is the system id: `.dnd5e`.

```xml
<character version="1.0.3" preview="false">
  <information>            <!-- group, generationOption -->
  <display-properties>     <!-- DENORMALIZED CACHE: name, race, class, level, portrait -->
    <portrait>
      <local>C:\...\portraits\shardmind male 2.png</local>
      <base64><![CDATA[ iVBORw0K... ]]></base64>     <!-- the whole PNG, inline -->
  <build>
    <input>                <!-- freeform: name, gender, player, xp, manual attacks,
                                 backstory, background answers, currency, notes, quest -->
    <appearance>           <!-- portrait path, age, height, weight, eyes, skin, hair -->
    <abilities available-points="15"> <!-- raw scores -->
    <elements level-count="12" registered-count="52">
                           <!-- THE ACTUAL BUILD: a nested tree -->
    <sum>                  <!-- DERIVED: every resulting proficiency and feature, flattened -->
    <magic>                <!-- DERIVED: slots, DC, attack bonus, known/prepared spells -->
  <sources>
    <restricted>           <!-- every source and element the user DISABLED -->
```

### The elements tree

The only part that is genuinely input. Two kinds of node:

```xml
<element type="Level" name="1" id="ID_LEVEL_1" rndhp="10,10,1,3,4,4,10,3,8,2,...">
  <element type="Race" requiredLevel="1" checksum="1597ef76" registered="ID_RACE_ELF">
    <element type="Racial Trait" name="Keen Senses" id="ID_RACIAL_TRAIT_KEEN_SENSES">
      <element type="Proficiency" name="Perception" id="ID_PROFICIENCY_SKILL_PERCEPTION" />
```

- **`registered="ID_…"`** — a *decision the user made*. This is the real payload.
- **`id="ID_…"`** — an element that was *granted* as a consequence. Fully derivable; recorded
  anyway.
- `checksum` — Aurora's guard against the underlying content changing under a saved choice.
- `number="1"`/`"2"` — disambiguates repeated selects with the same name (e.g. picking two
  Fighter skills). HeroForge needs the same thing; its `select` rules are keyed by name for
  exactly this reason.
- `rndhp="10,10,1,3,…"` — **rolled hit points per level.** See "What this taught us", below.

## What the files actually contain

| file | size | base64 | `<sources>` | real decisions |
|---|---:|---:|---:|---:|
| Vigaro Safeguard | 318 KB | 278 KB (88%) | 0 KB | 42 |
| Deusinaldo | 2.9 MB | 300 KB | ~2.6 MB | 23 |
| arturo | 3.1 MB | 45 KB | **3.1 MB** | 57 |
| Merilio | 3.1 MB | 45 KB | ~3.0 MB | 52 |
| Theren Liadon | 7.3 MB | 4.6 MB | ~2.7 MB | 49 |
| Krusk Oathfang | 7.8 MB | 5.1 MB | ~2.6 MB | 28 |
| Bran Brightwood | 7.9 MB | 5.2 MB | 2.7 MB | 34 |

**A 3.1 MB file records 57 decisions.** Everything else is a portrait, a derived snapshot, or
an exclusion list.

## The three things that make saves enormous

1. **Base64 portraits inline** — up to 5.2 MB of PNG in the XML, *and* the original path is
   stored right next to it. Base64 costs 33% over the bytes, and XML text nodes make it worse.
2. **`<sources><restricted>` is an exclusion list.** Aurora records every element the user
   *turned off*: **37,235 element IDs and 177 sources** in one file. It stores the complement
   of a short answer.
3. **`<sum>` and `<magic>` duplicate the derivation.** Every granted proficiency, feature and
   spell slot is written out alongside the choices that produce them.

## What this taught us

Three of these landed directly in HeroForge's design:

**Rolled values are inputs, not derivations.** `rndhp` is the one thing in `<sum>`-adjacent
territory that genuinely cannot be recomputed — a die roll has no formula. This refines
[ADR 0006](./adr/0006-derived-character-state.md): a character stores choices *and recorded
random results*, and nothing else. Missing this would have silently rerolled everyone's HP.

**Store the allowlist, not the blocklist.** `Character.sources` records the handful of sources
a character actually uses. The same information, three orders of magnitude smaller, and it
stays correct when new content appears upstream — an exclusion list silently *includes*
everything published after it was written.

**`checksum` is the right instinct in the wrong place.** Aurora checksums each individual
choice. HeroForge records a version per source instead, which catches the same drift with one
field instead of fifty and gives a better error ("Xanathar's changed since you built this")
than a per-element mismatch.

## Import plan

Read: `registered=` decisions, `<abilities>`, `rndhp`, `<input>`, `<appearance>`, level count,
and the *enabled* sources (derived by inverting `<restricted>` against the loaded content).

Ignore: everything with a bare `id=` in the elements tree, `<sum>`, `<magic>`,
`<display-properties>`. All of it is re-derived, and re-deriving it is how the import gets
verified — if HeroForge's engine produces a different `<sum>` than Aurora recorded, one of
them is wrong and it is worth knowing which.

Portraits: decode the base64 once, write it beside the character as an ordinary image file,
and reference it. See [ADR 0007](./adr/0007-native-formats.md).

**Verification target:** import all 8 sample characters, re-derive, and diff against the
`<sum>` and `<magic>` blocks Aurora wrote. That is a free, high-quality oracle for the engine —
Aurora already did the maths, and disagreements point straight at a bug.
