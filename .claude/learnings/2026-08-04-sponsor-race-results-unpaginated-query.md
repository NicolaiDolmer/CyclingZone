# Postmortem · 2026-08-04 · sponsor result-bonus underbetalt pga upagineret race_results-query

## Hvad skete der?
`sponsorRaceDayIncome.payRaceDaySponsorsToDate` beregnede stage_win/podium-
sponsorbonusser ud fra en upagineret `race_results`-query. For etapeløb med
5000+ resultat-rækker capper PostgREST stille ved 1000, så vinder-/podie-
rækker droppedes vilkårligt. Ét hold i prod var underbetalt med ~94%
(204.204 CZ$ manko) på tværs af 12 løb, opdaget under en manuel sponsor-audit
4/8 — ikke af et alarm/monitor.

## Root cause
`backend/lib/sponsorRaceDayIncome.js` (linje ~163-167, før fix) kaldte
`.from("race_results").select(...).eq("race_id", race.id)` direkte, uden
`.order()`/`.range()`. Samme fælde som #2764 og #3030 i
`prizePayoutEngine.js` — filens egen header-kommentar hævdede at "mirror'e"
det query-mønster, men pagineringen blev aldrig kopieret med da #2948
("Sponsorvalg 2.0") tilføjede resultat-bonus-beregningen oven på den
eksisterende, allerede-upaginerede race-day-query.

## Fix
`sponsorRaceDayIncome.js`: erstattet med `fetchAllRows` (fra
`supabasePagination.js`) + `.order("id", { ascending: true })`, samme
pagineringsprimitiv som `prizePayoutEngine.getSeasonPrizePreview`. Refs #3315,
PR med commit c6ff9003.

Samtidig wired de allerede-eksisterende men ukaldte `sponsor_paid`-
notifikationer ind på alle fire sponsor-udbetalingssteder (sæson-start,
race-day+resultat-bonus samlet, signing bonus, sæsonmåls-bonus), så
managere fremover ser beløbet i deres indbakke — en falsk stille
underbetaling som denne ville være langt lettere at spotte hvis spilleren
selv kunne se "forventet vs modtaget" i beskeden.

Efterbetaling af det ramte hold er en separat ejer-gated handling (ingen
data-mutation i denne PR).

## Forhindret-fremover
- Ny regressionstest i `sponsorRaceDayIncome.test.js` (#3315): mock med
  1005+ rækker hvor en kvalificerende etapesejr ligger på side 2 —
  demonstrerbart RED mod den upaginerede kode, GREEN efter fixet.
- `sponsor_paid`-notifikationerne giver et nyt, uafhængigt signal
  (spiller-synligt beløb) der kan afsløre fremtidige beregningsfejl langt
  hurtigere end en manuel audit.
- Stadig IKKE løst generelt: intet lint/greppable forward-guard fanger nye
  upaginerede `race_results`/store-tabel-queries automatisk — dette er 3.
  gang samme fælde bider (#2764, #3030, #3315). En dedikeret guard (fx et
  script der flagger `.from("race_results").select(...).eq(...)` uden et
  efterfølgende `.range()`/brug af `fetchAllRows*`) er stadig et åbent
  forbedringsforslag, ikke implementeret her.

## Læring
Et query-mønster der er "kopieret fra" et andet sted (jf. header-kommentaren
om at "mirror'e" prizePayoutEngine) skal verificeres linje-for-linje ved
hver udvidelse — en kommentar der PÅSTÅR paritet er ikke det samme som
faktisk paritet. Når en fil eksplicit dokumenterer at den mirror'er et
andet steds sikre mønster, er det et signal om at diffe de to filer direkte
næste gang nogen udvider den ene.
