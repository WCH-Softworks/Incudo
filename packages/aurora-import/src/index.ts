/**
 * @incudo/aurora-import — Aurora Builder content, read natively.
 *
 * Not a migration step: Aurora `.index` and elements `.xml` are input formats Incudo
 * reads directly. See docs/adr/0005 and docs/AURORA-FORMAT.md.
 */
export * from './xml.ts';
export * from './parse-index.ts';
export * from './parse-elements.ts';
