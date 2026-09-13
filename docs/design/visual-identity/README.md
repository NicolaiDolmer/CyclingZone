# Cycling Zone Visual Identity v1 — export from Claude Design (2026-09-11)

Canvas: "Cycling Zone Visual Identity v1" in the Claude Design project. Share link: <owner pastes here>

| File | What | Artboard |
|---|---|---|
| `cz-portrait.js` | Parametric renderer. `czPortrait('hybrid', {mood, view, helmet, helmetStyle, outline})` and `czAsset(kind, outline)` return SVG strings; also registers `<cz-portrait>` / `<cz-asset>` web components. Source of truth for every rider drawing. | 01, 02, 08 |
| `tokens.json` | Every colour by material and role (skin 8, hair 6 + grey, kit test, eyes, lip) + the outline rule. | 02 |
| `ART_BIBLE.md` | Locked rules: register, outline weights, shading bands, morale exception to fog of war, proportions, helmets, board order. | 02 |
| `VISUAL_IDENTITY_HANDOFF.md` | The 09-handoff status block (same text as issue #5113). | 09 |
| `export-svg.mjs` | `node export-svg.mjs` regenerates `svg/` from the renderer (11 masters). | — |
| `svg/rider-front-{neutral,high,low}.svg` | Anders Pedersen, front, morale steady / high / low. | 02 |
| `svg/rider-tq-neutral.svg` | Computed three-quarter view. | 02 |
| `svg/rider-helmet-{a-aero,b-vented,c-halved,d-minimal}.svg` | Four approved road helmets. | 08 |
| `svg/helmet-side.svg` | Helmet side view, test colours. | 08 |
| `svg/jersey-flat-front.svg` | Jersey flat, front, test kit (board-04 UV sheet not yet drawn). | 02 |
| `svg/jersey-mini-16.svg` | 16 px mini-jersey primitive, no outline. | 02 |
| `png/01-style-exploration@2x.png`, `png/02-art-bible@2x.png`, `png/08-helmets@2x.png` | Artboard renders at 2x. Binary — added from the owner's download, not by this push. | 01, 02, 08 |

Boards 03–07 and the rest of 08 are not started. All files exported; nothing new was drawn.
