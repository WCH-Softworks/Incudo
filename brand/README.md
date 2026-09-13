# Brand

The Incudo logo — an anvil under a gear — as supplied by the maintainer. Two colourways, both
1080×1080 PNG, both a single flat colour on a **transparent** background.

| file | glyph |
|---|---|
| `incudo-logo-black-1080.png` | `#000000` |
| `incudo-logo-white-1080.png` | `#ffffff` |

Not final art. Good enough to build and ship a window with.

**These are source files. Nothing reads them at runtime** — they are the input to
`npx tauri icon`, which generates `apps/desktop/src-tauri/icons/`. See that directory's README
for how, and for why the white one is the current default.

## Provenance, because the project makes a promise about this

Drawn by a person. The root README's commitment is that Incudo ships no AI-generated
artwork — not the logo, not icons, not as a placeholder — and this is the artwork that
commitment was waiting for.

The two files were re-encoded on the way in and **not otherwise touched**: they arrived as
uncompressed PNGs at 4.67 MB each, which is 9.3 MB of git history for two two-colour images.
Deflating them losslessly gives 24 KB and 14 KB, and the decoded pixel buffers are byte-for-byte
identical to what was supplied. No resampling, no re-colouring, no cropping.
