/**
 * @incudo/aurora-import — Aurora Builder content and characters, converted into Incudo's own.
 *
 * **The converter** (ADR 0119, which lifted ADR 0008's freeze). Aurora is an input format and nothing else: this
 * package turns an Aurora source (an index and its files) or a file into an Incudo content source, and a `.dnd5e` save
 * into an Incudo character. Nothing past it imports it, reads Aurora's files, or depends on what only Aurora's app knew.
 * Reusing Aurora's ids and names is fine; carrying its app's behaviour or shape into Incudo's formats is not.
 *
 * ADR 0008's other decisions stand: import only, no export, no support for Aurora formats that will never exist.
 * See docs/AURORA-FORMAT.md and docs/AURORA-SAVE-FORMAT.md.
 *
 * What lives here, and the order is the pipeline:
 *
 *   xml.ts                 a small XML reader for Aurora's narrow dialect
 *   parse-index.ts         `.index` files
 *   parse-elements.ts      elements XML -> `Element`, plus unapplied `<append>` blocks
 *   generated-elements.ts  the elements Aurora's app materializes and no file declares
 *   item-features.ts       options Aurora writes as items to equip, converted into what they are (ADR 0129)
 *   improvement-options.ts the per-class, per-level ability score improvement it also generates
 *   incudo-expressions.ts  what Aurora's app read into expressions, written as Incudo's own
 *   convert-source.ts      an index and its files, or one file -> one Incudo content source
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
export * from './item-features.ts';
export * from './improvement-options.ts';
export * from './incudo-expressions.ts';
export * from './starting-equipment.ts';
export * from './convert-source.ts';
export * from './base64.ts';
export * from './parse-save.ts';
export * from './canonical-ids.ts';
export * from './import-character.ts';
export * from './verify-character.ts';
