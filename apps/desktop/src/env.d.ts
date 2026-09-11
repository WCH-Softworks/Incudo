/**
 * A JSON import is `unknown`, on purpose.
 *
 * `resolveJsonModule` would give `systems/dnd5e/system.json` a structural type inferred from
 * today's file, and that type would be a lie in the one way that matters: a system definition is
 * *data* whose contract is `schemas/system.schema.json`, checked at runtime by
 * `validateGameSystem` (ADR 0011). A compile-time shape would let the app read a field the
 * schema does not guarantee and skip the validation that is supposed to be the only gate.
 *
 * So the app receives `unknown` and has to validate before it can use anything — which is what
 * the CLI already does with the same function. It also keeps these files out of `rootDir`, so
 * `tsc --build` never tries to compile the repo's data as app source.
 */
declare module '*.json' {
  const value: unknown;
  export default value;
}
