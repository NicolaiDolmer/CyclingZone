# Postmortem · 2026-09-03 · #4700 (CYCLINGZONE-44) — malt 0 levende par, ingen aktiv bypass fundet

> **Ret-runde (3/9, sen eftermiddag):** en uafhaengig reviewer afkraeftede den oprindelige
> version af dette dokument paa 5 punkter. Denne version retter fejlen i "Hvad skete der?",
> udfoerer det manglende backwards-check (issue-krav #4), skaerper forward-guard-afsnittet
> (issue-krav #5) og fjerner selvmodsigelsen i "Laering". Se PR #4726's "Ret-runde"-afsnit
> for fund-for-fund-svar.

## Hvad skete der?
Vagten `riderDoubleBookingWatch` (CYCLINGZONE-44) alarmerede sidst 2/9 kl. 12:49 med 48
rytter-par udtaget til to overlappende lob i S3 (25 nyligt opstaede). Issuet bad om at
finde OG rette den skrivesti der stadig kan lave overlappende udtagelser uden at ramme
game_day-guarden.

Malt read-only mod prod 3/9 ca. kl. 15:30 (Supabase MCP, samme algoritme som vagten selv:
raceBindingWindow span-overlap + #1823-afmeldt-filter + #3185-ghost-filter): **0 levende
par**. Genmalt uafhaengigt kl. 17:31 (ret-runden, samme metode): **stadig 0 levende, 0
historiske par** — to datapunkter ca. 2 timer fra hinanden, hvilket daekker mindst én
sweep-cyklus (sweepen koerer hver time). De 25 "radata"-par (uden filtrene) ved 15:30-
malingen var alle IKKE-levende: 20 fordi holdet siden er meldt fra det ene lob, 5 fordi
rytteren siden er solgt/skiftet hold (ghost).

**RETTET (ret-runde):** den oprindelige version af dette afsnit paastod at "ingen commits
rorte raceBinding.js/riderEntryGenerator.js/riderDoubleBookingWatch.js mellem 31/8 og 3/9".
Det er faktuelt forkert og blev afkraeftet af en uafhaengig reviewer. Commit `bf7380a3a`
(PR #4673, "sen-udfyldning og opt-in", merged 3/9 kl. 10:27 — SAMME dag, ca. 5 timer FOER
15:30-malingen) aendrede `backend/lib/raceEntryGenerator.js` med 142 linjer: den tilfojer en
`assistant_selection_mode`-tilstand (proactive/late_fill/opt_in) der styrer hvilke
manager-hold entry-generator-sweepen proaktivt udtager til. Jeg havde selv naevnt #4673 som
gennemgaaet skrivesti faa linjer forinden i samme afsnit, men konkluderede alligevel fejlagtigt
at "ingen kode er rort" — en selvmodsigelse reviewer fangede.

Verificeret (ret-runde, Supabase MCP mod `app_config`): `assistant_selection_mode = "proactive"`,
`updated_at = 2026-09-03 08:31:12`. Det er DEFAULT-vaerdien og docstringen i #4673's diff
siger eksplicit "Default (proactive) er bit-for-bit dagens adfaerd". Flippet er ikke slaaet
til i prod. Konklusionen aendrer sig derfor ikke — #4673 forklarer ikke 0-malingen, fordi
dens nye kodevej er bag et flag der stadig staar paa "ingen aendring" — men paastanden om at
"ingen commits rorte filerne" var ikke desto mindre forkert, og skulle have vaeret "commits
roerte filerne, men den nye kodevej var ikke aktiv i prod".

## Root cause
Gennemgik ALLE skrivestier til `race_entries` (grep + laesning): manuel udtagelse
(PUT /:raceId/selection + PUT /races/selection/bulk, ikke-brugervendt endnu), auto-fill/
regenerate (POST /races/distribution/regenerate), assistent (POST /races/:raceId/selection/auto
+ raceEntryGeneratorSweep inkl. #4673 sen-udfyldning), race-start-redning (raceRunner.js
fillMissingTeamEntries). Akademi/transfer-filerne (academyGraduation/academyTransfer/
transferExecution/stageRaceTransferDefer) SLETTER kun ghost-entries, de INDSAETTER aldrig.

Alle fire indsaettelsesstier bruger SAMME delte helper (`raceBinding.js`:
`raceBindingWindow`/`windowsOverlap`/`loadTeamBindingContext`/`isRiderDayInvariantViolation`)
PLUS en DB-niveau deferred UNIQUE-constraint (`no_rider_double_booking_day` pa
`race_entry_days`, span-baseret siden #4217) som sidste linje. Malt i prod: alle 529 S3-lob
er fuldt game_day-backfillet lige nu, sa DB-backstoppet er vandtaet for enhver ny insert.

Den DOKUMENTEREDE rod-arsag til klassen "GT-rytter frigivet pa hviledag -> straks
dobbeltbooket i et endagslob" star allerede i `database/2026-08-24-4203-...sql`s egen
kommentar: #4173 (24/8) skiftede binding fra SPAEND til KUN-de-koerte-dage, hvilket frigjorde
GT-ryttere pa hviledage og lod entry-generator-sweepen straks udtage dem til et Monument i
samme slot. Det blev rettet af #4217 (25/8, span-binding i BADE JS og DB) med dedikerede
regressionstests (`raceBinding.test.js` #4217-testene, `raceEntryGenerator.test.js`s
game_day-spaend-test). Ingen aendring af selve overlap-reglen siden.

**RETTET (ret-runde, issue-krav #2 — "find skrivestien der skabte de 25 nyligt opstaaede
par"):** dette krav er IKKE opfyldt, og den oprindelige version overtvang det. Reviewer
fandt: de 20 "afmeldt"-forklarede par har `withdrawn_at` = 2026-08-27 og 2026-09-01 (verificeret
igen i ret-runden: `race_withdrawals` for S3 har raekker med withdrawn_at 27/8, 29/8, 31/8,
1/9 og 2/9). Begge datoer ligger FOR Sentry-alarmen 2/9 kl. 12:49. Vagtens egen algoritme
(`findDoubleBookedRiders`, `riderDoubleBookingWatch.js:143`) filtrerer `withdrawnKeys` FRA
FOER den taeller par, og `withdrawnKeys` bygges af den AKTUELLE `race_withdrawals`-tabel uden
tidsafgraensning — saa disse 20 par ville ALLEREDE have vaeret filtreret fra da vagten
alarmerede 2/9 kl. 12:49. De 20 par jeg maalte 3/9 er derfor en ANDEN, aeldre stoej-pulje end
de 25 "nyligt opstaaede" Sentry rapporterede — ikke en forklaring paa dem.

Jeg kunne IKKE rekonstruere den faktiske skrivesti for de par Sentry saa 2/9 kl. 12:49:
`race_entries` har ingen aendringslog/audit-tabel (tjekket `admin_log` — kun admin-initierede
handlinger, intet om sweep/entry-generator-skrivninger), og de underliggende raekker er siden
overskrevet af normal churn (yderligere 5 afmeldinger 2/9, salg, sweep-koersler). Dette er en
reel, uloest begraensning — ikke noget denne PR laapper over. Anbefaling til fremtiden: hvis
CYCLINGZONE-44 alarmerer igen, koer `audit-4700-double-booked-riders.js` INDEN naeste
sweep-cyklus (indenfor timen), saa parrene stadig eksisterer naar de undersoeges.

## Backwards-check (issue-krav #4 — udfoert i ret-runden, IKKE i original PR)
Issue #4700 krav 4: "er nogen af parrene allerede afviklet i S3? Hvis ja: hvad skete der med
resultatet?" Dette blev slet ikke udfoert i original-PR'en. To niveauer af check, begge
read-only mod prod (Supabase MCP):

1. **Scriptets egen `historical`-bucket** (allerede implementeret i
   `audit-4700-double-booked-riders.js` via `splitLiveConflicts` — par hvor BEGGE lob har
   status "completed"): **0** ved begge maalinger (15:30 og 17:31). Ingen currently-tracked
   dobbeltbooking har naaet at afvikle begge lob.
2. **Uafhaengigt tjek mod faktiske resultater** (fordi (1) kun ser NUVAERENDE
   `race_entries`/ghost-status, ikke hvad der historisk skete): forespurgte `race_results`
   for hele S3 — findes der en rytter med resultat-raekker i TO lob hvis
   `race_stage_schedule`-vinduer overlapper i realtid? **0 raekker fundet.** Ingen rytter i
   S3 har nogensinde faaet et registreret resultat i to tidsoverlappende lob. Dette daekker
   ogsaa par der siden er ryddet vaek (ghost/afmeldt), fordi `race_results` ikke paavirkes af
   efterfoelgende hold-/rytter-aendringer.

Konklusion: ingen ptaevist spiller-synlig skade (dobbelt resultat/praemie) er fundet i S3's
faktiske resultatdata. Det udelukker ikke at Sentrys 48/25-par KUNNE have naaet at afvikle
og blive ryddet igen uden at efterlade et resultatspor (fx entry slettet foer lobsstart) —
men der er ingen positiv evidens for at det skete.

## Forward-guard (issue-krav #5 — skaerpet i ret-runden)
Original-PR'en leverede INTET forward-guard, kun et engangs-dump-script — reviewer havde
ret. Praecisering:
- **Denne PR resolver IKKE Sentry-gruppen CYCLINGZONE-44.** Issuets eget krav 5 er eksplicit:
  gruppen resolves foerst naar vagten maaler 0 — IKKE naar koden merges. To uafhaengige
  0-maalinger 2 timer fra hinanden (15:30 og 17:31) er et bedre signal end den oprindelige
  ene, men er stadig IKKE nok efter #3415-praecedens (se "Laering" nedenfor) — anbefaling:
  lad CYCLINGZONE-44 staa unresolved og lad vagten selv (som allerede koerer efter hver
  sweep, jf. #3415-fixet) bekraefte 0 over flere sweep-cyklusser i produktion, foer nogen
  lukker Sentry-gruppen manuelt.
- Det egentlige KODE-niveau forward-guard er #4159 (DB-trigger paa game_day-aksen) — **stadig
  OPEN**, ikke roert af denne PR. Denne PR erstatter ikke #4159.
- Reel mangel afsloeret af backwards-check-arbejdet ovenfor: `race_entries` har ingen
  aendringslog, saa NAESTE gang vagten alarmerer er vi i praecis samme situation (data
  churner vaek foer skrivestien kan identificeres) medmindre nogen koerer audit-scriptet
  STRAKS. Det er ikke rettet i denne PR (stoerre scope, ny tabel/migration, ejer-beslutning
  om retention) — flagget her som en aaben anbefaling, ikke en lukket sag.

## Fix
Ingen kode-rettelse i denne session — jeg kunne ikke reproducere en aktivt-bypassende
skrivesti, og ret-runden bekraeftede at det oprindelige "root cause lukket"-narrativ var for
staerkt formuleret (se ovenfor). Leveret:
- `backend/scripts/audit-4700-double-booked-riders.js` — read-only dump-script (ingen
  --apply) der genbruger de SAMME rene funktioner som vagten (`findDoubleBookedRiders`,
  `splitLiveConflicts` fra `riderDoubleBookingWatch.js`; `raceBindingWindow` fra
  `raceBinding.js`; `filterEligibleEntries` fra `riderEligibility.js`) og lister den FULDE
  parliste (rytter, hold, begge lob, game_day-vindue, is_auto_filled, created_at) —
  vagtens egen Sentry-capture er hardt begraenset til 25 par. Bucketten `historical`
  fungerer allerede som det fremtidige backwards-check (se ovenfor).
- `backend/scripts/audit-4700-double-booked-riders.test.js` — 4 regressionstests
  (overlap-rapportering, #1823-afmeldt-filter, #3185-ghost-filter, tom-saeson).

## Forhindret-fremover
Scriptet er reusable: koeres igen naar vagten naeste gang alarmerer, for at fa den FULDE
liste (ikke kun et 25-par-sample) til triage, uden at skulle skrive engangs-SQL igen — og
KOER DET STRAKS (inden naeste sweep-cyklus), ikke dagen efter, ellers forsvinder skrivestien
igen (se "Root cause"-afsnittets rettede konklusion). Fordi det genbruger de eksisterende
rene funktioner er der IKKE tilfojet en tredje kopi af overlap-logikken (som er PRAECIS den
fejlklasse #4700 selv advarer imod).

## Laering
Et Sentry-snapshot fra timer for maaling kan vaere fuldstaendig forsvundet via normal
spilaktivitet (afmeldinger, salg) UDEN at rod-arsagen er rettet i denne session — og UDEN
at det betyder rod-arsagen aldrig var reel (#4173-klassen var aegte, maalt og rettet 24-25/8).
Samme fils #3415-oscillation (0→3 par 5/8, 14→0 par 11/8, begge INDEN FOR TIMER, samme dags
sweep) er den konkrete praecedens for hvorfor et enkelt 0-oejeblikbillede IKKE er bevis for
at faerdigt er faerdigt.

**RETTET (ret-runde):** den oprindelige version af dette afsnit citerede #3415-advarslen og
konkluderede alligevel praktisk "ingen rettelse noedvendig" paa baggrund af PRAECIS ét
oejebliksbillede — en selvmodsigelse reviewer fangede korrekt. Denne version tager konsekvensen:
konklusionen er IKKE "faerdig, ingen rettelse noedvendig", men "0 malt to gange 2 timer fra
hinanden, ingen aktiv bypass fundet i kodegennemgangen, men #3415-praecedens betyder at
Sentry-gruppen skal blive unresolved indtil vagten selv bekraefter 0 over flere yderligere
sweep-cyklusser i drift — ikke fordi en session-maaling siger det, men fordi det er den eneste
maalemetode #3415 selv viste virker". Naeste skridt hvis vagten alarmerer igen: koer
`audit-4700-double-booked-riders.js` STRAKS (for churn naar at rydde op).
