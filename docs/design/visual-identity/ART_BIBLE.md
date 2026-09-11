# Cycling Zone · Visual identity system — locked decisions

Owner speaks Danish; answer in Danish in chat. Boards carry English first, Danish second.
Game has male riders only. Test rider: Anders Pedersen, DNK, 27, climber.

## Portrait register (locked 2026-09-10)
- Flat fills + thin warm-ink outline ("Flat + ink"). Source of truth: `cz-portrait.js`, register `hybrid`.
- Outline weight 1.0 px at 400 px figure width; scales 1/400 of width; never under 1 px on screen. Inner features 80 % of silhouette weight.
- Outline colour = darkest tone of that material, never pure black: skin/hair #2b2118, navy kit #06070b, chalk kit #8e8878.
- Shading: 2 flat bands (base + shade) on figures; 3 bands (+ deep) only on hero close-ups. No gradients, no glow, no drop shadows.
- Line on figures, helmets, staff. No line on 16 px mini-jersey, vehicles, or anything already inside a hairline-bordered UI frame.
- Mood on the face is allowed for ONE stat (morale): 3 states (high/steady/low), moving only mouth corners, cheek fold, lower lid, inner brow. Owner's decision; it is the single exception to fog of war. Never eye size, blush, skin tone, posture.
- Ears sit between brow line and nose base, drawn behind the head silhouette. No horizontal lines off the head.
- Head 190/140 (h/w) at 400 px; eyes one eye-width apart on the mid-line; neck 60 wide; shoulders 2.2 head widths.
- Kit test colours: navy #0e0f15 primary, chalk #f4f2ec secondary, gold #e8c547 accent; sponsor none.
- Rejected: caricature (C), semi-real/photo (FM newgen valley), pure ink without fills.
- Three-quarter view is COMPUTED, not hand-drawn: front feature paths projected onto an ellipsoid head (half-width 70, depth 58) rotated 35°. Never squeeze the front view.
- No heavy upper-lid stroke (was read as "a line through the eyes"). Lid = 1.4 px in hair-shade only.

## Helmets (approved 2026-09-10, all four kept as team options)
- Source: `helmetFront(style)` in `cz-portrait.js`; `<cz-portrait helmet="on" hstyle="a|b|c|d">`.
- a Aero road · b Classic vented · c Halved · d Minimal. Shell covers hair to just above the brow; straps run down the jaw edge and meet under the chin, never across the face.
- Helmet colours follow livery: shell = primary, vents/band = secondary, ridge/rim/seam = gold accent.

## Board order
1 Style exploration (done) · 2 Art bible (done) · 3 Rider genome · 4 Livery · 5 Sponsors · 6 Livery designer UI · 7 Surface integration · 8 Vehicles/helmets/staff (helmets done) · 9 Handoff (export SVGs + JSON shapes).
Every choice is shown as built candidates, never as abstract words. Every drawing is checked at full size before it is shown.
