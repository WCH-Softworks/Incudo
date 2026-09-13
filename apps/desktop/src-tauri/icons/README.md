# Icons

**Generated from `brand/incudo-logo-white-1080.png` by `npx tauri icon`.** Every pixel of the
glyph is the maintainer's own artwork, downscaled and re-packed; nothing here was drawn by a
machine, which is the root README's standing commitment and the reason this directory sat empty
until someone supplied a logo.

| file | used by |
|---|---|
| `icon.ico` | Windows — the one `tauri build` refuses to start without |
| `icon.icns` | macOS |
| `32x32.png`, `128x128.png`, `128x128@2x.png` | Linux, and the window icon everywhere |
| `icon.png` | 512×512, what the bundler falls back to |

They are listed in `tauri.conf.json` under `bundle.icon`. Do not add files here without adding
them there; a stray icon in this directory is bundled by nothing and read by no one.

## Regenerating

```bash
cd apps/desktop
npx tauri icon ../../brand/incudo-logo-white-1080.png
```

Any square source of **1024×1024 or larger** works — the CLI does all the downscaling, so there
is no need to hand it pre-sized files. `brand/` holds 1080×1080, which is comfortably enough.

That command also writes `android/`, `ios/` and the Windows Store `Square*Logo.png` tiles. This
repository deletes them: the mobile shell does not exist (ROADMAP Phase 4) and no Windows Store
target is configured, so they would be files nothing reads.

## The white-on-transparent trade-off, which is real

The logo is a single-colour glyph on a transparent background, so the icon **disappears against
a background of its own colour**. White is the default here because the app's own shell is dark
and both the Windows 11 taskbar and the macOS Dock are dark out of the box — but a Windows
Explorer detail view on the light theme will show a blank square.

Switching is one command:

```bash
cd apps/desktop
npx tauri icon ../../brand/incudo-logo-black-1080.png
```

The proper fix is neither: an icon that reads everywhere needs the glyph on a **solid tile**, and
choosing that tile's colour is a design decision for whoever owns the brand rather than something
to infer from a stylesheet. When that call is made, composite it into a new source PNG in
`brand/` and regenerate — nothing in this directory needs to know.
