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

1. **Roller pr. løb.** Motoren konsumerer allerede fem roller —
   `captain` / `sprint_captain` / `hunter` / `free_role` / `helper`
   (`backend/lib/raceRoles.js:213`, arbejdsomkostninger `:228`). Det er
   mockup'ernes *eget* ordforråd (Leader/Domestique hård+let/Lead-out) der ikke
   har dækning. Matrixen skal bruge spillets ord.
   _(Rettet 21/8 — den tidligere note "motoren konsumerer ingen roller i dag"
   var forkert.)_
2. **Formtop-vinduer** i alle mockups er illustrative seeded placeholder-data;
   et rigtigt formsystem findes ikke endnu.
3. Overlap/clash-data ER ægte i motoren (parallelle spor, plan 23/6) — den del
   af konceptet kan bygges mod eksisterende data.
4. **IA afklaret (ejer 21/8):** sæsonmatrixen bor i `/planning?tab=selection`
   bag en `Sæson / Dag`-knap; klik på en løbsdag lander i dagens board. Ét sted
   at gemme en udtagelse. Kræver at `RaceHubBoard` får en sæson-tilstand ved
   siden af sin `?day=`-navigator. `RaceSelectionPanel` på løbssiden består.

## Datamodel — sådan ser en løbsdag faktisk ud (verificeret 21/8 mod S3-prod)

- **Én løbsdag = én kalenderdag.** Et etapeløb kører 3–4 etaper pr. dag, så
  Giroens 21 etaper fylder **7 løbsdage**, ikke 21. `races.game_day_start` er
  startdagens indeks; `races.stages` er et etape-antal, ikke et dags-spænd.
- **En lang GT ligger som to rækker** i forlængelse af hinanden (Giro D1–7 +
  D8–12). `· II`-opdelingen i V3 er altså tro mod dataene — men begge rækker
  hedder i dag det samme, hvilket er dublet-navne-bug'en (ejer-test 20/8, kun D1).
- **S3 har racing på 28 datoer** (25/8–21/9), mens `seasons.race_days_total`
  står på 27, fordi den tæller dage hvor et løb *starter*. Jf. #3990.
- Trupstørrelser pr. klasse: `backend/lib/raceAutopick.js:14` (GT 8, Monument +
  WT 7, ProSeries/Class 6). Rute-match: `suitability` 0–100 returneres allerede
  af udtagelses-endpointet (`backend/lib/raceSelection.js:126`).

Fuld sammenligning tester-v3 vs. V3-prototypen + byggerækkefølge:
issue [#1146](https://github.com/NicolaiDolmer/CyclingZone/issues/1146),
kommentaren 21/8.
