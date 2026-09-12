/**
 * @incudo/ui — the shared layer between the two shells.
 *
 * What lives here: view-models (the state machine of a screen) and presentational
 * components written against primitives each shell supplies.
 *
 * What does NOT live here: anything importing `react-dom` or `react-native`. A `<div>`
 * and a `<View>` are not the same thing and pretending otherwise is how cross-platform
 * apps end up bad on both platforms. See docs/CODE-REUSE-POLICY.md, rule 3.
 */
export * from './use-character-builder.ts';
export * from './budget.ts';
export * from './dice.ts';
export * from './character-library.ts';
export * from './aurora-import.ts';
