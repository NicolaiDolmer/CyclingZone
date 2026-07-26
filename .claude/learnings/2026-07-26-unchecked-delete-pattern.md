# Utjekket delete-then-insert: samme fejlklasse, fjerde gang

**Dato:** 2026-07-26
**Issues:** [#2974](https://github.com/NicolaiDolmer/CyclingZone/issues/2974), [#2898](https://github.com/NicolaiDolmer/CyclingZone/issues/2898)
**Klasse:** tavs skrivefejl → datadublering → forkerte point og dobbelt præmiepenge

## Rodårsag

`supabase-js` kaster ikke. Hver operation — også en fejlet — returnerer et
*resolved* promise med `{ data, error }`. Et kald skrevet som

```js
await supabase.from("race_results").delete().eq("race_id", id);
```

binder ingenting. Fejler skrivningen (fx statement timeout under samtidige
etaper), fortsætter koden som om den lykkedes.

Det gør ikke noget i sig selv. Det gør noget fordi hele persist-laget i
`raceRunner.js` bygger på et **idempotent delete-then-insert**: slet denne
kørsels etaper, indsæt dem igen. Fejler deletet tavst, kører insertet alligevel
— og lægger de nye rækker *oven på* de gamle.

For `race_results` betyder det dublerede `points_earned` og **dobbelt**
`prize_money`, fordi `prizePayoutEngine.js` betaler pr. point-række. Det er
direkte spillervendt: forkerte stillinger og penge udbetalt to gange.

## Hvorfor den slap igennem første gang

Tre ting, i lag:

1. **Fejlen har ingen symptomer på skrivetidspunktet.** Ingen throw, ingen 500,
   ingen Sentry-linje, ingen log. Den eneste observerbare effekt er en dublet i
   en tabel ingen kigger på manuelt. Klassen har nu ramt os fire gange
   (#2861 kalender-perf, #2877 tabt etape-berigelse, #2898 fuld-sim, #2974) og
   er hver gang fundet ved kodelæsning, aldrig ved at nogen opdagede symptomet.

2. **Den eksisterende guard havde et hul den selv kendte.**
   `lint-dropped-supabase-error.mjs` (#2897/#3002) fanger
   `const { data } = await supabase…` — altså en destrukturering der binder
   `data` men ikke `error`. Den kræver en binding for at kunne se at `error`
   mangler. Det bare `await supabase.from(…).delete()` binder *ingenting* og
   falder derfor uden for. Guarden dokumenterede eksplicit hullet og pegede på
   #2974 — men et dokumenteret hul er stadig et hul.
   `lint-swallowed-catches.mjs` fanger den heller ikke: der er ingen catch,
   fordi der aldrig kastes noget.

3. **#2898's fix var scopet til de navngivne linjer.** PR #2973 rettede de to
   kald issuet pegede på (`race_results`-delete og `races.status`-update i
   fuld-sim) og *noterede* at `persistRuns`/`persistIncidents` havde samme
   mønster — men lod dem ligge for at holde PR'en stram. Det var en forsvarlig
   afvejning, men den efterlod fem forekomster af nøjagtig samme fejlklasse i
   samme fil, plus to i PCM-import-stien som ingen havde kigget efter.

**Mønsteret bag mønsteret:** en fejlklasse blev behandlet som en liste af
kendte forekomster i stedet for som en klasse. Backwards-check'et manglede.

## Hvad der blev fundet ved backwards-check

Et bredt scan (ikke en fil-liste) fandt **114** fire-and-forget-mutationer i
`backend/lib/**`, `backend/routes/**` og `cron.js`. Syv af dem lå i
race-motoren og dens nabo-persistens og blev rettet:

| Sted | Tabel | Konsekvens ved tavs fejl |
|---|---|---|
| `raceRunner.js` `persistRuns` | `race_simulation_runs` | dublerede run-snapshots + rider_scores |
| `raceRunner.js` `persistIncidents` | `race_incidents` | dublerede styrt/skader i etape-loggen |
| `raceRunner.js` `persistPassages` | `race_stage_passages` | dublerede waypoints på etapeprofilen |
| `raceRunner.js` `persistStageMoments` | `race_stage_moments` | dublerede why-momenter |
| `raceRunner.js` etape-finalisering | `races.status` | løb står "ikke afviklet" trods skrevne resultater → recovery kører oven på dem |
| `pcmResultsImport.js` | `race_results` | **dublerede point + dobbelt præmiepenge** |
| `pcmResultsImport.js` | `races.status` | forkert `race_days_completed`-recompute |

Den vigtigste er `pcmResultsImport.js`: **præcis samme fejl som #2898, med
præcis samme spillervendte konsekvens, bare i admin-import-stien** — og den var
ikke nævnt i noget issue. Den ville ikke være fundet uden et bredt scan.

## Hvad guarden nu fanger

`scripts/lint-unchecked-supabase-mutation.mjs` — søsterguard til
`lint-dropped-supabase-error.mjs`, samme baseline-ratchet-form, samme delte
scanner-primitiver (`scripts/lib/js-source-scan.mjs`).

Den flager et await'et `.delete(` / `.insert(` / `.update(` / `.upsert(` på en
`.from(…)`-kæde når det står som et **bart expression-statement** — altså hvor
resultatet umuligt kan læses. Bundet resultat, `return`, og en eksplicit
`// best-effort`-markør går fri.

**Vigtigt designvalg:** fil-udvælgelsen er et **træ-walk**, ikke en liste.
En hardkodet fil-liste driver fra virkeligheden i det øjeblik nogen tilføjer en
fil — den fælde bed os 25/7, hvor en eksisterende guard viste sig kun at scanne
et forældet udsnit.

**Negativ kontrol (kørt, ikke antaget):** mønsteret blev genindført i
`persistRuns`, guarden fejlede med `EXIT=1` og pegede på
`backend/lib/raceRunner.js:998 — .delete()`; mønsteret blev fjernet igen og
guarden blev grøn. Tilsvarende blev regressionstesten kørt mod den *gamle* kode
og fejlede med `Missing expected rejection` — den tester altså noget virkeligt.

## Sidegevinst: invarianten afslørede en ustabil paginering

Duplikat-invarianten i `backend/scripts/verify-invariants.js` rapporterede
først **118.365** dubletter. De var alle falske. To separate fejl:

1. **`rider_id IS NULL`** — hold-klassementerne (`team`, `team_day`) har per
   design ingen rytter, og gamle PCM-importer efterlod umatchede rækker.
   43.288 af 487.377 rækker. `GROUP BY` samler dem alle i én nøgle.
2. **`fetchAll` paginerede uden `ORDER BY`.** PostgREST/Postgres garanterer
   ikke samme rækkefølge mellem to `Range`-requests. Den samme række kan komme
   med på to sider mens en anden udebliver. For *enhver* tabel over 1000 rækker
   gjorde det resultatet upålideligt — `squad_within_max` talte 11 hold hvor SQL
   sagde 14 (differencen viste sig at være division 4, som `SQUAD_MAX` slet ikke
   dækker — et separat, pre-eksisterende hul).

Begge er rettet. Invarianten matcher nu SQL præcist: 444.089 rytter-nøgler,
**0 dubletter** i prod.

**Læringen:** en ny invariant der fejler skal mistænkes for at være forkert,
før dataene mistænkes. Havde jeg rapporteret "118.365 dubletter i prod" uden at
verificere mod rå SQL først, havde jeg udløst en dataredning der ikke var brug
for — mod en tabel med 487.000 rækker.

## Regler at tage med

- **En fejlklasse er ikke en liste af linjer.** Retter du et sted, så scan efter
  hele klassen i samme PR — bredt, ikke i de filer issuet nævner.
- **Guards scanner træer, ikke lister.** En fil-liste er en guard med udløbsdato.
- **En guard uden negativ kontrol er en guard vi ikke ved virker.** Indfør
  mønsteret, se den fejle, fjern det igen. Hver gang.
- **Verificér et invariant-fund mod rå SQL før du kalder det et datatab.**
- Fortsat gældende: `supabase-js` kaster aldrig. Binder du ikke `error`, findes
  fejlen ikke.
