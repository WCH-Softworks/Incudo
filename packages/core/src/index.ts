/**
 * @incudo/core — the system-agnostic content model and rules engine.
 *
 * Hard rule for this package: no platform APIs (no fs, fetch, window, react-native)
 * and no game-specific nouns. If you are about to write the word "strength" outside a
 * test fixture, you are in the wrong package. See docs/adr/0003.
 */
export * from './model.ts';
export * from './requirements.ts';
export * from './expression.ts';
export * from './supports.ts';
export * from './system.ts';
export * from './character.ts';
export * from './engine.ts';
export * from './platform.ts';
