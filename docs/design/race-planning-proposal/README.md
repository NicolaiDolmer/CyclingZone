# Race Planning · spillerindsendt design-forslag (2026-08-20)

Spillerindsendt mockup af en tværgående race-planning-flade: rytter × løb-matrix
for hele blokken med roller pr. løb, farvekodede overlap-clusters og clash-flag
når en rytter er udtaget i to overlappende løb. Hører til issue
[#1146](https://github.com/NicolaiDolmer/CyclingZone/issues/1146) (shared race
calendar design). Diskussionstråd + koncept-noter: kommentaren 20/8 på issuet.

## Filer

| Fil | Hvad |
|-----|------|
| `Main.dc.html` | **V3 hi-fi**: konceptet genopbygget på designsystemet (T2 wide data, Chalk-tokens, DM Sans/Inter Tight, ægte statColor-rampe, ægte terræn-silhuetter fra `stageProfileConfig.js`, rigtige løbsklasser GT/MON/WT). Claude Design-artboard-format (.dc.html). |
| `PlayerV2.dc.html` | Spillerens egen V2 (tiers, formtoppe, sortering). |
| `V1.dc.html` | Spillerens første udkast. |
| `canvas.json` | Canvas-layout til de tre artboards. |

## Live-flader

- **Delbar prototype (spillerfeedback):** https://cyclingzone.org/race-planning-preview.html
  — selvstændig vanilla-udgave af V3, ligger som statisk fil i
  `frontend/public/race-planning-preview.html` (PR #4022). Slettes derfra når
  feedback-runden er slut.
- **Design-canvas (ejer, org-intern):** Claude-artifact "Race Planning Proposal",
  https://claude.ai/code/artifact/db22200e-7c39-4ed4-b742-454fe7d63408 — alle tre
  versioner side om side, interaktive.

## Åbne beslutninger før byggeri

1. **Roller pr. løb** (Leader/Domestique hård+let/Free/Lead-out) er en
   gameplay-beslutning; motoren konsumerer ingen roller i dag.
2. **Formtop-vinduer** i alle mockups er illustrative seeded placeholder-data;
   et rigtigt formsystem findes ikke endnu.
3. Overlap/clash-data ER ægte i motoren (parallelle spor, plan 23/6) — den del
   af konceptet kan bygges mod eksisterende data.
4. I appen i dag sker udtagelse pr. løb via `RaceSelectionPanel` på løbssiden;
   denne flade ville være et tværgående supplement, ikke en erstatning (afklar
   IA-placering mod planlægnings-hubben fra #3102).
