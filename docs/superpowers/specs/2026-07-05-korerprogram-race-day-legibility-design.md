# Kørerprogram — race-day legibility + strategic depth (design)

**Dato:** 2026-07-05
**Issues:** [#1984](https://github.com/NicolaiDolmer/CyclingZone/issues/1984) (læsbar overlap-status ved samtidige løb) · [#2195](https://github.com/NicolaiDolmer/CyclingZone/issues/2195) (samme rigtige eftermiddag, forskellige in-game dage er forvirrende)
**Status:** godkendt koncept (ejer 2026-07-05). Lag 1 til implementering nu; lag 2–3 som følgeslices.

## Problem

Rytter-binding låser pr. **in-game løbsdag** (`game_day`), ikke pr. virkeligt klokkeslæt — korrekt design. Men flere in-game dage komprimeres til samme virkelige eftermiddag, så spilleren ser "to løb samme dag, hvor de samme ryttere må bruges begge steder" og kan ikke selv afgøre om det er tilsigtet eller en glitch. Det skaber tvivl om spillets integritet.

Domæneregel (ejer-bekræftet, **må ikke laves om**): en rytter kan ikke køre to løb der reelt overlapper (samme in-game dag). To løb på *forskellige* in-game dage må dele ryttere — men det koster træthed (`raceFatigue.js`), så det er et trade-off, ikke et exploit.

**Problemet er læsbarhed, ikke reglen.**

## Verificeret på prod-data (2026-07-05)

- `game_day` er udfyldt på **954/954** `race_stage_schedule`-rækker (0 mangler) → et løbsdag-mærke kan rendere direkte uden fallback-heuristik.
- Friisisch-hændelsen (#2195): Classique du Léon = `game_day` 10 (04-07 13:00Z), Gran Premio de Navarra = `game_day` 11 (04-07 16:00Z). Distinkte spil-dage, samme IRL-dato → genbrug er korrekt.
- **Rod-årsag fundet (levende):** der findes lige nu mange PLANLAGTE løbspar i samme pulje på samme CET-dato men forskellige `game_day` — fx div 1 den 11-07 (Hamburger Klassiker gd19 + Ronde van de Lage Landen gd20) og 14-07 (Le Mur de Huy gd29 + Giro della Penisola gd30). Se rod-årsagen nedenfor.

## Rod-årsag: brættet og gem-guarden bruger to nøgle-rum

`races.game_day_start` findes; `game_day_end` gør ikke (deriveres fra schedule).

Efter kalender-rebuilden (2026-06-27) blev **save-guarden** flyttet til `game_day` (`loadTeamBindingContext` selecter `game_day`; PUT `/selection` tillader korrekt genbrug på tværs af forskellige spil-dage). Men **distribution-brættets display-binding blev IKKE flyttet med** — en delvis migration:

- `GET /api/races/distribution` loader schedule-rækker via `fetchAllScheduleRows` (kun `race_id, scheduled_at`, **ingen** `game_day`).
- → `raceBindingWindow` falder tilbage til **CET-kalenderdag-ordinaler** (`useGameDay=false`).
- → brættets `bindingMap` (pulje-lås, popover) regner to løb på samme CET-dato som overlappende, **selv når deres `game_day` er forskellige**.

**Resultat:** brættet viser rytteren som låst/overlappende, mens gem tillader genbrug. Det er en levende **falsk-positiv** — ikke bare en manglende etikette — og den direkte kilde til friisisch/thelamba/zootne-forvirringen. #1984's acceptance kræver eksplicit "ingen falsk-positive overlap-blokke for løb der reelt ikke overlapper".

**Backwards-check (alle forekomster):** samme CET-ordinal-binding fandtes i TRE API-stier, alle rettet til `game_day` i denne slice: (1) `GET /distribution` (display-bræt), (2) `POST /distribution/regenerate` (autofill — over-begrænsede placering på tværs af spil-dage), (3) `POST /strategy/preview` (strategi-diff). Save-guarden var allerede korrekt. `fetchAllScheduleRows` (uden game_day) beholdes kun til den rene timeline-visning der ikke laver binding.

## Allerede bygget (skal IKKE genopbygges)

Fra #1823/#1925 + #1984's første runde:
- Save-guarden (`loadTeamBindingContext`) nøgler korrekt på `game_day`; afmeldte løb binder ikke; `windowsOverlap` er dag-granulær.
- Puljens chips: låst kun hvis bundet i *alle* dagens løb; låste chips er klikbare; inline lås-grund navngiver det bindende løb.
- `AddRiderPopover` grupperer allerede "Ledig til" vs "Optaget i overlappende løb" med navngivet grund.
- Kladde-model: fjern en rytter → straks fri i kladden; `saveAll` 2-faset release/bind; navngiven overlap-gemfejl.

Det uløste er **(1)** at brættets display-binding er på forkert nøgle-rum (rod-årsag ovenfor) og **(2)** at in-game løbsdagen er usynlig.

## Koncept: Kørerprogram

Ét samlende koncept i stedet for punktfixes: **spil-dagen er tidsaksen, rytteren har et program, træthed er prisen.** Leveret i tre lag, hver især shippbar og værdifuld alene.

| Lag | Hvad | Lukker |
|-----|------|--------|
| **1. Løbsdag-læsbarhed** | Spil-dagen synlig på bræt + løbskort + pulje; kompatibilitet forklaret positivt; læringsnote i genbrugs-øjeblikket. | #2195 + #1984 |
| **2. Konsekvens-preview** | Rytterens form projiceres frem gennem programmet; en udtagelse viser trætheds-prisen før commit. | Verdensklasse-løft |
| **3. Sportsdirektør-indsigt** | Proaktiv rotations-anbefaling ("Holland kører 3 af 4 dage — rotér?"). | Overgår forventningerne |

Program-visningen (gitter) **erstatter ikke** brættet — brættet forbliver den direkte drag-and-drop-flade (#1925). Kørerprogram er en komplementær linse med samme kladde-state; lag 2–3 bor der.

---

## Lag 1 — detaljeret design (denne slice)

Mål (fra #1984 acceptance): spilleren kan med ét blik se hvilke samme-dags-løb der låser en rytter og hvilke der ikke gør; ingen falsk-positive; ægte-overlappende løb blokerer fortsat.

### Backend

`backend/routes/api.js` — distribution-endpointet (`GET /api/races/distribution`):

1. **Rod-årsags-fix (kritisk):** load schedule-rækkerne med `game_day` (skift `fetchAllScheduleRows` → `fetchAllScheduleRowsWithGameDay` på L~1701), så `raceBindingWindow` regner i **`game_day`-rum** ligesom save-guarden. Det fjerner de falsk-positive bræt-låse for løb på samme CET-dato men forskellige spil-dage. Opdatér den nu-forældede kommentar (L~1707-1709) der siger "CET-dag-ordinal til BINDING". `raceTimeWindow` (display-vindue) bruger fortsat `scheduled_at`, som stadig følger med.
2. **Display-felter:** tilføj pr. kolonne (~L1757) via ny pure helper `raceGameDaySpan(scheduleRows)` i `raceBinding.js` (afledt direkte af rækkernes `game_day`, null hvis nogen mangler):

```
game_day:      min(game_day) over løbets schedule-rækker   // null hvis nogen mangler
game_day_end:  max(game_day) over løbets schedule-rækker   // = game_day for endagsløb
```

Samme felter på løbs-detalje-endpointet der fodrer løbskortet (`races.game_day_start` findes; `_end` deriveres fra schedule). Ingen migration — `game_day` findes allerede på `race_stage_schedule`.

Defensiv note: `game_day` er 954/954 udfyldt i prod nu, så alle kolonner ender i `game_day`-rum (konsistent). `raceBindingWindow` vælger nøgle-rum pr. løb — skulle et enkelt løb mangle `game_day`, ville det falde til CET-ordinaler og ikke kunne sammenlignes korrekt med game_day-løb; det er en eksisterende edge uden for denne slice (population er fuldt backfillet).

### Frontend

Player-facing copy **EN først, DA under** (i18n `races`-namespace, en+da). Tal rundes.

1. **`RaceColumn` header** — "Race day N"-mærke (endagsløb) / "Race days N–M" (etapeløb) ved siden af type/klasse. Skjul hvis `game_day == null`.
2. **`RaceHubBoard` dag-struktur (C-lite)** — når de synlige kolonner spænder over >1 `game_day`, gruppér dem under lette "Race day N"-underoverskrifter i kronologisk rækkefølge; ellers vis ét dag-gruppe-band ("Fri 4 Jul · race day 10"). Ren visuel gruppering — ingen ændring i kladde/gem-logik. Ny pure helper `groupColumnsByGameDay(columns)` i `raceHubLogic.js` (+ test).
3. **`AddRiderPopover` — positiv kompatibilitet** — i "Ledig til"-gruppen: hvis rytteren allerede er i et andet løb på *samme IRL-dato men anden game_day*, tilføj hint "Same day as X · race day N — can ride both" (grøn). Blokerede beholder navngiven grund + "Overlaps race day N". Ny pure helper `sameDayCompatibilityHint({ column, columns, bindingMap, riderId })` (+ test).
4. **Fatigue-carry markør** — en rytter udtaget til et løb hvis `game_day` er senere end et andet af dagens løb han også er i: lille inline-note "Rode race day N · carries fatigue" (bygger på eksisterende `freshnessTier`). Let; fuld projektion er lag 2.
5. **Inline-læringsnote (engangs)** — første gang en rytter tildeles to løb på samme IRL-dato med forskellige game_days i kladden: en dismissibel note der forklarer mekanikken. `localStorage`-flag så den kun vises én gang pr. bruger.

### Help + patch notes

- `help.json` (en+da): ny/opdateret post — "One rider per in-game race day; races on consecutive days can share riders; reusing a rider costs fatigue." (jf. #1171-rutine).
- `PatchNotesPage.jsx`: ny version-post (brugerrettet ændring).

### Non-goals (YAGNI, senere lag)

- Formprojektion / konsekvens-preview (lag 2).
- Sportsdirektør-rotationsindsigt + "Foreslå rotation" (lag 3).
- Fuld program-gitter-visning (D) som separat fane (bygges når lag 2 giver den strategiske substans).
- Ændringer i binding-/gem-logik (den er korrekt og verificeret).

### Test

- `frontend/` `node --test`: nye pure helpers (`groupColumnsByGameDay`, `sameDayCompatibilityHint`) med dækning af endags- vs etapeløb, samme-IRL-dato-forskellig-game_day, ægte overlap, manglende `game_day`.
- Backend: distribution-endpointets nye felter (min/max game_day, null-defensiv) — udvid eksisterende distribution-test.
- Playwright `core-smoke` alle 3 projekter hvis den visuelle board-struktur ændres; vedhæft ægte screenshots til PR (ikke kun mock).

### Acceptance (lag 1)

- [ ] Løbskort + bræt-kolonner viser in-game løbsdagen.
- [ ] To løb på samme IRL-dato med forskellige game_days er visuelt tydeligt forskellige spil-dage.
- [ ] Popoveren forklarer *hvorfor* et samme-dags-løb er tilgængeligt (kompatibel) hhv. blokeret (ægte overlap, navngivet).
- [ ] Genbrugs-øjeblikket forklares inline første gang.
- [ ] help.json (en+da) + patch note opdateret.
- [ ] Ingen ændring i binding-adfærd; eksisterende tests grønne.

---

## Slice-rækkefølge

1. **Nu:** Lag 1 (denne spec). Lav risiko, lukker #2195 + #1984, står stærkt alene. Bevidst valgt frem for big-bang midt i TdF-vinduet.
2. **Næste:** Lag 2 — formprojektion (kræver let form-fremskrivning; egen spec).
3. **Derefter:** Lag 3 — DS-indsigt (bygger på lag 2's projektion).

## Referencer

Kode: `backend/lib/raceBinding.js` · `backend/routes/api.js` (distribution) · `frontend/src/components/racehub/{RaceHubBoard,RaceColumn,AvailableRidersPool,AddRiderPopover}.jsx` · `frontend/src/lib/raceHubLogic.js`. Relateret: #1983, #1823, #1906, #1856, #1146, #2120.
