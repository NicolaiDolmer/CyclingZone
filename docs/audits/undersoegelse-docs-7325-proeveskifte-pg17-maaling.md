# Undersøgelse #7325: prøveskifte S5 -> S6 på lokal PG17-kopi

Undersøgelsesspor (kind: investigate, #5220), torsdag 26/11, NICOLAIPC. Refs #7325.
Ingen skrivning, migration eller sæsonskifte mod produktion. Ingen kodeændring.
Ingen spillertal, holdnavne, id'er eller beløb i denne rapport.

## Kort svar

Generalprøven på en **repræsentativ** lokal PG17-kopi af produktion kunne ikke køres.
Der findes ingen sådan kopi på maskinen, og prøvescriptet fra PR #8692 (`b20c6d4f7`)
kan i sin nuværende form kun køre sin egen syntetiske fixture. Derfor er der ingen
fasetider, låse eller hukommelsestal at sammenligne med et normalt skifte, og kravet
"aldrig dårligere end normalt" kan ikke eftervises i dag.

**Lørdag er ikke klar ud fra generalprøve-bevis.** Det er en status for beviset, ikke
et udsagn om at selve skiftekoden er i stykker.

## Hvad jeg undersøgte

| Spørgsmål | Metode | Resultat |
|---|---|---|
| Findes PG17 lokalt? | `pg_ctl --version` på PATH og under brugerens tools | PATH peger på PG 16.15. PG 17.11 findes separat og skal angives eksplicit med `--bin`. |
| Findes en lokal kopi af prod? | Søgning efter `*.dump`, `*.backup`, `*.sql`, `*.tar`, `*.gz` > 5 MB i wave-scratch, OneDrive-context, Downloads, Documents og tools | Ingen databasekopi. De store filer er arkiverede worktrees (kode), ikke data. Ingen Docker og ingen Supabase CLI. |
| Kan scriptet køre mod en kopi? | Læst `scripts/seasonTransitionRehearsal7325.mjs` og undersøgelsesnoten fra `b20c6d4f7` | Nej. Runneren opretter sin egen klynge fra `scripts/fixtures/seasonTransition7325/schema.sql` og afviser bevidst enhver ekstern database-URL. Der er ingen restore-sti for en prod-dump. |
| Måler scriptet tid, låse og hukommelse? | Søgning efter timere og sampling i runneren | Nej. Ingen fasetimere, ingen `pg_locks`/`pg_stat_activity`-sampling, ingen hukommelsesmåling. |
| Er prøvescriptet ajour med main? | `git diff --stat 6c52c88f2 origin/main` på skiftefilerne | Nej. Siden prøvens base er tre faser kommet til i main: sæsonoprykning (#8668), aldring (#8526) og skader (#8251). 4 filer, ca. 60 linjer. Prøven kører den gamle kode. |
| Virker prøven stadig som sidst? | Commit `b20c6d4f7` eksporteret til egen scratch-mappe og kørt lokalt (se nedenfor) | Ja, uændret delresultat: alle afbrydelser rammer, men fire af fem genoptagelser stopper ved løn-fasen. |

## Bevis-kørsel (syntetisk, ikke repræsentativ)

Kørt fra en eksport af `b20c6d4f7` i sporets egen scratch-mappe, bag `verify-lock.ps1 -Max 2`:

```text
node --test scripts/seasonTransitionRehearsal7325.test.mjs
  tests 13, pass 13, fail 0, skipped 0

node scripts/seasonTransitionRehearsal7325.mjs --bin=<PG17.11 bin> --scratch=<ny mappe> --port=57326
  exit 0 (kun fordi de bevidst delvise assertions består), 124 s væg-tid for alle fem scenarier
  activation  interrupted 86, resumed 2
  previous    interrupted 86, resumed 2
  global      interrupted 86, resumed 2
  contract    interrupted 86, resumed 2
  carry       interrupted 86, resumed 0
  stop: pg_ctl status 3, egen postmaster ikke i live, 0 PG17-processer tilbage
```

Genoptagelserne med exit 2 stopper i lønberegningen, fordi den syntetiske fixture mangler
`rider_derived_abilities` (SQLSTATE 42P01). Notifikationer fejler også, fordi `notifications`
mangler i fixturen. De 124 sekunder er Node-procesopstart, dump/restore af en lille syntetisk
database og fem scenarier. De siger intet om, hvor længe et rigtigt skifte tager.

## Faser, tider og låse

| Fase (rækkefølge i `seasonTransition.js`) | Nået i prøven? | Tid | Låse |
|---|---|---|---|
| Afsluttende træningsopgørelse | Ja (syntetisk færdig-række) | ikke målt | ikke målt |
| insert_next_season | Ja | ikke målt | ikke målt |
| mark_previous_completed | Ja | ikke målt | ikke målt |
| global_rank_decay | Ja | ikke målt | ikke målt |
| Transfervindue, board-reset | Ja | ikke målt | ikke målt |
| Sponsor-mål, fornyelse, udbetaling | Ja | ikke målt | ikke målt |
| AI-kontraktfornyelse, kontraktudløb | Ja | ikke målt | ikke målt |
| Løn, faldskærm, udvikling | **Stopper her** | - | - |
| Sæsonoprykning, aldring, skader (nye i main) | Ikke i prøvens kode | - | - |
| Pensionering, trupminimum, træthed/form-reset, akademi | Nej | - | - |
| Kalender, startlister | Nej | - | - |
| Carry-over af træningsplaner | Kun isoleret funktionskald | - | - |
| admin_log og completed-anker | Nej | - | - |

Hukommelse: ikke målt. Normalt skifte som sammenligning: ikke hentet, fordi der ikke var
noget at sammenligne med.

Kendt strukturelt (fra koden og prøven 10/11): skiftet er ikke én transaktion. Hver fase
committer for sig, så låse holdes kort pr. sætning, men en afbrydelse efterlader en delvis
tilstand, som næste kørsel skal kunne genoptage.

## Top-3 risici for lørdag

1. **Genoptagelse efter afbrydelse kører rang-nedskrivningen igen.** Prøven 10/11 og i dag
   viser, at `global_rank_decay` ændrer den gemte tilstand på ny ved hver genoptagelse.
   Fasen har ingen claim pr. skifte. Et skifte, der fejler efter denne fase og køres igen,
   giver altså en anden rangliste end et skifte, der lykkes første gang.
2. **Vinduet mellem aktivering og afslutning af den gamle sæson.** Efter `insert_next_season`
   og før `mark_previous_completed` er der to aktive sæsoner. Træningslæseren i
   `routes/api.js` bruger `maybeSingle` uden sortering og fejler med PGRST116 i det vindue.
   Ved genoptagelse uden eksplicit `fromSeasonId` vælger `resolveTransitionSourceSeason`
   den nye sæson som kilde.
3. **Ingen af faserne efter lønnen er prøvet mod en database.** Udvikling, de tre nye faser
   (oprykning, aldring, skader), pensionering, akademi, kalender, startlister og carry-over
   med den endelige trup er aldrig nået i en generalprøve. Deres tid, låse og
   genoptagelsesadfærd på produktionens datamængde er ukendt.

## Hvad der præcist mangler

1. **En lokal PG17-kopi af produktion.** Kræver en read-only `pg_dump` fra produktionens
   database. Det kræver forbindelsesoplysninger (ejer-styret hemmelighed) og et privat
   lagersted uden for repoet, fordi kopien indeholder spillerdata. Ingen af delene er til
   stede på maskinen, og sporet har hverken lov til eller behov for at hente dem selv.
2. **En restore-tilstand i runneren**, så den kan gendanne en given dump i sin egen,
   identitetsbeskyttede klynge i stedet for den syntetiske fixture.
3. **Måling** af tid pr. fase, låse og hukommelse.
4. **En baseline for et normalt skifte**: tidsstemplerne fra `admin_log`-ankrene
   (`started`/`completed` pr. fase) fra det seneste skifte, hentet read-only.
5. **Prøvens kode skal ajourføres med main**, så de tre nye faser er med.

## Fix-plan

| Trin | Hvad | Filer | Risiko |
|---|---|---|---|
| 1 | Ejeren beslutter, om der må tages en read-only `pg_dump` af produktionen til en privat lokal sti (OneDrive-context, aldrig repoet). Tages med PG17-klient uden for spidsbelastning. | ingen | Spillerdata lokalt. Let læsebelastning på prod. Ejer-gated. |
| 2 | Rebase PR #8692 på main, så oprykning, aldring og skader er med. | `scripts/seasonTransitionRehearsal7325.mjs`, `.test.mjs` | Lav. Kun testværktøj. |
| 3 | Tilføj `--restore=<sti til dump>`: gendan i egen klynge med de eksisterende identitetsvagter, fast `transitionAt` og eksplicit `fromSeasonId` = S5. Ingen ekstern URL. | samme + `scripts/fixtures/seasonTransition7325/README.md` | Lav. Netværksvagten bevares. |
| 4 | Instrumentering: timer omkring hver fase via faseloggen, en separat psql-forbindelse der sampler `pg_locks` og `pg_stat_activity` hvert 250 ms, Node-RSS og postgres-processens working set. Kun tal i privat scratch, kun varigheder og antal i rapporten. | samme | Lav. |
| 5 | Udvid SQL-transporten med de forespørgsler, som en fuld kopi når (bl.a. embedded select på `rider_derived_abilities`). Med et rigtigt skema forsvinder fixture-hullerne, men transportens understøttede forespørgselsformer skal stadig dække dem. | `scripts/seasonTransitionRehearsal7325.mjs` | Mellem. Det er det tidskrævende trin. |
| 6 | Hent baseline read-only fra `admin_log`-ankrene for S4 -> S5 og sammenlign fase for fase. Kør derefter prøven igen med afbrydelse efter rang-fasen og aktiveringen. | ingen kodeændring | Lav. |
| 7 | Uafhængigt af prøven: giv `global_rank_decay` et claim pr. skifte, så genoptagelse ikke kører den igen (risiko 1). Indtil da gælder som driftsregel, at et fejlet skifte ikke genoptages uden ejerens go. | `backend/lib/seasonTransition.js` + test | Mellem. Rører motoren, ejer-go og Fable-dommer før merge. |

Trin 1 er ejerens beslutning. Trin 2 til 6 er testværktøj og kan bygges uden spillervendt
ændring. Trin 7 er en rigtig rettelse og hører til et eget issue.

## Dom

bekraeftet + fix-plan
