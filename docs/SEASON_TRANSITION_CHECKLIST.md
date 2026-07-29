# Sæsonskifte-drejebog (S1 → S2, 26.–27. juli 2026)

> **⚠️ EJER-BESLUTNING 23/7 + BYG-BESLUTNING 25/7: pyramide-komprimering, [#2851](https://github.com/NicolaiDolmer/CyclingZone/issues/2851) — BYGGET 25/7, fallback-vejen forladt (ejerens kald).** Global rank (kun managerhold) fylder D2 (48) + D3 (96) i DETTE skifte; motorens op/nedrykning springes over (app_config-gate `season_end_skip_division_movement`, fail-safe off = motorens adfærd) og genoptages S2→S3. Skridt 2/3/3b nedenfor er omskrevet til komprimerings-flowet. **Ejer-gates før kørsel søndag:** økonomi-sim set + navngiven liste godkendt (begge printes af `compressPyramid.js` dry-run). Alt andet — spærren, window-wrap, auktions-politik, transition, entries — gælder uændret.

> **Omskrevet fra bunden 23/7 (S8 cutover-generalprøve, #2361).** Den gamle checkliste var bygget om deadline-day-cyklussen (transfervindue med `closes_at`, auto-close, squad-enforcement-kæde) — den verden findes ikke længere: markedet er altid åbent (#1996), auto-transition er slået fra (`SEASON_AUTO_TRANSITION_ENABLED=false`), og den nævnte aldrig **"Afslut sæson"** (`processSeasonEnd`), som er det skridt der afgør op/nedrykning. Denne version er verificeret mod koden og prod-data 23/7 og dækker S1→S2 konkret; generalisér først efter cutoveren har bevist den.
>
> **Historisk kontekst der stadig gælder:** cron-loop-incidenten 2026-05-21 (flere transitions samme dag) — safety-nets fra dengang består: daglig season-count-vagt, admin_log pr. transition, Discord-broadcast pr. transition, DB-CHECK på racing-windows. Postmortem: `.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md`.

---

## Nøglefakta (⏱-rækkerne genmålt i prod **søndag 26/7 kl. 09:50** — genmål igen efter sidste løb)

| Hvad | Værdi |
|---|---|
| Sidste S1-etape | **26/7 17:00 UTC** (19:00 dansk) |
| Første S2-etape | **27/7 16:00 UTC** (18:00 dansk) — dag 1 retimet til mandag AFTEN 18:00-20:40 (ejer-valg 26/7, post-verificeret i prod); vinduet er ~21 timer |
| S1-løb ikke afviklet ⏱ | **30 løb / 49 etaper** (26/7 09:50; første udestående etape 09:00 UTC, sidste 17:00 UTC) — skal være **0** før "Afslut sæson"; #2805-spærren håndhæver det |
| S2-kalender | 455 løb / 1.148 etaper, allerede materialiseret, sidste løbsdag 23/8 |
| S2 i `seasons`-tabellen | **Findes allerede** som `status='upcoming'` → transitionen *promoverer* i stedet for at oprette (`already_transitioned: JA ⚠️` i preview er FORVENTET, ikke en fejl) |
| S1-transfervindue | 1 række: `status='closed'`, `closed_at=NULL`, whistle/squad_enf `NULL` (racing-window) → **readiness-gatens 3 window-checks kan ikke blive grønne af sig selv** (deadline-cyklussen er afskaffet) — se skridt 5a |
| Kontraktudløb ⏱ | **206** ejede ryttere med `contract_end_season<=1`, heraf **11 på menneskehold** (26/7 09:50) — frigives i transitionens fase `contract_expiry_release` |
| Pension ⏱ | **84** menneskehold-ryttere i 36-39-vinduet + **11** garanteret (40+) ved `ageForSeason(bd, 2)` (26/7 09:50) — afgøres i `rider_progression` under transitionen; `retirement_release` rydder team_id bagefter |
| Payroll | **Første sæson-payroll nogensinde** — ~2,62 mio. CZ$ på menneskehold i ét hug (fase `season_payroll` i transitionen) |
| Sponsor ⏱ | **54,59M garanteret FØR komprimering** (`simulateSeasonTransitionDryRun.js`, 156 hold, målt 26/7 09:50) → **55,73M EFTER** (`compressPyramid.js`' økonomi-sim, samme kørsel, Δ +1,14M). Kontrakt-kilder: **0 låst · 76 managervalg · 80 auto-default 'safe'**. Signing-bonusser 0,03M. Oveni en variabel pulje på **9,41M** der optjenes **pr. etape hen over hele S2**, ikke ved skiftet. Kun de 80 kontraktfri hold følger den nye divisions renown — låste + valgte har frossen base, så flytningen rører dem ikke. **De gamle 66,03M (dry-run 23/7) var forkerte**: previewet modellerede en kontraktfri tilstand, mens udbetalingen sker EFTER kontrakt-fornyelsen ([#2926](https://github.com/NicolaiDolmer/CyclingZone/issues/2926) — rettet). **#2852 fikset:** test-konti tælles ikke længere med. **Viser preview'et 159 eller 161 hold i stedet for 156, er #2852-fixet ikke deployet — STOP** |
| Trætheds-nulstilling ⏱ | **[#2910](https://github.com/NicolaiDolmer/CyclingZone/issues/2910) er TÆNDT:** `season_fatigue_reset_enabled='on'`, mode **`full`** (ejer-valg 26/7 — alle starter S2 lige). Fasen `season_fatigue_reset` rører **6.191 rækker** i `rider_condition` og sætter gennemsnittet fra **84,7 → 0** (målt 26/7 09:50). Idempotent (f → 0), rører kun `fatigue`, ikke form. Søsterhooken `season_academy_intake_enabled` er **'off'** (ejer-valg), så `season_academy_intake` logger INGEN fase |
| Træningsplaner ⏱ | **2.025** S1-planer på 94 hold (26/7 09:50, vokser mens managere planlægger). **#2916 fikset:** transitionens fase `manager_setup_carry_over` kopierer dem til S2 for ryttere der stadig er på holdet. **Forvent ~1.700-1.755 kopierede planer, ikke et præcist tal:** preview-tallet måles mod den NUVÆRENDE trup (1.755 målt 26/7 09:50), men fasen kører SIDST — efter `contract_expiry_release` + `rider_progression` + `retirement_release` har taget ryttere ud af truppen. En afvigelse inden for intervallet er normal og må ikke udløse stop. Uden fasen ville alle 94 hold vågne op til auto-programmer mandag. Er `carryOverPreview.surfaces.training_plans.eligible` **0** i preview'et, så STOP |
| Flags | `stage_scheduler=on`, `race_engine_v2=on`, `auto_prize=on`, `auto_entry_generator=on`, `season_fatigue_reset=on`, `season_academy_intake=off`, `auto_calendar` **OFF** (mangler i app_config) → transitionen genererer IKKE selv kalender/entries (verificeret i `app_config` 26/7 09:50) |
| Auktioner ⏱ | ~24t varighed → der KAN være aktive auktioner søndag aften (**22 aktive 26/7 09:50, heraf 0 på ryttere der er 36+ ved S2**). Se skridt 5b |
| Manuelle S2-entries ⏱ | 46 rækker på 3 hold (uændret 26/7 09:50; RMF Pro Athletic, Bacon Fræsers m.fl. — egne udtagelser). Generatoren rører dem aldrig. `manager_setup_carry_over` TÆLLER nu dem der ligger i forkert pulje efter op/nedrykning (`race_entries.wrong_pool` i transition-loggen) — den sletter aldrig noget, så oprydningen er stadig manuel (skridt 6) |
| S2-peak-planer ⏱ | **80 planer på 14 hold** (26/7 09:50). Samme fase rapporterer `rider_peak_plans.wrong_pool` + `missing_target` efter flytningen. Rør dem ikke uden ejer-go — det er de mest engagerede managere |

**Hvorfor rækkefølgen er som den er:** entry-generatoren matcher hold↔løb på `league_division_id`. Komprimeringen (#2851, skridt 3b) flytter ~100+ hold til nye puljer, og transitionens frigivelses-/pensionsfaser fjerner frigivne rytteres fremtidige entries igen (`clearFutureRaceEntriesSafe`). Derfor: **afvikl alt → Afslut sæson (movement-skip) → komprimering (flytningen) → transition (frigivelser+pension+penge) → generér entries til sidst** — så genereres felterne én gang, mod den endelige tilstand. (#2742's oprindelige forslag om at pre-generere entries FØR skiftet er forkert af begge grunde.)

**Ingen automatik tager over:** alle sæson-jobs (stage-scheduler, prize-sweep, entry-sweep) kører kun mod en sæson med `status='active'`. Mellem "Afslut sæson" og transitionen findes ingen aktiv sæson → hold det mellemrum KORT (minutter, ikke timer), og verificér at alt sæson-afhængigt (især præmier) er færdigt FØR "Afslut sæson".

---

## Tidslinje og skridt

Alle tider UTC (dansk tid = UTC+2). Operatør = ejer + Claude-session i fællesskab; hvert skridt angiver **hvem der klikker**. Kommandoer med `railway run` køres fra `backend/`-mappen.

### Skridt 0 — Preflight (lørdag 25/7 eller søndag 26/7 formiddag)

**Hvem:** Claude forbereder, ejeren klikker backup.

1. **Backup:** Ejer verificerer i Supabase-dashboardet at seneste daglige backup/PITR er frisk (Settings → Database → Backups). Dette er det eneste ægte sikkerhedsnet under skridt 3-5.
2. **Varsel sendt:** `#2700`-varslet (`notifySeasonTransitionRisk.js --live`) skal være kørt FØR skiftet (separat ejer-gate, se NOW.md Next action).
3. **#2805-spærren er live:** kald `GET /api/admin/season-transition/preview` eller klik "⏹ Afslut" og forvent **400 "…løb er ikke afviklet endnu…"** så længe der er S1-løb tilbage. Spærren SKAL være rød nu og grøn efter sidste løb — det er generalprøven af den.
4. **Rollback-snapshot af divisions-tilstand** (Claude, read-only — gemmes som fil):
   ```sql
   select id, name, division, league_division_id, balance from teams order by id;
   ```
5. **Genmål ⏱-rækkerne** i nøglefakta-tabellen (løb, udløb, pension, sponsor, træthed, træningsplaner, auktioner, manuelle entries, peak-planer).

**Rollback herfra:** alt kan afbrydes uden spor.

### Skridt 1 — Sidste etape + finalisering (søndag 17:00–17:30)

**Hvem:** ingen — motoren kører selv. Claude overvåger.

Sidste etape fyrer 17:00; stage-scheduler afvikler, auto-prize betaler (5-min-sweep). Verificér derefter:

```sql
-- ALLE tre skal give 0 før skridt 3:
select count(*) from races r where r.season_id='00000000-0000-0000-0000-000000000001' and r.status != 'completed';
select count(*) from pending_race_results p join races r on r.id=p.race_id where r.season_id='00000000-0000-0000-0000-000000000001' and p.status='pending';
select count(*) from races r where r.season_id='00000000-0000-0000-0000-000000000001' and r.status='completed' and r.prize_paid_at is null;
```

**Præmie-rækken er kritisk:** prize-sweepen kører KUN mod den aktive sæson. Ubetalte S1-præmier efter "Afslut sæson" strander for evigt (ingen cron samler dem op). Hvis > 0 og sweepen ikke selv når det inden for ~15 min → kør `paySeasonPrizesToDate` manuelt (admin) FØR skridt 3.

#### 1b — Rangliste-matviewet skal have set den sidste løbsdag (#2863)

**Hvorfor det står her:** `processSeasonEnd` / `seasonTransition.js` refresher **ikke** `rider_rankings_mv` (verificeret 26/7: `refreshRankingMatviewsSafe` kaldes kun fra `raceRunner.js`' finalization og fra en 10-minutters cron i `cron.js`). Matviewet er kilden til både rytter-ranglisten og **"Sæsonens bedste ryttere"** på `/seasons`. Refreshen er desuden best-effort: `refreshRankingMatviewsSafe` sluger og logger sine fejl. Fejler finalization-hooken, og er cron'en nede, sætter siden en forkert rytter øverst på forældede tal uden at signalere noget.

```sql
-- 1) Heartbeat: hvornår blev matview-gruppen sidst refreshet?
select matview_group, refreshed_at, now() - refreshed_at as age
from matview_refresh_heartbeat where matview_group = 'ranking';
-- Forventet: age < 10 min, og refreshed_at EFTER sidste etapes finalisering.

-- 2) Afstemning: matviewet skal matche de rå resultater for S1.
select
  (select sum(points) from rider_rankings_mv
    where season_id='00000000-0000-0000-0000-000000000001') as mv_points,
  (select sum(rr.points_earned) from race_results rr
     join races r on r.id = rr.race_id
    where r.season_id='00000000-0000-0000-0000-000000000001'
      and rr.rider_id is not null) as raw_points;
-- Forventet: de to tal er ENS (618.243 pr. 26/7, 27 af 28 løbsdage).
```

Er de to tal ikke ens, eller er heartbeaten ældre end sidste finalisering: kør `select public.refresh_ranking_matviews();` og gentag afstemningen. Bemærk at det er en `REFRESH MATERIALIZED VIEW` **uden** `CONCURRENTLY` — den tager ACCESS EXCLUSIVE-lås, så læsere af ranglisten og `/seasons` venter mens den kører (målt op til 7,8 s, se **#3013**). Kør den derfor helst før managerne vender tilbage, ikke midt i myldretiden mandag morgen.

**Rollback herfra:** stadig intet at rulle tilbage.

### Skridt 2 — ENDELIG komprimerings-liste + økonomi-sim + ejer-godkendelse (søndag ~17:30)

**Hvem:** Claude genererer, **ejeren godkender navnene** (hård gate — ejer-beslutning 25/7: komprimeringen køres ikke uden at ejeren har set den ENDELIGE navngivne 48/96/rest-liste OG økonomi-simuleringen).

> ### 🚨 LISTEN SKAL REGENERERES EFTER SIDSTE LØB (efter 17:00 UTC)
> **Cutline 144 har en margin på 2 point** (African Cycling Project 54p vs Kelme Cycling Team 52p, målt 26/7 09:50), og **30 S1-løb mangler stadig at blive kørt**. En liste beregnet før sidste løbsdag er afviklet KAN være forkert — ét resultat vender nedrykningen. Godkend derfor kun en liste der er genereret EFTER at skridt 1's tre tællinger alle giver 0. (Cutline 48 er til gengæld sikker: margin 121 point.)

Standings ændrer sig med hvert løb frem til 17:00 — foreløbige lister er snapshots, ikke facit. Generér den endelige med (read-only dry-run — printer navngiven liste med rank/point/fra→til, cutline-marginer, økonomi-sim og pulje-fyld):

```bash
railway run --service CyclingZone -- node scripts/compressPyramid.js
```

Fordelingen er `pyramidCompression.js` (unit-testet, deterministisk tiebreak: point → GC-sejre → etapesejre → navn → id): rank 1-48 → D2 (2 puljer, snake), 49-144 → D3 (4 puljer, snake), 145+ → D4 pulje A/B. Kun managerhold (fuld diskriminator); D1 røres ikke; AI-fyld reconciles bagefter.

**Ejeren skal se og godkende:** (a) navnene, især D4→D2-springene og de 5 D3→D4-nedrykninger, (b) økonomi-sim-blokken (divisions-upkeep **3,84M → 10,56M**, Δ +6,72M, når 48 hold betaler D2-sats — balancebeslutning i sig selv; netto liga-økonomi Δ −5,58M), (c) at ingen pulje viser ⚠️ over 24. Tal målt 26/7 09:50 på den foreløbige liste — genmål efter sidste løb.

**⚠️ Rækkefølge på sponsortallet ([#2926](https://github.com/NicolaiDolmer/CyclingZone/issues/2926)):** `compressPyramid.js`' økonomi-sim er kontrakt-bevidst og regner allerede på divisionerne EFTER flytningen — den blok er gyldig her. Men **transitionens** sponsor-dry-run (`simulateSeasonTransitionDryRun.js`) læser `teams.division` live og skal derfor køres **EFTER** komprimeringen, i skridt 3b. Kører du den FØR, får de 80 hold uden eget sponsorvalg beregnet deres auto-default på den GAMLE divisions renown, og totalen bliver forkert (målt 26/7 09:50: **54,59M før flytning mod 55,73M efter**). De 76 hold der selv har valgt har frossen base — flytningen ændrer dem ikke.

**Tallet at sammenligne med i skridt 3b:** "Sponsor GARANTERET total" **≈ 55,7M** (økonomi-simens "efter"-tal fra netop denne kørsel er facit — brug det, ikke tallet her, hvis listen har flyttet sig), med kontrakt-kilder **0 låst / 76 managervalg / 80 auto-default**. Afviger det mere end et par procent fra økonomi-simens "efter"-tal, så stop og undersøg FØR skridt 4.

**Hvorfor det udbetalte ikke rammer previewet præcist:** `sponsor_base_total` er FØR board-modifier (×0,8–1,2 pr. hold, capped på base ×1,2), så det faktisk bogførte beløb afviger nogle procent. Det er forventet, ikke en fejl.

**Rollback herfra:** intet kørt endnu — ejeren kan stadig aflyse alt (så gælder motorens regler: fjern flaget i skridt 3 og kør drejebogens gamle flow).

### Skridt 3 — "Afslut sæson" MED movement-skip (søndag ~17:45, EFTER ejer-ja)

**Hvem:** Claude sætter flaget (efter aftale), ejeren klikker **⏹ Afslut** på `/admin/season` (eller Claude via `POST /api/admin/seasons/00000000-0000-0000-0000-000000000001/end` med ejerens go).

**3-0 · Sæt motor-gaten FØRST (#2851):**

```sql
insert into app_config (key, value, description)
values ('season_end_skip_division_movement', '"on"'::jsonb, '#2851: spring op/nedrykning+AI-reconcile over i S1→S2 (komprimeringen flytter i stedet)')
on conflict (key) do update set value = '"on"'::jsonb;
```

Hvad der så sker, i rækkefølge (`routes/api.js` → `economyEngine.processSeasonEnd`): standings genberegnes → board-evaluering pr. menneskehold (satisfaction/konsekvenser) → divisionsbonusser udbetales → **op/nedrykning + AI-reconcile SPRINGES OVER** (server-loggen skal vise `⏭ Op/nedrykning + AI-reconcile sprunget over (season_end_skip_division_movement=on, #2851 …)`) → `seasons.status='completed'` → sekventiel board-forhandling for S2 åbnes → season_ended-notifikationer (~150 managere, in-app) + Discord-broadcast.

**#2924 · season_ended-beskeden er personlig fra 25/7.** Hver manager får sin egen slutplacering, sine point, sin præmiesum og sin bedste rytter. Divisions-sætningen ("du starter sæson 2 i Division X") **udelades automatisk i DETTE skifte**, fordi `season_end_skip_division_movement='on'` betyder at flytningen først sker i skridt 3b — beskeden lover kun noget den kan se er sandt. Fejler personaliseringen for et hold (eller helt), sendes den gamle generiske tekst; udsendelsen kan ikke vælte af det.

Verificér:

```sql
select status, end_date from seasons where number=1;                          -- completed + dato
select count(*) from notifications where type='season_ended';                 -- ~150
-- #2924: stikprøve — beskeden skal indeholde modtagerens egne tal, ikke samme tekst til alle:
select count(distinct message) from notifications where type='season_ended';  -- >1 (var 1 før 25/7)
select division, count(*) filter (where not is_ai) as real_teams from teams group by division order by 1;
-- SKAL være UÆNDRET fra skridt 0-snapshottet — flytter noget sig her, var flaget ikke på. STOP i så fald.
```

**Rollback herfra (grænsen skærpes):**
- **Kan rulles tilbage:** `seasons.status` (ét UPDATE tilbage til `'active'` genopliver stage-scheduler/sweeps). Gør det KUN hvis transitionen endnu ikke er kørt. Divisionerne er urørte i dette skridt (gaten), så divisions-rollback hører til skridt 3b.
- **Kan IKKE rulles pænt tilbage:** divisionsbonusser (penge er bogført — reversering = manuelle modposteringer, ejer-gated), board-konsekvenser, og alle notifikationer/Discord-beskeder er SET af spillere. En fortrudt season-end er altså synlig udadtil uanset.
- Fejler `processSeasonEnd` halvvejs: **STOP — ingen blind re-run.** Board/bonus-siden har `repairSeasonEndFinanceAndBoard()` som dedikeret reparationsvej. Diagnosticér først.

### Skridt 3b — Pyramide-komprimeringen (#2851) (søndag ~17:55)

**Hvem:** Claude kører, med ejerens skridt 2-godkendelse i hånden.

```bash
# Sidste kontrol-print (read-only — listen skal matche den ejeren godkendte i skridt 2):
railway run --service CyclingZone -- node scripts/compressPyramid.js
# Derefter selve kørslen:
railway run --service CyclingZone -- node scripts/compressPyramid.js --execute
```

Scriptet gør, i rækkefølge: **snapshot + restore-SQL skrives FØR første write** (`backend/scripts/snapshots/compress-pyramid-*-restore.sql` — auditen 25/7: standings-genberegning læser division fra `teams`, så rollback SKAL være snapshot-baseret, aldrig "kør igen") → `teams.division`/`league_division_id`-UPDATEs → NETTO-notifikationer (kun tier-ændringer; genbruger `notif.divisionPromoted`/`notif.divisionRelegated`) → `reconcileAiTeamsForPool` for alle puljer → verifikation (placeringer + pulje-fyld; exit 1 ved mismatch).

Verificér (ud over scriptets egen verifikation):

```sql
select division, count(*) filter (where not is_ai) as real_teams from teams group by division order by 1;
-- forventet: D1 = 0 ægte · D2 = 48 · D3 = 96 · D4 = 12 (6+6, dry-run 26/7 09:50). Sum = 156 managerhold.
select ld.label, count(*) from teams t join league_divisions ld on ld.id=t.league_division_id group by 1 order by 1;
-- alle puljer med ægte hold = 24 (efter AI-reconcile); D4-puljer uden ægte hold forbliver dormant.
```

**Sponsor-kontrol — først NU (#2926):** `teams.division` er den S2-sandhed previewet skal regne på, så kør sponsor-dry-runnet her og ikke før:

```bash
railway run --service CyclingZone -- node scripts/simulateSeasonTransitionDryRun.js   # read-only
# Forvent (26/7 09:50): "Hold påvirket" = 156 · "Sponsor GARANTERET total" ≈ 55,7M
#   · kontrakt-kilder 0 låst / 76 valgt / 80 auto-default · signing-bonusser ~0,03M.
# Den variable pulje (~9,4M) optjenes pr. etape hen over S2 — den udbetales IKKE ved skiftet.
```

**⚠️ Ignorér linjen `1. Nedrykning: sæson 2 >= gate 1 → ⚠️ OP/NEDRYKNING VIL SKE`.** Det er en falsk alarm i DETTE skifte: dry-runnets invariant-check er en ren sæsonnummer-sammenligning (`toNum >= FIRST_PROMOTION_RELEGATION_SEASON`) og læser ikke `season_end_skip_division_movement`. Divisionsflytningen bor i `processSeasonEnd` → `processDivisionEnd`, som er gatet i skridt 3 — transitionen flytter ingen hold. Stop ikke på den.

**Efter transitionen (skridt 5) — sluk gaten igen** (S2→S3 kører motorens regler, #2164):

```sql
update app_config set value = '"off"'::jsonb where key = 'season_end_skip_division_movement';
```

**Rollback herfra:** scriptets restore-SQL genskriver præcis før-tilstanden (division + pulje for ALLE hold). Notifikationer er set af spillere og består. Kør IKKE restore efter transitionen er gennemført (sponsor/upkeep er så allerede betalt mod de nye divisioner — fremadrettet reparation i stedet).

### Skridt 4 — Window-wrap (søndag ~18:00) — *forudsat ejer-ja fra generalprøven*

**Hvem:** Claude (én UPDATE, efter aftale).

Readiness-gaten for transitionen kræver `closed_at` + `final_whistle_sent_at` + `squad_enforcement_completed_at` på S1-vinduet — felter kun den afskaffede deadline-day-cyklus satte. I stedet for `force=true` (som bypasser ALLE checks, også de vigtige) normaliseres vinduet målrettet, så gaten kan være ÆGTE grøn på de checks der stadig betyder noget:

```sql
update transfer_windows
set closed_at = now(), final_whistle_sent_at = now(), squad_enforcement_completed_at = now()
where season_id = '00000000-0000-0000-0000-000000000001' and closed_at is null;
```

Sikkert fordi: markedet styres ikke længere af transfer_windows (#1996), deadline-crons skipper netop wrapped windows, og auto-transition-cron'en er slået fra i koden (`SEASON_AUTO_TRANSITION_ENABLED=false`) — der er ingen cron der kan "se" det wrappede vindue og fyre.

Kør derefter `GET /api/admin/season-transition/preview` — forventet: **alle checks grønne**, evt. undtagen `no_active_auctions` (skridt 5b).

### Skridt 5 — Transitionen (søndag ~18:15)

**Hvem:** ejeren klikker **"Udfør sæsonskifte"** på `/admin/season` (Sæson-cyklus-sektionen), eller Claude via `POST /api/admin/season-transition` med ejerens go.

**5a. Forventet fase-log** (den faktiske rækkefølge i `transitionToNextSeason`, verificeret mod koden 26/7 — abort-vurdér mod DENNE liste):

1. `insert_next_season` — promoverer S2 upcoming→active
2. `mark_previous_completed` — no-op, allerede sat i skridt 3
3. `global_rank_decay` — **hård stop-fase, se 5c**
4. `close_prev_transfer_window`
5. `insert_next_transfer_window` — S2-racing-window, `closed_at=NULL`
6. *(`reset_board_test_data` — **betinget**, logges KUN hvis S1-vinduet havde `board_test_mode=true`. Det har det ikke (verificeret 26/7 09:50), så fasen forventes at MANGLE. Dukker den op med en `error`, er det #2897-læsefejlen, ikke en reset)*
7. `sponsor_season_objectives` — sæsonmåls-bonusser for den netop afsluttede S1 ([#2948](https://github.com/NicolaiDolmer/CyclingZone/issues/2948)); SKAL køre før kontrakt-fornyelsen, udbetaler rigtige penge
8. `sponsor_contracts_renewal` — **76** pending→active + **80** auto-default 'safe' (26/7 09:50; dagsrater genberegnes mod holdets faktiske etapetal, #2589/#2913)
9. `contract_expiry_release` — **206 frigivelser**, heraf 11 på menneskehold
10. `sponsor_payout` — 156 hold · **≈55,7M garanteret** (se Nøglefakta + #2926)
11. `season_payroll` — **første nogensinde, ~2,62M**. Kan sende `board_critical`-beskeder, se 5d
12. `season_parachute` — forventet 0 (kun D1/D2-nedrykkere er berettigede, og de er AI)
13. `rider_progression` — **udvikling + pension, første gang**
14. `retirement_release` — team_id ryddes for netop-pensionerede
15. `season_fatigue_reset` — **[#2910](https://github.com/NicolaiDolmer/CyclingZone/issues/2910), flaget er ON**: `riders: 6191 · changed: ~6191 · avgBefore ~84,7 · avgAfter 0` (mode `full`)
16. *(`season_academy_intake` — flaget er OFF, så fasen logges IKKE. Dukker den op, er flaget blevet tændt: STOP)*
17. *(`season_calendar` + `season_entry_generator` — betinget bag `auto_calendar_enabled`, som er OFF. Forventes at MANGLE; entries genereres manuelt i skridt 6)*
18. `manager_setup_carry_over` — **[#2916](https://github.com/NicolaiDolmer/CyclingZone/issues/2916)**, forvent **~1.700-1.755** kopierede træningsplaner (se Nøglefakta: intervallet er normalt, ikke et afvigelses-signal)
19. `admin_log`
20. Discord `season_started`
21. `season_started_notifications` — ~150
22. `contract_expiring_notifications` — varsler S2-udløb

**5b. Hvis `no_active_auctions` er rød** (auktioner løber ~24t, så søndags-auktioner kan være i luften): mål overlap mod risiko-mængden. **#2918-rettelse 25/7:** den gamle query målte `contract_end_season <= 1 or is_retired`, som begge er strukturelt 0 FØR transitionen — den gav altid falsk tryghed. Den mængde der betyder noget er auktioner på ryttere der KAN pensioneres i transitionens `rider_progression` (36+ ved sæson 2):
```sql
select a.id, r.firstname, r.lastname,
       (2027 - extract(year from r.birthdate)::int) as alder_s2, a.calculated_end
from auctions a join riders r on r.id = a.rider_id
where a.status in ('active','extended')
  and (2027 - extract(year from r.birthdate)::int) >= 36;
```
Er mængden **tom**: kør med `force=true` — men KUN efter at preview har vist alle andre checks grønne, og force-begrundelsen er "aktive auktioner uden pensions-risiko-ryttere, bevidst accepteret" (audit-logges automatisk). Er den **ikke tom**: krydstjek navnene mod #2700-varslets deterministiske pensionsliste (30 ryttere); auktioner på ryttere DER pensioneres annulleres via admin (`cancelAuctionByAdmin`) først, eller vent på deres udløb. NB: finaliserings-guarden (#2918-koden) fanger efterladte tilfælde, men proaktiv annullering er pænere for køberen.

**5b-bis. Browser-timeout er IKKE en fejl (#2921).** Railways proxy lukker forbindelsen efter 5 minutter uden datatransfer, så UI'et kan vise en fejl mens serveren arbejder videre. **Klik ALDRIG igen på baggrund af et rødt svar alene** — verificér først i SQL:

```sql
-- Kom transitionen i gang, og kom den igennem? (#2921-ankre i admin_log)
select created_at, meta->>'status' as status, meta->'phases' as phases, meta->>'error' as error
from admin_log
where action_type='manual_override' and meta->>'source'='season_transition_phase'
order by created_at desc limit 5;
```

`started` uden et efterfølgende `completed` = transitionen nåede ikke igennem (se `phases` for hvor langt den kom + Sentry for stacktracen). `started` + `completed` = den ER kørt, uanset hvad browseren viste. Ankrene bruger `action_type='manual_override'` (samme mønster som #1346's force-log) netop for ikke at forurene `season_transition`-tællingen som `dailySeasonCountCheck` og verifikationen nedenfor bygger på.

**5c. Hård stop-regel:** fejler fasen `global_rank_decay`, **STOP HELT** — RPC'en er ikke retry-sikker (en delvist kørt halvering, kørt igen, halverer dobbelt). Alle ANDRE faser er idempotente; ved delvis fejl i dem er recovery = ret årsagen og kør transitionen igen (resume-stien er designet til det, #578).

**5d. Forventede EKSTRA notifikationer ([#2976](https://github.com/NicolaiDolmer/CyclingZone/issues/2976)):** `season_payroll` (og sæson-slut-vejen) sender nu `board_critical`-beskeder som drejebogen tidligere ikke nævnte — "The board forced a sale" (tvangssalg ved breach-streak ≥2), "Transfers frozen: debt over the cap", og "One season before a forced sale". Ingen menneskehold står i gæld/fryse-tilstand FØR skiftet (0 frosne, 0 med breach-streak, 0 i minus pr. 26/7 09:50), men payroll kan selv skubbe et hold derned. Dukker de op, er det forventet adfærd, ikke en fejl. Baseline `board_critical` = **24 rækker** (26/7 09:50).

Verificér:

```sql
select number, status, start_date, end_date from seasons order by number;      -- S1 completed, S2 active; PRÆCIS +0 nye rækker
select id, season_id, status, closed_at, final_whistle_sent_at from transfer_windows order by created_at desc limit 2;
  -- S2-window: closed + closed_at NULL (racing-invariant); S1-window: fuldt wrapped
select count(*) from finance_transactions where type='sponsor' and season_id='00000000-0000-0000-0000-000000000002';   -- ~150
select count(*) from finance_transactions where type='salary'  and season_id='00000000-0000-0000-0000-000000000002';   -- ~150
select count(*) from riders where is_retired = true and team_id is not null;   -- 0 (retirement_release virkede)
select count(*) from riders where team_id is not null and is_academy=false and contract_end_season <= 1;  -- 0 eller kun løb-udskudte
select round(avg(fatigue)::numeric,2) from rider_condition;                    -- 0 (#2910, mode full; var 84,69 den 26/7 09:50)
```

**Tælle-queries: filtrér ALTID på tid, tæl aldrig totaler.** Begge tabeller har historik (`season_started` = **17** rækker, `admin_log`/`season_transition` = **2** rækker pr. 26/7 09:50), så en total giver 173 og 3, ikke 150 og 1. Et forventningstal der bygger på en baseline man skal huske kl. 20 om aftenen er den fejlbarlige del — tidsfilteret kan ikke lyve:

```sql
select count(*) from notifications
 where type='season_started' and created_at > now() - interval '2 hours';      -- ~150
select created_at, description from admin_log
 where action_type='season_transition' and created_at > now() - interval '2 hours';  -- PRÆCIS 1 række
```

**Rollback herfra: DETTE ER POINT OF NO RETURN.** Efter en gennemført transition er S2 live, penge er udbetalt (sponsor+payroll), global rank er halveret, ryttere er frigivet/pensioneret/udviklet, og ~150 managere har fået besked. Der findes ingen samlet rollback — kun fremadrettede reparationer (idempotente re-runs af enkeltfaser, manuelle modposteringer, `repairSeasonEndFinanceAndBoard`). Derfor ligger ALLE ejer-beslutninger FØR dette skridt.

### Skridt 6 — Entries til S2 (søndag ~18:30)

**Hvem:** Claude.

```bash
# dry-run først — forventet: ~450+ løb, ~35x hold, tusindvis af enheder, 0 failed
railway run --service CyclingZone -- node scripts/generateSeasonEntries.js
# derefter:
railway run --service CyclingZone -- node scripts/generateSeasonEntries.js --execute
```

(Fallback hvis scriptet driller: den timelige entry-sweep fylder S2 automatisk senest 60 min efter transitionen — men vent ikke på den som plan A.)

Verificér:

```sql
select count(distinct r.id) from races r where r.season_id='00000000-0000-0000-0000-000000000002'
  and not exists (select 1 from race_entries re where re.race_id=r.id);       -- 0 løb uden felt
select count(*) from race_entries re join races r on r.id=re.race_id join teams t on t.id=re.team_id
  where r.season_id='00000000-0000-0000-0000-000000000002'
  and r.league_division_id is distinct from t.league_division_id;             -- 0 pool-mismatch
-- RMF/Bacons manuelle entries: stadig til stede, og i samme pulje som holdet nu er i.
-- Hvis et af de to hold ER flyttet ved op/nedrykning: slet deres entries i den gamle
-- puljes løb (kun scheduled/0-completed) og informér manageren.
```

**Rollback herfra:** entries er frit regenererbare (generatoren er diff-baseret) — laveste risiko i hele drejebogen.

### Skridt 6b — Sæson-achievements for S1 ([#2917](https://github.com/NicolaiDolmer/CyclingZone/issues/2917)) (søndag ~18:40)

**Hvem:** Claude. **Kør EFTER skridt 3b + 5** (op/nedrykning skal være landet i `teams.division`, ellers er `team_promotion`/`team_relegation` nul).

```bash
railway run --service CyclingZone -- node scripts/backfillSeasonAchievements.js            # dry-run
railway run --service CyclingZone -- node scripts/backfillSeasonAchievements.js --execute
```

Forventet ud fra S1-data + komprimeringens fordeling (målt 25/7): top10 66 · top5 38 · top3 26 · divisionsvinder 12 · div3-vinder 4 · oprykket 90 · nedrykket 5 · overlevede 12. `season_div1_winner`, `season_grand_tour_rider`, `season_3_top3`, `season_2_seasons`, `season_5_seasons` er 0 — de kræver Division 1 eller flere sæsoner.

Idempotent (UNIQUE på `user_id, achievement_id`) — re-run er sikkert. Vil ejeren ikke tildele "Overlevede" i netop dette skifte (farezonen er en tilnærmelse når komprimeringen flytter i stedet for den normale per-pulje-nedrykning): tilføj `--skip=team_survived`.

### Skridt 7 — Slutkontrol søndag aften

1. `GET /api/admin/season-transition/preview` → `already_transitioned` og ingen ny kilde-sæson (defensivt).
2. Discord: **præcis én** "Sæson 2 startet"-besked (2+ = loop, se abort).
3. Sentry: ingen nye events med `phase:`-tags fra transitionen.
4. Stage-scheduler-log (Railway): næste tick melder "0 due" — første etape er først 09:00.
5. **Gentag afstemningen fra skridt 1b** (`mv_points` = `raw_points` for S1). Det er den sidste gate før managerne møder listerne mandag morgen, og den er hurtig. Kør derefter `database/2026-07-26-2863-season-honours.sql` (#2863, bevidst FØRST her: listerne giver ingen mening før sæsonen er lukket) og åbn `/seasons` for den afsluttede sæson: "Sæsonens bedste ryttere" skal vise to navne, ikke en fejl-tilstand.
6. Kør post-cutover-tjeklisten **#2846**.

### Skridt 8 — Aftenvagt (mandag 17:45–18:30 — dag 1 retimet til 18:00-20:40, ejer-valg 26/7)

Claude-session åben FØR 18:00 dansk: følg stage-scheduler-logs + første etapers afvikling (455 løbs S2-premiere), tjek `race_stage_passages` begynder at fyldes (#2811, Sub-2-persistens — første reelle måling), og at præmie-sweepen betaler S2-løb. Berede på `detectInFlightRacesWithoutEntries`-alarmer (skulle være umulige efter skridt 6-verifikationen).

---

## Abort-veje

| Situation | Handling |
|---|---|
| Noget føles galt FØR skridt 3 | Bare stop. Intet er sket. S1 kører videre — men husk: uden season-end/transition starter S2-løbene IKKE mandag (ingen aktiv S2). Det er en accepteret nødudgang: udskyd, fix, kør skridtene senere søndag/natten — S2's første etaper afvikles så snart transitionen lander (scheduler samler forfaldne etaper op). |
| "Afslut sæson" fejler halvvejs | STOP. Diagnosticér (Sentry + server-log). Flytninger er idempotente; board/bonus repareres via `repairSeasonEndFinanceAndBoard`. Genkør IKKE i blinde. |
| Season-end kørt, men ejeren fortryder listen | Muligt indtil transitionen: genskriv `division`/`league_division_id` fra skridt 0-snapshottet + sæt S1 `status='active'` igen. Bonusser/notifikationer består (synligt for spillere). Beslut med ejeren om det er bedre at leve med listen. |
| Transition fejler i `global_rank_decay` | HÅRDT STOP — ingen re-run. Undersøg RPC-tilstanden manuelt (dobbelt-halvering er ikke selvhelende). |
| Transition fejler i anden fase | Ret årsagen, kør transitionen igen — faserne er idempotente og resume-stien (#578) er bygget til præcis det. |
| 2+ transitions/sæsoner opdaget | Som den gamle procedure: markér nyeste sæson completed + wrap dens vindue via SQL, verificér 3 cron-ticks er no-op, byg målrettet oprydning (template: `database/2026-05-21-season-loop-rollback.sql`). Usandsynligt nu (auto-cron er slået fra i koden). |

---

## Kendte accepterede afvigelser (bevidst IKKE fikset før 27/7)

- ~~**Test-konti i sponsor/payroll** (dengang 3, nu 4): `processSeasonStart` filtrerer ikke `is_test_account`~~ — **fikset (#2852).** `buildTransitionPlan`, `processSeasonStart` og kontrakt-fornyelsen bruger nu den fælles `applyHumanTeamFilter` (`backend/lib/humanTeamFilter.js`). **Kontrollér tallet 156 mod filteret, ikke mod et fald på 3.** Regnestykket er `is_ai=false` (**161**) minus de 5 der ryger på `is_bank`/`is_frozen`/`is_test_account` (4 test-konti + 2 frosne, hvoraf 1 hold er begge dele) = **156** (målt 26/7 09:50). Viser preview'et ikke 156, så kør denne og sammenlign:
  ```sql
  select count(*) filter (where is_ai=false) as ikke_ai,
         count(*) filter (where is_ai=false and (is_bank or is_frozen or is_test_account)) as fravalgt,
         count(*) filter (where is_ai=false and not is_bank and not is_frozen and not is_test_account) as menneskehold
  from teams;   -- 161 · 5 · 156
  ```
  Matcher `menneskehold` men ikke `teams_affected`, er #2852-fixet ikke deployet — STOP og undersøg før du kører skiftet. Resterende forekomster af den korte diskriminator uden for transition-motoren (season-end, cron, board-stier) er noteret i PR'ens backwards-check.
- **Payroll før pension:** en rytter der pensioneres i fase `rider_progression` har allerede fået sin S2-løn trukket i fasen før. Én sæsons løn til en afgående rytter — accepteret spilregel-nuance.
- **D3→D4-nedrykning hviler på data, ikke en regel:** `poolAllReal`-gaten er åben fordi alle 4 D3-puljer er 24/24 ægte. Efter S2 (hvor AI-fyld lander i D3) lukker gaten igen af sig selv — **#2164 skal implementeres eksplicit før S2→S3**. Skridt 2 verificerer gaten på dagen.
- **`resolveCalendarAnchor`/kalender-regenerering:** ikke relevant — S2-kalenderen ER materialiseret og røres ikke.

## Reference

- #2361 (drejebogs-issuet) · #2742 (rækkefølgen) · #2805 (season-end-spærren, merget som PR #2850) · #2846 (post-cutover-tjekliste) · #2164 (D3→D4 eksplicit regel, efter cutover)
- Nye faser/beskeder i dette skifte: #2910 (trætheds-nulstilling, ON) · #2911 (akademi-optagelse, OFF) · #2948 (sæsonmåls-bonusser) · #2976 (tvangssalgs- + varselsbeskeder) · #2863 (sæsonens bedste ryttere) · #2897/PR #3000 (error-destrukturering i cutover-stien, merget 26/7 som `1c51069b`)
- Transition-motor: `backend/lib/seasonTransition.js` · season-end: `backend/lib/economyEngine.js` (`processSeasonEnd`→`processDivisionEnd`) · gate: `backend/lib/seasonTransitionReadiness.js`
- Scripts: `simulateSeasonTransitionDryRun.js` (read-only dry-run) · `executeSeasonTransition.js` (ugatet nød-transition — brug admin-endpointet i stedet) · `generateSeasonEntries.js` (skridt 6)
- Incident-arv: `.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md` · `docs/GAME_INVARIANTS.md`
