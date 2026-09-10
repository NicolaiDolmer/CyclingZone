# Claude Design-prompt: Visual Identity System (ryttere, hold, sponsorer, køretøjer, stab)

> Udkast 10/9 2026. Beslutninger låst i chat samme dag: 3D-first master-assets (alt i åbne formater, Rive droppet), kurateret livery-designer + fri logo-upload, fiktivt sponsor-univers som ejet IP, første flade = livery-designer + trøje i lister, stil-niveau afgøres visuelt på artboard 1. Refs #4100 #4814 #2178 #935 #4916.
>
> Kopiér alt under linjen ind i Claude Design som første besked.

---

# Cycling Zone: Visual Identity System (canvas brief)

## What this is

Cycling Zone (cyclingzone.org) is a browser-based multiplayer cycling-manager game, live in open beta, 1000+ managers as the target scale. Players sign up, draft a team, bid on riders in live auctions, set tactics and race a season calendar. Today nothing in the game has a face or a kit: riders are initials in a square, teams are text links, sponsors are a name in a contract.

I am building a single identity system that every renderer reads from, in this order:

1. **Livery**: one team colour-and-sponsor spec that dresses the jersey, helmet, bike frame, team car and team bus at once.
2. **Rider genome**: a stored, deterministic appearance per rider (face, skin, hair, build, age) that never changes and visibly ages across seasons.
3. **Sponsor universe**: 36 fictional brands with wordmarks, owned IP.
4. **Vehicles, helmets and staff** in the same language.

Master assets will later be built in stylised 3D (toon/cel shading, GLTF) so the same figure can be a static portrait, an animated hero on the rider profile (the rider turns their head and looks at you when you open the page) and one of 150 riders in a race replay. **Your job on this canvas is the art bible, the 2D templates and the UI, which become the brief for the 3D work.** The jersey template you draw is literally the future texture, so lay it out as a flat front/back/sleeves sheet.

## Hard constraints (binding design rules from the game)

- Editorial, data-first look. Illustration is allowed only when it carries identity or data (kit colours, sponsor, nationality, physique, age). Never decoration, never stock-photo feel, never gradient blobs, never glow, never drop shadows.
- One surface radius: 5 px. Hairline borders only: `#e5e0d5` light, `#2a2d3a` dark.
- Backgrounds: light body `#f4f2ec`, card `#fcfbf7`, subtle `#ece9e1`; dark body `#0e0f15`, card `#161824`, subtle `#14161e`. Text: light `#0e0f15` / `#66637a` / `#9896b0`; dark `#ededf2` / `#9da0b3` / `#888ba0`.
- Gold accent `rgb(232 197 71)` is rationed: exactly one gold primary button per view, plus leader markers. Never gold numbers, never gold tints on cards.
- Typography: Bebas Neue for exactly one hero word per screen (rider name, team name). Page headers Inter Tight 20/700. Body DM Sans. All numbers tabular figures.
- Icons: one stroke icon set (16/20/24 px). No emoji, no unicode arrows.
- Both light and dark mode for every UI artboard. Mobile-first: Android at 360 px wide, then desktop 1280 px.
- Copy: English first, Danish second on the same artboard. Tone: "I" (the maker) and "you" (the player), never "we".
- Fog of war: the figure may never reveal hidden numbers. Build may follow the public rider type (climber, sprinter, puncheur, rouleur/time-triallist, GC rider). Potential, form and hidden stats must not be readable from the body or face.

## Artboards (in this order; stop after 1 and ask me to pick)

### 1. Style exploration (decide first)

The same rider, "Ada Pedersen", Danish, 27, climber, in an identical kit, drawn in three style levels side by side, each as a front bust and a three-quarter bust:

- A. Stylised realistic: natural proportions, simplified faces, flat colour bands, thin outline. Reads like a magazine illustration.
- B. Semi-realistic: closer to real riders, more facial detail.
- C. Caricature: bigger heads, shorter bodies, strong expressions.

Add a fourth column for each style: the same rider at 21, 29 and 37 (ageing markers only, same identity). Below the row, write your recommendation in five lines covering: translation to toon-shaded low-poly 3D (under 5k triangles), readability at 16 px and 48 px, believability of ageing, risk of "mobile-game" feel.

### 2. Art bible

One board: head-to-body proportions, line weight at 3 sizes, cel-shading bands (2 to 3 tones, rule for shadow colour), outline colour rule, skin and hair palette rules, what counts as data-bearing detail and what is forbidden, a do/don't strip with six pairs.

### 3. Rider genome sheet

Variation axes with counts and a thumbnail per value: face shape (6), skin tone (8, evenly spaced, no default), hair style (12) and colour (6), facial hair (5), brows (3), eyes (4), build by rider type (5), accessories (glasses 4, sunglasses 3, none), ageing markers by decade, tan lines and race scars as optional. Show 24 generated riders in a grid to prove variety and prove that no two look like siblings. Nationality may bias distributions subtly; no caricature of any region.

### 4. Livery system

- Jersey flat template as a UV-style sheet: front, back, both sleeves, collar, shorts side panels.
- 12 named pattern templates (solid, halved, quartered, sash, chevron, hoops, pinstripe, gradient-free fade via bands, panel, split sleeve, mountain band, sprint band).
- Three colour roles: primary, secondary, accent, with a contrast rule so the 16 px mini-jersey stays readable in a standings row.
- Sponsor zones: chest main, back, both sleeves, shorts, collar. Show how a wordmark scales into each zone.
- Propagation strip: the same livery on the helmet, the bike frame, the team car (side and three-quarter) and the team bus (side). Same three colours, same sponsor, nothing else invented.

### 5. Sponsor universe

36 fictional brands in six families (finance, beverage, tech, hardware and building, energy and mobility, tourism and regions). For each: name, wordmark, two-colour palette, tier (local, national, global). No resemblance to real brands, no real-world names. Show six of them placed on jerseys and one on a bus.

### 6. Livery designer (player UI, standard content template, max width 896 px)

Pattern picker, three colour roles with a full colour picker, sponsor auto-placed from the player's current contract, optional own-logo upload (PNG/SVG, 2 MB) with states: idle, uploading, pending review, rejected with reason, approved. Live preview of jersey and bus. One gold button: "Save livery" / "Gem trøjedesign". Desktop and Android, light and dark.

### 7. Surface integration

- Standings row with a 16 px mini-jersey next to the team name.
- Rider card with jersey and portrait slot.
- Rider profile hero: name in Bebas, 2 px gold keyline on top, and a hero slot for the future 3D figure. Annotate that the figure turns its head toward the viewer on page open and idles (breathing, blink) afterwards. Provide a static fallback for reduced motion.
- Team page: bus, car, staff row, kit history strip.

### 8. Vehicles, helmets, staff

Team bus (side), team car (side and three-quarter), road helmet and time-trial helmet, and five staff portraits in the chosen style: sports director, doctor, mechanic, soigneur, scout.

### 9. Handoff board

Layer and part naming convention, colour token names, a draft JSON shape for `livery` and `rider_genome`, and your open questions for me.

## Output requirements

Named layers, SVG-exportable vector for every template and wordmark, hex values on every colour, UI artboards in light and dark, and a short recommendation wherever you made a taste call. Do not invent game features or copy beyond what is listed; ask instead.
