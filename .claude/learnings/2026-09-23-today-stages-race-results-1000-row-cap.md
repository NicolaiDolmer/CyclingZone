# Postmortem · 2026-09-23 · "Today's stages" viste ingen vinder pga upagineret race_results-query

## Hvad skete der?

Dashboardets "Today's stages"-kort viste "No results have been published for
this stage yet" og "Overall position not settled yet" på **afsluttede**
etaper, selvom resultaterne fandtes i databasen. Nogle kort viste i stedet en
forkert, forældet samlet placering.

Målt i prod 23/9 (kun SELECT, ingen mutation): 254 rigtige hold kørte i dag
(31 løb, 37 etaper), og 92 af dem havde over 1.000 `race_results`-rækker på
tværs af deres dagens løb. 69 hold manglede vinderen på 205 af 481 afsluttede
kort (9 af dagens 21 afsluttede etaper). 342 hold×etapeløb-kombinationer:
45 viste fejlagtigt "not settled", 69 viste en forkert placering, kun 228 var
korrekte.

## Root cause

`frontend/src/hooks/useTodayStages.js` hentede alle `leader`-, `team`- og
`stage`-rækker for holdets dagens løb i **én** forespørgsel, afgrænset kun af
`race_id` (`.in("race_id", ownRaceIds)`) og `result_type`
(`.in("result_type", ["leader", "team", "stage"])`) — ingen `.order()`,
`.limit()` eller `.range()`. PostgREST returnerer højst 1.000 rækker pr.
kald og dropper resten STILLE, uden fejl. Kommentaren på queryen kaldte den
"pagination-safe: ... langt under 1000", hvilket var forkert: et etapeløb med
160 ryttere passerer 1.000-rækkers-loftet fra omkring etape 4, og et grand
tour-løb kan nå op på 6.000+ rækker over en sæson.

Siden commit `de1046afa` (PR #3927, issue #3915), 18/8 — latent indtil et
holds dagens løb samlet passerede 1.000 rækker.

## Fix

Erstattede den ene ubegrænsede forespørgsel med to afgrænsede, hver med et
filter der strukturelt forhindrer at ramme loftet:

1. **Vinder-forespørgsel** (`todayStageWinner`'s input): afgrænset til MINE
   dagens race_id'er OG dagens etapenumre OG kun rank-1 stage-resultater —
   `.in("race_id", ownRaceIds).in("stage_number", todayStageNumbers)
   .eq("result_type", "stage").eq("rank", 1)`. Højst løb×etaper-i-dag rækker.
2. **Placerings-forespørgsel** (`computeStageRaceStanding`'s input): én
   forespørgsel PR eget etapeløb med `stages_completed > 0`, afgrænset til
   dette ene løb OG dets aktuelle etape —
   `.eq("race_id", race.id).eq("stage_number", race.stages_completed)
   .in("result_type", ["leader", "team"])`. `stages_completed` skrives i
   samme transaktion som resultatrækkerne (`raceRunner.js:2999-3034`); prod
   23/9 bekræftede 13/13 kørende og 185/185 afsluttede løb stemmer. Hver
   forespørgsel returnerer højst feltets størrelse (ryttere/hold pr. etape),
   uafhængigt af hvor mange etaper løbet har kørt i alt.

`computeStageRaceStanding` og `todayStageWinner` (lib/dashboardTodayStages.js)
er UÆNDREDE — kun deres input-rækker kommer nu fra to afgrænsede kilder i
stedet for én fælles, ubegrænset kilde. En ny ren hjælper,
`mergeStandingRowsByRace`, kombinerer placerings-forespørgslernes resultater
(én pr. løb) til et `Map<raceId, rows>`.

Fravalgt: at wrappe den oprindelige forespørgsel i `fetchAllRows` — det ville
hente 2.700-6.000+ rækker pr. minut pr. åbent dashboard (minut-tick-polling),
langt mere data end de to nye forespørgsler tilsammen, for data der reelt
kun bruges til to enkeltfelter (vindernavn + placering).

## Forhindret fremover

- `frontend/src/hooks/useTodayStages.test.js`: kilde-læsende tests der låser
  begge forespørgslers afgrænsende filtre fast (vinder: `rank=1` +
  stage_number-filter; placering: `stage_number = race.stages_completed` +
  `finish_time` i select) + en regressions-test der scanner ALLE
  `race_results`-forespørgsler i filen og fejler hvis nogen af dem kun er
  afgrænset af `race_id`/`result_type` uden et rank- eller
  stage_number-filter — præcis den form der forårsagede denne bug.
- `frontend/src/lib/dashboardTodayStages.test.js`: unit-test af
  `mergeStandingRowsByRace` med tre løb af 400 rækker hver (1.200 rækker
  kombineret, over 1.000-loftet) der viser at merget er sikkert, fordi
  PostgREST-loftet gælder pr. HTTP-svar, ikke det færdige JS-array.
- De forkerte "pagination-safe: ... langt under 1000"-kommentarer er
  erstattet med kommentarer der beskriver den FAKTISKE afgrænsning og de
  målte prod-tal fra 23/9, i stedet for en påstand der aldrig blev
  verificeret mod virkelige rækketal.

Stadig åbent (separat opfølgning, ikke i denne PR): `scripts/lint-
pagination-guard.mjs`'s `pagination-safe:`-escape-hatch accepterer i dag
markøren på tillid uden at kræve et faktisk afgrænsende filter i samme
statement. Den fejlagtige kommentar på den oprindelige query ville have
blokeret sig selv, hvis lintet havde krævet at et `.eq`/`.in` på en
lav-kardinalitets-kolonne (fx `rank`, `stage_number`) fandtes i samme
statement som markøren.

## Læring

En `pagination-safe:`-markering er et LØFTE, ikke et bevis — den skal ledsages
af et faktisk afgrænsende filter i den samme forespørgsel (en unik nøgle, et
lille, strukturelt begrænset resultatsæt, eller en eksplicit `.limit`), aldrig
kun af en påstand i en kommentar om at rækketallet er "langt under 1000".
Denne bug er den samme fejlklasse som `.claude/learnings/2026-05-30-pcm-
matcher-1000-row-pagination.md` og `.claude/learnings/2026-08-04-sponsor-
race-results-unpaginated-query.md` — tredje gang en ubegrænset
`race_results`-forespørgsel lyver stille om rækketal, denne gang fanget af
ejeren i prod, ikke af en spiller eller en test.
