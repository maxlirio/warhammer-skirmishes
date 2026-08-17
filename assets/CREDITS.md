# Textures

Everything here is **CC0 1.0** — public domain, no attribution required,
commercial use allowed. It is credited anyway, because the people who made it
deserve it.

All five files are stored in this repository rather than fetched at runtime, so
the app still opens from `file://` with the network switched off. Each has been
downscaled and darkened from the original so it can be dropped straight into a
CSS background stack; the originals are much larger and much lighter.

| File | Source | Original | Licence |
|---|---|---|---|
| `steel.jpg` | [ambientCG — Metal063](https://ambientcg.com/view?id=Metal063) | 1K colour map, 1024² | CC0 1.0 |
| `corrosion.jpg` | [ambientCG — Metal041B](https://ambientcg.com/view?id=Metal041B) | 1K colour map, 1024² | CC0 1.0 |
| `plates.jpg` | [ambientCG — MetalPlates006](https://ambientcg.com/view?id=MetalPlates006) | 1K colour map, 1024² | CC0 1.0 |
| `blood-mist.png` | [OpenGameArt — "Blood Splatter" by Sara](https://opengameart.org/content/blood-splatter) | `blood_0.png`, 1600×1200 | CC0 |
| `blood-splat-mask.png` | [OpenGameArt — "Blood Splat"](https://opengameart.org/content/blood-splat) | `blood_splat.png`, 256² | CC0 |

**Note on the splat:** it is *inlined into `css/app.css`* as a base64 data URI
rather than linked. A CSS `mask-image` counts as cross-origin under `file://`,
so a linked mask silently fails to load when the app is opened straight off the
disk. The file here is kept as the source — edit it, then re-inline it.

ambientCG's licence: *"You can copy, modify, distribute and perform the assets,
even for commercial purposes, all without asking permission."*
(<https://docs.ambientcg.com/license>)

## What was done to them

- **steel / corrosion / plates** — resized to 512², contrast lifted slightly,
  then multiplied down (to 34%, 30% and 62% brightness) so they read as dark
  worn metal on a near-black page without needing a blend mode.
- **blood-mist** — resized to 480×360 and quantised to 24 colours. Used at a
  few percent opacity across the whole app.
- **blood-splat-mask** — trimmed to its content, resized to 220², and reduced to
  an **alpha mask only**. The colour comes from CSS, so the blood always matches
  the palette and the file is a fifth of the size.

## Replacing one

Drop a new file in with the same name and it is picked up — the CSS refers to
them by path only. Keep them dark: they sit underneath the panel gradients, not
on top.

# Libraries (the video game)

Both are committed under `game/vendor/` rather than fetched from a CDN, so the
game still opens from `file://` with the network off. Only playing somebody else
needs to be online.

| File | Source | Licence |
|---|---|---|
| `three.module.js` | [three.js r165](https://github.com/mrdoob/three.js) | MIT |
| `three.global.js` | generated from the above by `tools/buildthree.js` | MIT |
| `peerjs.min.js` | [PeerJS 1.5.4](https://github.com/peers/peerjs) | MIT |

**Why there are two copies of three.js:** it ships as an ES module only, and a
module cannot be imported from a `file://` page — the origin is opaque, so the
browser refuses it. `tools/buildthree.js` wraps the module into a classic script
that hangs `THREE` on the window. Edit `three.module.js` (or drop in a new
release) and re-run the tool; it refuses if the file stops being a single
`export {…}` with no imports of its own.

PeerJS uses its own public broker to introduce the two browsers to each other.
Nothing of the game passes through it once they are connected, and no game state
passes through it at all — only a four-letter room code and the decisions the
players make.
