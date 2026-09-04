# race_stage_moments: samme PostgREST-1000-loft-klasse, denne gang på story-tags

**Dato:** 2026-09-01 · **Refs:** #4566 · Beslægtet: #2907, #2932, #3315, #3331 (samme klasse), #2355 (oprindelig feature)

## Symptom

Spillerverificeret (Discord, 1/9 aften, prod): løbssidens historie-bobler (Peak/Outsider story-tags) manglede på etape 11-13 af et 13-etapes løb, men var der på etape 1-10.

## Rodårsag

`frontend/src/pages/RaceDetailPage.jsx`s `momentsPromise` hentede `race_stage_moments` med `.select(...).eq("race_id", raceId)` — ingen `.order()`, ingen `.range()`. PostgREST capper stille ved 1.000 rækker pr. select. Løbet (spillets første 13-etapers løb) havde 1.345 momenter (~100/etape); etape 10 skar præcis 1.000-grænsen, så etape 11-13 blev tavst afskåret uden fejl. Data i DB var intakt (verificeret 87/83/86 tags på etape 11/12/13).

Samme race_id-only-shape (uden stage_number-filter) fandtes også i `backend/lib/raceNarrativeNotification.js`s `buildRaceResultNarrative` (notifikations-/e-mail-rubrik) — samme rodårsag, ikke endnu bevist ramt i prod, men strukturelt identisk. Rettet i samme PR.

## Hvorfor vagten ikke fangede det

`pagination-guard` (scripts/lint-pagination-guard.mjs) dækker allerede `frontend/src` OG `backend` — det er IKKE et frontend/backend-dækningshul. Hullet var at `race_stage_moments` manglede fra `DENY_TABLES`: tabellen var aldrig blevet mærket som "kan vokse forbi 1.000 rækker", så guarden simpelthen ikke kiggede efter upaginerede selects mod den. Tilføjet i #4566's PR.

Sekundært fund under fixet: guardens statement-grænse-heuristik slår sammen når flere uafhængige `.from()`-kald deler ét array-literal-statement (fx `Promise.all([queryA, queryB, queryC])`) — et `.maybeSingle()` på `queryA` "låner" sin bounded-status ud til `queryB`/`queryC` i samme array, selvom de er helt uafhængige queries. Det var derfor `useHeroAgonyMoment.js`s per-etape-scopede (faktisk bounded, max 117 rækker) moment-query IKKE blev flagget da `race_stage_moments` blev tilføjet til deny-listen — en falsk-negativ af den rigtige grund her, men et reelt blindt punkt for en fremtidig, genuint upagineret query i samme array-shape. Ikke rettet i denne PR (kræver en dedikeret ombygning af statement-scanningen + egne tests, for stort et greb til en hotfix) — annoteret med `pagination-safe:`-kommentarer alligevel for klarhed, og efterladt som kendt hul her.

## Omfang (prod-audit 1/9)

| Query-shape | Max rækker | Antal målt | Vurdering |
|---|---|---|---|
| `race_stage_moments` KUN `race_id` | 1.345 | 761 løb (kun dette løb >1.000) | Sårbar — fixet |
| `race_stage_moments` `race_id`+`stage_number` | 117 | 1.845 etaper | Bounded — `pagination-safe:` |
| `race_incidents` (race_id) | 37 | 596 løb | Bounded — ikke tilføjet til deny-listen |
| `rider_career_events` (race_id) | 14 | 287 løb | Bounded — ikke tilføjet til deny-listen |

## Værn

1. `race_stage_moments` tilføjet til `lint-pagination-guard.mjs`s `DENY_TABLES` — fanger nye upaginerede selects mod tabellen fremadrettet (repo-bredt, frontend + backend).
2. `momentsPromise` (RaceDetailPage.jsx) + `buildRaceResultNarrative` (raceNarrativeNotification.js) pagineret via `fetchAllRows` med stabil `.order("stage_number").order("id")`.
3. De to provably-bounded per-etape call sites (`useHeroAgonyMoment.js`, `buildStageResultNarrative`) fik `pagination-safe:`-kommentarer med målte rækketal — dokumenterer bevidst valg, ikke en overset risiko.

## Læring

1. **"Vagten dækker allerede stien" ≠ "vagten fanger denne tabel."** Et dækningshul kan være en manglende deny-list-entry, ikke en manglende filsti-scan — tjek begge før man konkluderer at guarden er strukturelt utilstrækkelig.
2. **Array-literal-statements (`Promise.all([a, b, c])`) er et blindt punkt for statement-scopede lints** der bruger "find nærmeste bounded-token i samme statement" — en guard-token på ét array-element kan fejlagtigt dække et andet. Værd at holde øje med hvis en fremtidig sweep finder flere falske negativer af denne shape.
3. Samme klasse, tredje+ forekomst (#2907, #2932, #3315, nu #4566) — mønsteret er stabilt: en tabel der vokser forbi 1.000 rækker, en `.eq()`/`.in()` uden `.range()`, ingen fejl, bare stille forkerte tal. Fortsæt med at udvide `DENY_TABLES` proaktivt når nye tabeller viser sig at vokse med løbslængde/deltagerantal, ikke kun reaktivt efter en spillerrapport.
