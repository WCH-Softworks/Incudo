# Icons — a deliberate gap

**This directory is empty on purpose, and `npm run desktop:app` cannot build until a person
fills it.**

Incudo never ships generated artwork, not even as a temporary placeholder — it is a stated
commitment in the root README, not a preference. An AI-generated `icon.ico` would be exactly the
thing that commitment rules out, so the Windows build stops here instead:

```
`icons/icon.ico` not found; required for generating a Windows Resource file during tauri-build
```

That error is the gap doing its job. It is not a broken checkout.

## What is needed

A drawn icon, from a person, exported to the sizes Tauri expects:

| file | used by |
|---|---|
| `icon.ico` | Windows — **the one that blocks the build** |
| `icon.icns` | macOS |
| `32x32.png`, `128x128.png`, `128x128@2x.png` | Linux, and the window icon everywhere |

`npx tauri icon path/to/source.png` generates the whole set from a single square source image of
1024×1024 or larger. The source image is the part that has to be drawn.

Then list them in `tauri.conf.json` under `bundle.icon`, which is currently `[]`.

## Until then

`npm run desktop` runs the same application in a browser with no Rust build and no icon, which
is where all of the UI work can happen. Only the packaged window needs this.
