/**
 * A JSON import is `unknown`, on purpose, for the reason the desktop's `env.d.ts` gives: a system definition is data
 * whose contract is `schemas/system.schema.json`, checked at runtime by `validateGameSystem`, and a type inferred from
 * today's file would let the app skip that check.
 */
declare module '@repo/*.json' {
  const value: unknown;
  export default value;
}
