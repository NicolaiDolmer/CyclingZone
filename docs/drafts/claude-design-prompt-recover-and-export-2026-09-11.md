# Claude Design-prompt: find det gemte arbejde, saml det paa EET canvas, og eksportér saa Claude Code kan modtage det

Skrevet 11/9 2026. Baggrund: ejeren koerte design-briefen fra 10/9 (`claude-design-prompt-visual-identity-2026-09-10.md`) i Claude Design og fik bl.a. rytteransigter, men en senere session kunne ikke finde arbejdet igen. Claude Code kan ikke se ind i Claude Design; det eneste der kan overleveres er (1) et delelink til et canvas og (2) tekst/billeder ejeren selv henter ud. Denne prompt tvinger Claude Design til at samle alt paa eet navngivet canvas og lave en handoff-blok, som ejeren kopierer ind i issue #5113. Derefter kan Claude Code laese linket, gemme PNG'er under `docs/design/visual-identity/` og skrive `docs/design/VISUAL_IDENTITY_HANDOFF.md`.

Ejeren: kopiér alt under linjen ind i Claude Design som foerste besked i en NY samtale. Naar den er faerdig: (a) tryk Share/Del og saet linket til "kan ses af alle med link", (b) kopiér handoff-blokken (ren tekst) ind som kommentar paa https://github.com/NicolaiDolmer/CyclingZone/issues/5113 sammen med linket, (c) eksportér hvert artboard som PNG hvis knappen findes og gem dem i en mappe du kan pege Claude Code paa.

---

You are continuing work on the **Cycling Zone Visual Identity System**. In an earlier session in this workspace I (the owner) gave you a canvas brief titled "Cycling Zone: Visual Identity System (canvas brief)" and you produced artboards, among them rider faces for the rider "Ada Pedersen" in three style levels and an ageing row. A later session could not find that work. Your first job is recovery, your second is consolidation, your third is a handoff that a coding assistant can read.

## 1. Recovery (do this before anything else)

- Search this workspace for any canvas, artboard, file or draft that contains any of: "Cycling Zone", "Visual Identity", "Ada Pedersen", "rider genome", "livery", "sponsor universe", "art bible".
- List everything you find, with the canvas name, artboard names and when they were last edited. If you find nothing, say so in one plain sentence: "I found no saved Cycling Zone work in this workspace." Do not pretend.
- If you find partial work, do not redraw it. Import or copy it onto the single canvas in step 2.

## 2. One canvas, fixed names

Create or rename ONE canvas: **"Cycling Zone Visual Identity v1"**. Every artboard gets a numbered name exactly as below so a script can reference it:

1. `01-style-exploration` (Ada Pedersen in styles A, B, C, plus ageing 21/29/37, plus your five-line recommendation)
2. `02-art-bible`
3. `03-rider-genome`
4. `04-livery-system`
5. `05-sponsor-universe`
6. `06-livery-designer-ui` (light + dark, Android 360 + desktop 1280)
7. `07-surface-integration`
8. `08-vehicles-helmets-staff`
9. `09-handoff` (see step 3)

Move recovered work into the matching artboard. Artboards you have not made yet stay empty with a grey placeholder note "not started" (do not fill them now; the brief says stop after artboard 1 and ask me to pick a style, and that still applies if no style has been picked).

The binding design rules from the original brief still apply: editorial, data-first; 5 px radius; hairline borders `#e5e0d5` light / `#2a2d3a` dark; backgrounds light `#f4f2ec` / `#fcfbf7` / `#ece9e1`, dark `#0e0f15` / `#161824` / `#14161e`; gold `rgb(232 197 71)` only for one primary button per view and leader markers; Bebas Neue for one hero word, Inter Tight 20/700 headers, DM Sans body, tabular figures; stroke icons only; English first, Danish second; fog of war: nothing on a face or body may reveal hidden numbers.

## 3. Handoff artboard `09-handoff` (plain text, copyable)

Write a text block I can copy as Markdown. It must contain, in this order:

```
# Visual Identity handoff (Claude Design, <date>)
## Status
- Style picked: A / B / C / not yet picked
- Artboards done: <list>, not started: <list>
## Decisions made in Claude Design
- <one line per decision, with the artboard it lives on>
## Tokens
- Colours (hex, light/dark), type scale, line weights at 16/48/128 px, shading bands
## Rider genome axes
- axis: count (values)
## Livery templates
- 12 names, colour roles, contrast rule, sponsor zones
## Sponsor universe
- 36 names by family, tier, two colours each (or "not started")
## Open questions for the owner
- <max 5>
## Assets
- Share link: <paste>
- PNG export per artboard: yes/no
```

Fill only what is true. Write "not started" where nothing exists. No invented brand names or numbers.

## 4. Finish

End your reply with three things: the canvas name, the list of artboards with done/not started, and the exact sentence "Copy artboard 09-handoff into GitHub issue #5113 together with the share link." Then stop and wait; do not continue to new artboards until I have picked a style.
