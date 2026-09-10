/**
 * @incudo/aurora-import — Aurora Builder content and characters, read natively.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────┐
 * │  FROZEN. This package is DONE and is bugfix-only (ADR 0008).                          │
 * │                                                                                      │
 * │  Aurora Builder is discontinued. Its content format has not changed in years and will │
 * │  not change again; its save format is at version 1.0.3 and there will be no 1.0.4.    │
 * │  So this is one of the rare pieces of compatibility work that gets to finish, and it  │
 * │  has: the full AuroraLegacy corpus imports with 0 errors, and all 8 sample `.dnd5e`   │
 * │  saves re-derive with no missing elements, no missing spells and no mismatched        │
 * │  numbers.                                                                            │
 * │                                                                                      │
 * │  Allowed:  fixing a bug against real content that does not import correctly.          │
 * │  Not:      export to Aurora formats (nothing would read it), support for versions     │
 * │            that will never exist, or refactoring for its own sake.                    │
 * │                                                                                      │
 * │  Before changing anything here, read docs/adr/0008-aurora-compatibility-frozen.md.    │
 * └──────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Not a migration step: Aurora `.index`, elements `.xml` and `.dnd5e` saves are input
 * formats Incudo reads directly. See docs/adr/0005, docs/AURORA-FORMAT.md and
 * docs/AURORA-SAVE-FORMAT.md.
 *
 * Five things live here, and the order is the pipeline:
 *
 *   xml.ts                 a small XML reader for Aurora's narrow dialect
 *   parse-index.ts         `.index` files
 *   parse-elements.ts      elements XML -> `Element`, plus unapplied `<append>` blocks
 *   generated-elements.ts  the 80 elements Aurora's app materializes and no file declares
 *   base64.ts              portraits out of the XML and into real bytes
 *   parse-save.ts          `.dnd5e` -> a structure, with no interpretation
 *   import-character.ts    that structure -> a `Character`
 *   verify-character.ts    the derivation -> a diff against what Aurora itself computed
 *
 * The split between the last three is the load-bearing one: `parse-save.ts` reads the
 * `<sum>` and `<magic>` blocks without ever seeing the engine, which is what keeps them
 * usable as an independent oracle rather than as a thing the importer can talk itself into.
 */
export * from './xml.ts';
export * from './parse-index.ts';
export * from './parse-elements.ts';
export * from './generated-elements.ts';
export * from './base64.ts';
export * from './parse-save.ts';
export * from './import-character.ts';
export * from './verify-character.ts';
