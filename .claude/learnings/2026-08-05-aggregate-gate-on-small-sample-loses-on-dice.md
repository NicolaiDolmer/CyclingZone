# Postmortem · 2026-08-05 · En hård gate på et AGGREGAT over en lille stikprøve taber på terningen (#3347)

## Hvad skete der?
Realisme-gaten (#2755/#2769) er hård for tier 3: summit-finaler ≥ 8 og M-Down ≤ 55 %.
Målt over 3.000 syntetiske sæson-varianter (samme katalog, forskellig `season_id`) fejlede
tier 3 **16,3 %** af alle genereringer — på ren tilfældighed, uden nogen kodeændring. Hele
gaten (inkl. GT-båndene i tier 1) var rød i **56,7 %** af trækkene. Sæson 3's kalender
skulle bygges under en deadline (23/8), så gaten var reelt et møntkast om at blive
blokeret — eller om at nogen slog gaten fra.

## Root cause
Ikke kalibrering. Katalog-analysen (`raceRouteRealismDrawHarness.js --catalog`) viste at
tier 3's katalog i middel leverer 9,91 summits mod et krav på 8, og 43,4 % M-Down mod et
loft på 55 % — begge bånd rammes altså **med margin i middel**. Problemet er at marginen
kun er ~0,9–1,2 standardafvigelser, fordi aggregatet bygger på en lille stikprøve: tier 3
har 11 etapeløb / ~22 bjerg-etaper, og hver etapes `finale_type` er et uafhængigt træk.
sd(summits) = 2,04 → 12 % af trækkene lander på ≤ 7.

Med andre ord: **et bånd der er rigtigt i middel kan stadig være forkert som hård
per-træk-gate, hvis N er lille.** Det er en egenskab ved stikprøven, ikke ved båndet.

## Fix
`backend/lib/raceRouteRealismDraw.js` — deterministisk re-draw pr. tier: bryder tierens
kanoniske træk et bånd, trækkes tieren om med en afledt seed
(`<løb-identitet>::<season_id>:retry:<n>`), op til 12 forsøg. `n` er den mindste attempt
der består, og dermed en ren funktion af (tierens løbssæt, season_id) → determinismen er
intakt. Består intet forsøg, returneres attempt 0 og gaten melder NO-GO som før — gaten er
**ikke** blevet advisory. Fail-rate over 3.000 varianter: 56,67 % → **0,00 %**.

Sæson-aksen (inkl. varianten) blev flyttet til ét delt modul (`raceSeedAxis.js`), fordi
pass 1 (profiler) og pass 2 (ruter) seeder i hver sin fil. Lå de på hver sin akse, ville et
re-draw kun ændre terrænet og aldrig kunne rette et GT-bånd (som måler rute-data).

## Forhindret-fremover
Alle fem stier der genererer parcours løser varianten med SAMME rene funktion:
realisme-scorecardet (gaten), `tierCalendarMaterializer` (skriver ny sæson),
`backfillRaceStageProfiles`, `backfillRouteProfiles` og `checkStageProfileSeedDivergence`.
Gik én af dem sin egen vej, ville gaten score ét parcours mens databasen fik et andet —
gaten ville være en løgn. Der er en test der beviser at materializerens indsatte rækker
er tierens resolverede træk og ikke attempt 0.

## Læring
1. **Skeln "båndet er forkert" fra "stikprøven er for lille".** Før man rører et bånd:
   mål kataloget/populationens LOFT, MIDDEL og SPREDNING. Er middel over båndet men
   marginen < ~2,3 sd, er båndet fint — det er per-træk-garantien der ikke kan holdes.
2. **En hård gate på et aggregat skal have en deterministisk vej ud af halen.** Enten
   flere forsøg (som her) eller mål-styret konstruktion. Ellers bliver gaten et møntkast,
   og møntkast under deadline bliver til "slå gaten fra".
3. **Et re-draw skal falde tilbage til det KANONISKE træk når forsøgene er brugt** — ikke
   til "bedste af N". Ellers pynter mekanismen på et ægte brud, og gaten mister sin værdi.
4. **Seed-akser der er kopieret ud i flere filer skal samles før man tilføjer en ny akse.**
   Her lå rute-seed'en og profil-seed'en i hver sin fil med hver sin kopi af nøgle-logikken;
   en variant tilføjet ét sted ville have givet et re-draw der beviseligt ikke kunne rette
   halvdelen af de bånd gaten måler.
