# Visual Identity handoff (Claude Design, 2026-09-11)

## Status
- Style picked: A-derived, locked as "Flat + ink" (stylised realistic, flat fills + thin warm-ink outline). Picked 2026-09-10 after a second round of built candidates; caricature and semi-real rejected.
- Artboards done: 01-style-exploration, 02-art-bible, 08 helmets only (road helmet, four designs approved as team options)
- Not started: 03-rider-genome, 04-livery-system, 05-sponsor-universe, 06-livery-designer-ui, 07-surface-integration, 08 vehicles + TT helmet + staff, 09-handoff JSON shapes

## Decisions made in Claude Design
- Game has male riders only; test rider is Anders Pedersen, DNK, 27, climber (replaces "Ada Pedersen" from the brief) — 01, 02
- Register: flat fills + thin warm-ink outline; no gradients, glow or drop shadows — 02
- Outline 1.0 px at 400 px figure width, scales 1/400 of width, never under 1 px on screen; inner features 80 % of silhouette weight; no line at 16 px — 02
- Outline colour is the darkest tone of that material, never pure black — 02
- Shading: 2 flat bands (base + shade); 3 bands (+ deep) only on hero close-ups — 02
- Mood on the face is allowed for ONE stat (morale): high / steady / low, moving only mouth corners, cheek fold, lower lid, inner brow. Owner's decision; the single exception to fog of war — 02
- Never: eye size, blush, skin tone or posture as a mood or stat signal — 02
- Ears between brow line and nose base, behind the head silhouette — 02
- Head 190/140 (h/w) at 400 px; eyes one eye-width apart; neck 60; shoulders 2.2 head widths — 02
- Three-quarter view is computed (front paths projected onto an ellipsoid head, half-width 70, depth 58, rotated 35°), never a squeezed front — 02
- No heavy upper-lid stroke; lid = 1.4 px in hair-shade only — 02
- Helmets: four designs kept (a Aero road, b Classic vented, c Halved, d Minimal); shell covers hair to just above the brow; straps down the jaw edge, meet under the chin; shell = primary, vents/band = secondary, ridge/rim/seam = gold — 08
- Rider profile hero recreated from RiderProfileHero.jsx at 360/1280, light/dark, as the "before" anchor — 01

## Tokens
- UI colours: unchanged from the design system (light body #f4f2ec / card #fcfbf7 / subtle #ece9e1; dark #0e0f15 / #161824 / #14161e; hairline #e5e0d5 / #2a2d3a; gold #e8c547, foreground gold on light #a07800)
- Kit test colours: primary #0e0f15 (shade #22253a, outline #06070b), secondary #f4f2ec (shade #d9d4c6, outline #8e8878), accent #e8c547
- Skin, 8 tones [base, shade]: S1 #f2dcc8/#dcbc9f · S2 #eac6a8/#d3a683 · S3 #e3b08c/#c98f6b · S4 #d1956e/#b57652 · S5 #b87a55/#9a5f3f · S6 #9a6040/#7d4a30 · S7 #744532/#5a3325 · S8 #4d2e20/#372016 · outline #2b2118
- Hair, 6 + grey [base, shade]: black #1e1a17/#0f0d0b · dark brown #4a3a2a/#33271b · brown #6e4f34/#503822 · dark blonde #8a6a3a/#6b4f28 · blonde #c2a061/#9e7f47 · red #8f4a2a/#6d361d · grey #b8ab98/#8f8474 · outline #2b2118
- Eyes: iris #3f5647, pupil #1a1410, white #f5f1e8. Lip #b97b66
- Type: unchanged (Bebas Neue one hero word, Inter Tight 20/700 headers, DM Sans body, tabular figures)
- Line weight: 16 px none · 48 px 1 px (floor) · 128 px 1 px (floor) · 400 px 1.0 px · 800 px 2.0 px
- Shading bands: 2 on figures, 3 on hero close-ups; shade = same hue, darker step from the palette pair, never black overlay

## Rider genome axes
- not started (palettes exist: skin 8, hair colour 6 + grey — see Tokens; all other axes, counts and thumbnails pending board 03)

## Livery templates
- not started (only the neutral test kit and the jersey flat / 16 px mini-jersey primitives exist in cz-portrait.js)

## Sponsor universe
- not started

## Open questions for the owner
- Board 03 next: should nationality bias the genome distributions at all, or stay uniform for v1?
- Ageing: keep the four markers (hairline, nasolabial, crow's feet, temple grey) or add build changes across decades?
- Morale mood on the face: also on the 48 px card, or only on the profile hero?
- Time-trial helmet: draw it on board 08 or defer until the livery patterns exist?
- Livery designer (06): is the own-logo upload in scope for v1 of the UI?

## Assets
- Share link: <paste>
- PNG export per artboard: yes — canvas "Cycling Zone Visual Identity v1", artboards 01–09
- Files: docs/design/visual-identity/ (this folder)
