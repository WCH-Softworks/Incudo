/**
 * @incudo/aurora-import — Aurora Builder content, read natively.
 *
 * Not a migration step: Aurora `.index` and elements `.xml` are input formats Incudo reads
 * directly. See docs/adr/0005 and docs/AURORA-FORMAT.md.
 *
 *   xml.ts                 a small XML reader for Aurora's narrow dialect
 *   parse-index.ts         `.index` files
 *   parse-elements.ts      elements XML -> `Element`, plus unapplied `<append>` blocks
 *   generated-elements.ts  the 80 elements Aurora's app materializes and no file declares
 */
export * from './xml.ts';
export * from './parse-index.ts';
export * from './parse-elements.ts';
export * from './generated-elements.ts';
