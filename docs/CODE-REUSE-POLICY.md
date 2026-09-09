# Code reuse policy

The requirement was "an intelligent code re-use policy" rather than a decision on one app vs two.
This is that policy. It is deliberately about *layers*, not about frameworks — if desktop or
mobile is later rewritten in something else, everything below the shell survives.

## The layers, and who may import what

| layer | package | may import | must never import |
|---|---|---|---|
| 1. Model & engine | `@incudo/core` | nothing but stdlib | anything platform-shaped |
| 2. Content | `@incudo/content` | `core` | `fs`, `fetch`, `localStorage`, Tauri, Expo |
| 3. Import | `@incudo/aurora-import` | `core` | same |
| 4. View-models | `@incudo/ui/hooks` | 1–3, `react` | `react-native`, `react-dom`, Tauri, Expo |
| 5. Components | `@incudo/ui` | 1–4, `react` | platform-specific widget libs |
| 6. Shell | `apps/*` | everything | — |

Layers 1–3 are plain TypeScript that runs in Node, in a browser, and in Hermes unchanged. That is
the property worth protecting; everything else in this document exists to protect it.

## Rule 1 — platform I/O is injected

`core` and `content` never call `fetch` or touch a filesystem. They accept:

```ts
interface Fetcher { fetchText(url: string, opts?): Promise<FetchResult> }
interface Storage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
```

Each shell provides one implementation, in one file, and passes it in at startup. The CLI passes
Node's. Tests pass fakes. **If you find yourself wanting a `Platform.isDesktop` check in core,
the design is wrong** — pass in different behaviour instead.

## Rule 2 — share view-models, not views

The temptation with two shells is to force one UI (React Native Web, or a webview everywhere).
Resist it. Instead, the *state machine* of every screen is a shared hook:

```ts
const { steps, current, options, pick, problems } = useCharacterBuilder(character, system);
```

Desktop renders that as a three-pane layout with everything visible. Mobile renders it as a
step-by-step wizard. Neither shell contains a rule about the game, and neither is compromised by
the other's ergonomics.

**Test:** if a bug is "the app computed the wrong AC", it must be fixable in a package. If it is
"the button is off-screen", it must be fixable in a shell. A bug that requires touching both is a
layering violation worth fixing.

## Rule 3 — no shared UI primitives across React DOM and React Native

`@incudo/ui` components are written against a small primitive set (`Box`, `Text`, `Pressable`,
`ScrollArea`) that each shell supplies. This keeps genuinely shared presentational code possible
(a spell card, a stat block) without pretending a `<div>` and a `<View>` are the same thing.
When a component cannot be written that way, it belongs in the shell. That is a normal outcome,
not a failure.

## Rule 4 — one dependency policy

Packages 1–3 aim for **zero runtime dependencies** (the XML parser in `aurora-import` is the
single allowed exception, and it is isolated behind one module so it can be swapped). Fewer deps
means the engine keeps working on whatever runtime the project targets in five years.

## Enforcement

- `tsconfig` project references make illegal imports a compile error in the common cases.
- An ESLint `no-restricted-imports` rule per package encodes the table above.
- CI runs the CLI against a real Aurora index, so the engine is exercised without a UI at all.
- Any PR adding a runtime dependency to `core`, `content` or `aurora-import` needs an ADR.

## What is *not* shared, on purpose

- Window/menu/tray, navigation, deep links, file pickers, share sheets
- Storage locations and permissions
- Keyboard shortcuts (desktop) and gestures (mobile)
- Update mechanism
- Layout, density, and typography scale
