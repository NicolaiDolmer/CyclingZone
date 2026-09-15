# Ryttertype-visning, rating-tal og punch-loft: design

> Ejer-beslutninger 11/9 2026 (fem spørgsmål, besvaret ét ad gangen i Claude Code).
> Baggrund: `docs/discord/2026-09-11-ryttertype-og-rating-visning-modeller.md`
> (Discord #dansk-snak 3/9–11/9, måling på 4.170 ryttere). Refs #3813, #5030,
> #3631, #3592, #4181. Eksempelsider vist ejeren: Nicolò Caruso og Mario S. Iglesias
> (claude.ai-artifacts, private).

## 1. Beslutninger (låst 11/9)

| # | Spørgsmål | Beslutning |
|---|---|---|
| 1 | Hvad lover type-badget? | **A: anlægget.** Født til, låst hele karrieren, styrer lofter. Lover IKKE at være top-2 i loft-listen. Bygges som preview, vises spillerne, de spørges "vil I have dette" før det går live. Ingen afstemning om A/B/C. |
| 2 | Hvilket tal er ratingen? | **Bedste rolle lige nu**, med rollenavnet ved siden af ("54 Bjergrytter"). Samme tal på kort, tabeller og marked. |
| 3 | Bakkerytter-loftet er højt hos alle bjergryttere | **Bjergrytterens punch-loft sænkes fra signatur (93) til 80.** Opskrift-stramning er målt og hjælper ikke (se §4). Regelændring: harness-målt, lander i sæsonpausen efter 27/9. |
| 4 | Sekundært anlæg skævt (rouleur+sprinter 62 %) | **Kun nye ryttere.** Generatoren trækker jævnt fra næste kuld; eksisterende ryttere røres ikke. |
| 5 | Hvad hedder badget? | **Natural role / Naturlig rolle.** Badge-label "NATURAL" / "NATURLIG", parret med "Best role now / Bedste rolle nu". |

Frarådet og fravalgt: model B (badge = top-2 lofter), Vman-lignende rollestraf,
opskrift-stramning af puncheur, gen-træk af sekundær hos eksisterende ryttere.

## 2. Hvad spilleren ser (leverance 1, visning, sæson 3)

**Rytterkort, rytterprofil-hero, tabeller (Ryttere, Mit hold, Transfers, auktion):**
- Rating-tallet = `max over 8 roller af ratingForRole(liveEvner, rolle)`, vist som
  tal + rollenavn: "54 Bjergrytter". Rollen kaldes "Best role now / Bedste rolle nu".
- Badget viser anlægget med label "Natural / Naturlig": "Natural: Rouleur / Climber".
- Sortering efter rating sorterer på det nye tal. Filtre får både "Natural role"
  og "Best role now" som felter (Ryttere, Transfers, scouting-targeting).

**Scouting-fanen (prognose pr. ryttertype):**
- Sektion 1 "His natural roles / Hans naturlige roller": anlæggets to roller med
  niveau nu, prognose-bånd og loft (som i dag).
- Sektion 2 "Other roles / Andre roller": de seks øvrige, samme kolonner, med én
  linje kontekst: "Roller deler evner. Rækkefølgen her er et estimat." Ingen
  motorændring: prognose-båndene bruger allerede ét potentiale-interval pr. rytter
  (`potentialeIntervalFor`, seed `scout-pot:<rider>:<team>`), så indbyrdes
  rækkefølge flipper ikke på scout-støj (det gjorde de gamle loft-bånd, #3813).
- Loftet bliver, med tooltip "Rollens max for denne rytter, sat af anlæg og alder.
  Potentiale indgår ikke."

**Ordliste** (rytterprofil, fold + help.json, EN/DA): Natural role, Best role now,
Ceiling/Loft, Potential/Potentiale (fart), Projection/Prognose (niveau ved peak,
spredt til dedikeret, planen indgår ikke), Rating.

**Preview-gate:** leverance 1 bygges på en branch med Vercel-preview, deles i
Discord med de to eksempelryttere, ejeren spørger "vil I have dette". Merge kun
efter ejer-go på preview (memory: UI-PR'er kræver visuelt ejer-go).

## 3. Motor (leverance 2, sæsonpausen efter 27/9)

**Punch-loft for bjergryttere:** i `capsShapingWeights.js` fjernes `punch` fra
`climber`s positive vægte, og `riderProgression.js` får `CLIMBER_PUNCH_FLOOR = 80`
efter samme mønster som `GC_PUNCH_FLOOR` (gulv på taget, tapres med alder, aldrig
over signatur). Netto: bjergrytterens punch-tag 93 → 80. Display-opskrifter
(`displayRecipes.js`) er urørte, så vagt 3 (delmængder) står. Klassifikator- og
værdi-vægte urørte (fire adskilte tabeller, #3665).

- Gate: `backend/scripts/spillervendteGates3709.mjs` + race-gate (50 seeds) før
  ship; forventning: bakkeetaper får flere bakkerytter-sejre, bjergetaper uændret
  (DEMAND_VECTORS: mountain punch 0,04).
- Eksisterende bjergryttere: ability_caps genberegnes ved næste nat-sweep; en
  bjergrytter med punch over 80 i dag beholder evnen (loft er et tag, ikke en evne,
  jf. #4634-mønstret), men vokser ikke videre i punch.
- Patch note + indbakkebesked ved sæsonstart.

**Sekundært anlæg:** `archetypeDistribution.js` trækker sekundæren med jævn
fordeling (mål: 8 typer inden for 8–18 % som primæren) for akademi-intake og
frie agenter genereret efter deploy. Ingen backfill. Måles i prod efter første
kuld (samme SQL som #3631).

## 4. Målinger der ligger til grund

- Menneskehold 11/9, n=4.170: vist type ≠ bedste rolle nu hos 63,1 % (snit-gab 3,3;
  ≥5 hos 13,5 %). Vist type ≠ højeste loft hos 33,8 %. Sekundær i top-2 loft: 56,0 %.
- Puncheur-opskrift, tre varianter mod `ability_caps` (top-3-andel / hos climber
  rang 1-2 / ægte puncheur rang 1): i dag 46,7 / 99,8 / 100; punch-tung 52,1 /
  69,8 / 95,3; eksplosiv 50,6 / 61,0 / 83,6. Konklusion: opskriften er ikke
  årsagen; `climber` ejer `punch` som signatur i `capsShapingWeights.js:49`.

## 5. Uden for scope (egne spor)

- Model C (signatur-tunge loft-opskrifter): kan komme senere uden at bryde A's løfte.
- #4181 (TT ikke bedst til enkeltstart, rouleur bedst til ingenting): løbsmotor, S4.
- #3592 (stjerner "kan det hele"): låst 10/8, ingen ændring.
- Vman-straf: fravalgt.

## 6. Test og verifikation

- Unit: `riderRating.test` (best-role = max, rollenavn følger), `scoutingReport`
  uændret, `riderProgression.test` (CLIMBER_PUNCH_FLOOR tapres, aldrig > signatur).
- E2E: rytterprofil + Ryttere-tabel snapshots (3 Playwright-projekter, #536).
- Prod-måling efter leverance 1: andel ryttere hvor vist rating = max (skal være
  100 %). Efter leverance 2: gen-kør puncheur-målingen (climber rang 1-2 skal
  falde markant fra 99,8 %).
