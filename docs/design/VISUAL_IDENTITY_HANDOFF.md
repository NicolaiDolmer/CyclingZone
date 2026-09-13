# Visual Identity: hvor tingene ligger (SSOT-peger)

> Selve eksporten fra Claude Design ligger i `docs/design/visual-identity/` (pushet af Claude Design 11/9 2026 paa branch `design/visual-identity-v1`): `cz-portrait.js` (renderer, source of truth for alle rytter-tegninger), `tokens.json`, `ART_BIBLE.md`, `VISUAL_IDENTITY_HANDOFF.md` (status-blokken fra artboard 09), `README.md`, `export-svg.mjs` (`node docs/design/visual-identity/export-svg.mjs` genskaber `svg/`), `svg/` (11 masters, genereret), `png/` (artboard-renders, tilfoejes fra ejerens download).
>
> Canvas: "Cycling Zone Visual Identity v1". Delelink: https://claude.ai/design/p/c715e044-7463-4c6c-b4cc-941c9972ab89?file=Cycling+Zone+Visual+Identity+v1.dc.html&via=share
>
> Prompts: `docs/drafts/claude-design-prompt-visual-identity-2026-09-10.md` (brief), `claude-design-prompt-recover-and-export-2026-09-11.md`, `claude-design-prompt-export-and-hold-2026-09-11.md`. Refs #5113 #5114 #5115 #5117 #5118.

## Konflikt-tjek mod de oevrige planer (Claude Code 11/9)

- GDD/TASTE: "Flat + ink" med 5 px radius, hairline og rationeret guld er inden for TASTE.md. Morale-udtrykket i ansigtet er en bevidst undtagelse fra fog of war; skal skrives ind i GDD som beslutning foer #5117 bygges.
- Tailwind 4-migrationen (#5150 til #5152) roerer de samme UI-filer som #5115/#5117; raekkefoelge: Tailwind foerst, derefter livery-UI, saa snapshots kun flyttes een gang.
- S4-cutover 28/9 (bane 1) har forrang; visuel identitet er bane 3 og starter med #5114 (TASTE-udvidelse) + tokens.json som kilde til design-tokens.
- "Male riders only" er en produktbeslutning taget i Claude Design; bekraeftes af ejeren i #5113 foer genome-boardet (03).
- Aabne ejer-spoergsmaal (6) staar som kommentar paa #5113 (11/9); Claude Design venter paa svar foer board 03.
