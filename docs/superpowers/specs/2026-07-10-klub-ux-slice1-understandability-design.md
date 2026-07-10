# Klub-UX Slice 1 — forståelses-kernen (design)

> 2026-07-10 · #1441-opfølgning. Bygger ovenpå copy-oprydningen i #2289 (jargon → spiller-sprog).
> Scope-beslutninger (ejer, 2026-07-10): (1) ikke-live faciliteter = **teaser + låst køb**; (2) leveres i **to slices** — dette er Slice 1.

## Problem

Klub-fladen er endnu flag-gated OFF (`facilities_enabled=false`). En ny spiller lander direkte i fem facilitetskort med prisskilte, uden at forstå:
- hvad faciliteter overhovedet gør for holdet
- at kun Training Center faktisk virker nu (de øvrige motorer er ikke wired)
- hvad "+1.5%" betyder i praksis
- at upkeep + løn er tilbagevendende sæson-omkostninger

Copy-oprydningen (#2289) fjernede jargonen. Slice 1 gør fladen **forståelig og ærlig**: forklarer værdien, skjuler ikke-live køb bag "Coming soon", og oversætter effekt til spiller-værdi.

## Beslutninger

- **Ikke-live faciliteter (`effectLive === false`): teaser + låst køb.** Alle 5 spor vises, men kun spor med live-motor (i praksis Training nu) kan bygges/opgraderes. De øvrige er kompakte "Coming soon"-teasers uden købsknap — de viser roadmap uden at lade spilleren betale for nul effekt.
- **Kun frontend.** Bruger eksisterende `facility.effectLive` / `effectiveBonus` / `seasonCost` fra `/api/club/facilities`. Ingen backend- eller migration-ændring. Ejeren kan stadig admin-teste Training-motoren.
- **`effectLive` er eneste kilde til "live".** Ingen hardcodet track-liste i UI — hvis en anden motor wires senere (fx medical), flipper backend `effectLive` og kortet bliver automatisk købbart. Robust mod Slice 2+.

## Komponenter

### `KlubPage.jsx`
1. **Intro:** under titlen, en klar sætning (`page.intro`) om hvad faciliteter gør + at de koster hver sæson. Erstatter den intetsigende "Facilities and staff"-subtitle.
2. **Gruppering:** split faciliteterne i live (`effectLive`) og coming-soon; render live først (fulde kort), derefter teasers. Inden for hver gruppe bevares `TRACK_ORDER`.
3. **Økonomi i klartekst:** erstat den bare `Upkeep / Payroll / Balance`-række med én sætning (`cost.seasonLine`) drevet af `seasonCost`: "Every season you pay {upkeep} upkeep + {payroll} wages = {total} CZ$. Budget for it before you upgrade."

### `FacilityTrackCard.jsx`
Kortet vælger variant på `effectLive`:
- **Live-variant** (nuværende fulde kort) + **ROI-tekst** der oversætter effekten:
  - tier ≥ 1: `roi.<track>` med `{value}` (fx "Your riders train 1.5% faster every day").
  - tier 0 (ikke bygget, effekt = 0): `roi.<track>Build` (fx "Build it to start training your riders faster").
  - Fallback: hvis en live track mangler ROI-copy, vis den eksisterende `Effect {value} {effect}`-linje. Bevarer tier-ladder, build/upgrade-knap, upkeep, staff-linje.
- **Locked teaser-variant** (`!effectLive`): kompakt række — navn + kort "hvad den vil gøre" (`tracks.<track>.soon`) + "Coming soon"-pill. Ingen tier-ladder, ingen købsknap, ingen staff/upkeep. Commercial får warning-tonet pill (langsigtet sink), de øvrige accent-tonet.

Kun live-kort wirer `onUpgrade`/`onOpenStaff` → confirm/staff-modaler kan kun nås for live spor (ingen ekstra guard nødvendig).

### Copy (`klub.json`, en + da)
Nye nøgler: `page.intro`, `cost.seasonLine`, `tracks.<track>.soon` (alle 5), `roi.training` + `roi.trainingBuild` (kun training er live i Slice 1; øvrige tilføjes når deres motor lander). EN først, DA under. Ingen em-dash.

## Uden for scope (Slice 2)
Tier-preview af næste niveaus effekt (før køb) · help/FAQ-sektion for faciliteter (`help.json`).

## Test
- `KlubPage.wiring.test.js` (udvid, source-string-stil): assertér gruppering på `effectLive` + at `page.intro`/`cost.seasonLine` bruges.
- Ny `FacilityTrackCard.wiring.test.js` (source-string): live-variant rendrer upgrade-`Button` + ROI-nøgle; locked-variant rendrer ingen `Button` og bruger `tracks.*.soon` + "Coming soon".
- i18n key-parity (eksisterende parity-test) · frontend `node --test` grøn · JSON-parse · `npm run lint`.
- **Visuel proof:** preview-render af `/klub` via `VITE_PREVIEW_MOCK` (mocken serverer `/api/club/*`, training `effectLive=true`, øvrige `false`) — screenshot af live-kort + teasers + økonomi-linje.

## Verifikation af antagelser (grounded)
- `facility.effectLive` findes i payload (`clubMock.js:82` + backend `EFFECT_LIVE_BY_TRACK`); kun `training` er `true`.
- Ved tier 0 er `effectiveBonus = 0` (`BASE_EFFECT[track][0] = 0`) → derfor build-prompt frem for "+0.0%".
- `seasonCost = { totalUpkeep, totalPayroll, balance }` findes i payload.
