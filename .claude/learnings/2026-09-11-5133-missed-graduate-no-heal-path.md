# Postmortem · 2026-09-11 · Akademirytter faldt ud af graduerings-flowet uden en vej tilbage (#5133)

## Hvad skete der?

Én akademirytter (Tijl Van Hecke, født 2006, sæsonalder 22 i S3) fik aldrig sin
`academy_graduation`-række ved sæson-transitionen 23/8. Han stod derfor stille
på et menneskehold som akademirytter over aldersgrænsen — manageren fik aldrig
sit valg (promovér/sælg/slip), fordi valget aldrig blev oprettet. Ownership-
vagten (invariant G) alarmerede fra 6/9, men er read-only pr. kontrakt. Første
sti der kunne have fanget ham igen var sæsonskiftet til S4 den 28/9: fem uger
hvor spilleren så en synligt fastlåst rytter og ikke kunne gøre noget.

## Root cause

**Ikke fastslået for netop denne rytter — og det skal stå ærligt.** Det
prædikat der skulle have fanget ham burde have gjort det. Hvad undersøgelsen
kunne afgøre:

- **Pagineringen er afkræftet.** `fetchAllRows` bruger offset-paginering med
  `SUPABASE_PAGE_SIZE = 1000` og stabil `.order("id")`. Med ~540 akademiryttere
  23/8 var der én side og dermed ingen sidegrænse at tabe en række over.
  Offset-paginering kan tabe rækker når noget forlader filteret mellem to sider,
  men det kræver mindst to sider. Akademi-intake-kandidater tæller ikke med
  (`academyIntake.js` indsætter dem med `is_academy: false`; flaget sættes først
  ved signing), så populationen var ikke i nærheden af 1000.
- **Aldersformlen er afkræftet som divergens.** `detectGraduates` importerer
  `ageForSeason` fra `riderProgressionEngine.js`, som siden #2905 re-eksporterer
  `riderSeasonAge.js` — nøjagtig samme SSOT som vagten bruger direkte.
- **Én reel divergens fundet (og rettet):** vagten krævede
  `team_id IS NOT NULL`, detektionen gjorde ikke, og
  `academy_graduation.team_id` er `NOT NULL` i skemaet. En strandet akademi-fri-
  agent (invariant D, #2257) ville få sin insert afvist, `detectGraduates` ville
  kaste, og hele resten af batchen mistede lydløst sit vindue — kaldstedet i
  `riderProgressionEngine.js` har ingen try/catch, så et helt sæsonskifte kunne
  vælte på det. **Den forklarer dog ikke denne rytter:** 6 af de 28 rækker fra
  23/8 har et `rider_id` der sorterer efter hans, og et kast ville have afbrudt
  alt efter ham.
- Tilbage står en læse-side-anomali 23/8 vi ikke længere kan aflæse, eller en
  tilstand på rytteren der siden er ændret. Ingen evidens for nogen af delene.

**Den egentlige fejl er strukturel og fuldt bevist:** detektionen kørte kun ét
sted (sæson-transitionen), det løbende sweep selekterede kun eksisterende
`pending`-rækker, og den eneste sti der kunne SE problemet var read-only. Et
system hvor detektion sker én gang pr. sæson har ingen margin: enhver grund til
at misse batchen bliver til ugers stilstand.

## Fix

- `backend/lib/missedGraduateSweep.js` (ny): finder akademiryttere over
  gradueringsalderen uden nogen grad-række og åbner deres override-vindue
  (pending-række + notifikation), præcis som sæson-transitionen ville. Kører som
  første skridt i det eksisterende daglige graduerings-sweep.
- `backend/lib/academyGraduation.js`: `openGraduationWindow` som fælles
  byggeklods for begge stier (samme felter, deadline og copy); unique-violation
  på `UNIQUE(rider_id, season_id)` er nu "en anden nåede det først", ikke en
  fejl; `detectGraduates` filtrerer nu `team_id IS NOT NULL` som vagten.
- `backend/scripts/detect-missed-graduates.js` (ny): `--dry-run` / `--execute`
  over præcis samme funktion, så dry-run og kørsel aldrig kan vise forskellige
  ryttere.

## Forhindret-fremover

- `backend/lib/academyGraduationPredicate.test.js`: forward-guard der kører
  detektionen og vagten mod samme population og fejler hvis de sender
  forskellige filtre til PostgREST ELLER vælger forskellige ryttere.
- `backend/lib/missedGraduateSweep.test.js`: dækker finder-opretter-idempotens,
  flag-gating, åbent vindue, åben auktion og per-rytter-fejlisolation.
- `cron.js` logger `created > 0` synligt: at backfillen overhovedet finder en
  rytter er i sig selv et signal om at sæson-detektionen svigtede.

## Læring

**En read-only vagt er ikke en løsning, den er en måling.** Invariant G så
problemet fra 6/9 og kunne ikke gøre noget ved det, og der var ingen anden sti.
Når en vagt alarmerer på en tilstand som systemet selv burde kunne rette, er den
rigtige opfølgning en helbredende sti — ikke et bedre Sentry-kort.

**Den anden læring er om rod-årsager:** helbredelse er ofte mere værd end
forklaring. Rod-årsagen til 23/8 er stadig ukendt og bliver det måske. Et sweep
der henter enhver faldt-ud-rytter ind inden for et døgn gør spørgsmålet
uinteressant for spilleren — og lader os stadig undersøge det bagefter. At vente
med at handle til rod-årsagen var fundet ville have kostet fem ugers stilstand.
