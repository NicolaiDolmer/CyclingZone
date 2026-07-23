# Sæsonskifte-drejebog (S1 → S2, 26.–27. juli 2026)

> **⚠️ EJER-BESLUTNING 23/7 AFTEN (efter generalprøven): pyramide-komprimering, [#2851](https://github.com/NicolaiDolmer/CyclingZone/issues/2851).** Global rank (kun managerhold) fylder D2 (48) + D3 (96) i DETTE skifte; motorens op/nedrykning springes over og genoptages S2→S3. Skridt 2/3 nedenfor ændres når #2851 er bygget og ejer-godkendt (deadline lørdag aften). **Hård fallback:** er #2851 ikke bevist lørdag, gælder denne drejebog uændret (motorens regler). Alt andet — spærren, window-wrap, auktions-politik, transition, entries — gælder i begge tilfælde.

> **Omskrevet fra bunden 23/7 (S8 cutover-generalprøve, #2361).** Den gamle checkliste var bygget om deadline-day-cyklussen (transfervindue med `closes_at`, auto-close, squad-enforcement-kæde) — den verden findes ikke længere: markedet er altid åbent (#1996), auto-transition er slået fra (`SEASON_AUTO_TRANSITION_ENABLED=false`), og den nævnte aldrig **"Afslut sæson"** (`processSeasonEnd`), som er det skridt der afgør op/nedrykning. Denne version er verificeret mod koden og prod-data 23/7 og dækker S1→S2 konkret; generalisér først efter cutoveren har bevist den.
>
> **Historisk kontekst der stadig gælder:** cron-loop-incidenten 2026-05-21 (flere transitions samme dag) — safety-nets fra dengang består: daglig season-count-vagt, admin_log pr. transition, Discord-broadcast pr. transition, DB-CHECK på racing-windows. Postmortem: `.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md`.

---

## Nøglefakta (målt i prod 23/7 — genmål de markerede ⏱ på dagen)

| Hvad | Værdi |
|---|---|
| Sidste S1-etape | **26/7 17:00 UTC** (19:00 dansk) |
| Første S2-etape | **27/7 09:00 UTC** (11:00 dansk) — vinduet er ~16 timer, helt manuelt |
| S1-løb ikke afviklet ⏱ | 76 løb / 147 etaper (23/7) — skal være **0** før "Afslut sæson"; #2805-spærren håndhæver det |
| S2-kalender | 455 løb / 1.148 etaper, allerede materialiseret, sidste løbsdag 23/8 |
| S2 i `seasons`-tabellen | **Findes allerede** som `status='upcoming'` → transitionen *promoverer* i stedet for at oprette (`already_transitioned: JA ⚠️` i preview er FORVENTET, ikke en fejl) |
| S1-transfervindue | 1 række: `status='closed'`, `closed_at=NULL`, whistle/squad_enf `NULL` (racing-window) → **readiness-gatens 3 window-checks kan ikke blive grønne af sig selv** (deadline-cyklussen er afskaffet) — se skridt 5a |
| Kontraktudløb ⏱ | 195 ejede ryttere med `contract_end_season<=1` (1 på menneskehold) — frigives i transitionens fase `contract_expiry_release` |
| Pension ⏱ | 81 menneskehold-ryttere i 36-39-vinduet + 11 garanteret (40+) ved `ageForSeason(bd, 2)` — afgøres i `rider_progression` under transitionen; `retirement_release` rydder team_id bagefter |
| Payroll | **Første sæson-payroll nogensinde** — ~2,62 mio. CZ$ på menneskehold i ét hug (fase `season_payroll` i transitionen) |
| Sponsor | Base-total ~66,03M for 153 hold (dry-run 23/7). NB: tallet inkluderer de 3 test-konti — kendt, harmløs drift (`buildTransitionPlan`/`processSeasonStart` filtrerer ikke `is_test_account`) |
| Flags | `stage_scheduler=on`, `race_engine_v2=on`, `auto_prize=on`, `auto_entry_generator=on`, `auto_calendar` **OFF** (mangler i app_config) → transitionen genererer IKKE selv kalender/entries |
| Auktioner ⏱ | ~24t varighed → der KAN være aktive auktioner søndag aften (39 aktive 23/7). Se skridt 5b |
| Manuelle S2-entries ⏱ | 36 rækker (RMF Pro Athletic, Bacon Fræsers — egne udtagelser 23/7). Generatoren rører dem aldrig; tjek pool-match efter op/nedrykning (skridt 6) |

**Hvorfor rækkefølgen er som den er:** entry-generatoren matcher hold↔løb på `league_division_id`. Op/nedrykning (i "Afslut sæson") flytter ~35 hold til nye puljer, og transitionens frigivelses-/pensionsfaser fjerner frigivne rytteres fremtidige entries igen (`clearFutureRaceEntriesSafe`). Derfor: **afvikl alt → Afslut sæson (op/nedrykning) → transition (frigivelser+pension+penge) → generér entries til sidst** — så genereres felterne én gang, mod den endelige tilstand. (#2742's oprindelige forslag om at pre-generere entries FØR skiftet er forkert af begge grunde.)

**Ingen automatik tager over:** alle sæson-jobs (stage-scheduler, prize-sweep, entry-sweep) kører kun mod en sæson med `status='active'`. Mellem "Afslut sæson" og transitionen findes ingen aktiv sæson → hold det mellemrum KORT (minutter, ikke timer), og verificér at alt sæson-afhængigt (især præmier) er færdigt FØR "Afslut sæson".

---

## Tidslinje og skridt

Alle tider UTC (dansk tid = UTC+2). Operatør = ejer + Claude-session i fællesskab; hvert skridt angiver **hvem der klikker**. Kommandoer med `railway run` køres fra `backend/`-mappen.

### Skridt 0 — Preflight (lørdag 26/7 eller søndag formiddag)

**Hvem:** Claude forbereder, ejeren klikker backup.

1. **Backup:** Ejer verificerer i Supabase-dashboardet at seneste daglige backup/PITR er frisk (Settings → Database → Backups). Dette er det eneste ægte sikkerhedsnet under skridt 3-5.
2. **Varsel sendt:** `#2700`-varslet (`notifySeasonTransitionRisk.js --live`) skal være kørt FØR skiftet (separat ejer-gate, se NOW.md Next action).
3. **#2805-spærren er live:** kald `GET /api/admin/season-transition/preview` eller klik "⏹ Afslut" og forvent **400 "…løb er ikke afviklet endnu…"** så længe der er S1-løb tilbage. Spærren SKAL være rød nu og grøn efter sidste løb — det er generalprøven af den.
4. **Rollback-snapshot af divisions-tilstand** (Claude, read-only — gemmes som fil):
   ```sql
   select id, name, division, league_division_id, balance from teams order by id;
   ```
5. **Genmål ⏱-rækkerne** i nøglefakta-tabellen (løb, udløb, pension, auktioner, manuelle entries).

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

**Rollback herfra:** stadig intet at rulle tilbage.

### Skridt 2 — ENDELIG op/nedrykningsliste + ejer-godkendelse (søndag ~17:30)

**Hvem:** Claude genererer, **ejeren godkender navnene** (hård gate — ejer-beslutning: op/nedrykning køres ikke uden at ejeren har set den endelige liste).

Standings ændrer sig med hvert løb frem til 17:00 — listen fra 23/7 er et snapshot, ikke facit. Generér den endelige med (læg mærke til at den spejler `processDivisionEnd` præcist: top-2-*positioner* op, bund-4-*positioner* ned, AI på en plads springes over uden erstatning, D3→D4-nedrykning kræver at puljen stadig er 24/24 ægte):

```sql
with st as (
  select ss.team_id, ss.division, ss.league_division_id, ss.rank_in_division, ss.total_points,
         t.name, t.is_ai
  from season_standings ss join teams t on t.id = ss.team_id
  where ss.season_id = '00000000-0000-0000-0000-000000000001' and ss.league_division_id is not null
),
ranked as (
  select st.*,
    row_number() over (partition by league_division_id order by rank_in_division nulls last) as pos,
    count(*) over (partition by league_division_id) as pool_size,
    bool_and(not is_ai) over (partition by league_division_id) as pool_all_real
  from st
)
select p.label as pool, r.pos, r.name, r.total_points, r.is_ai,
  case when r.pos <= 2 and r.division > 1 then 'OP'
       when r.pos > greatest(2, r.pool_size - 4) and r.division < 4
            and (r.division < 3 or r.pool_all_real) then 'NED' end as movement
from ranked r join league_divisions p on p.id = r.league_division_id
where (r.pos <= 2 and r.division > 1)
   or (r.pos > greatest(2, r.pool_size - 4) and r.division < 4 and (r.division < 3 or r.pool_all_real))
order by r.division, p.pool_index, r.pos;
```

Sanity mod 23/7-billedet: D1+D2-bevægelser er ren AI (flyttes ikke) · 8 ægte op D3→D2 · 16 ægte ned D3→D4 · ~11 ægte op D4→D3 (AI på en top-2-plads bruger pladsen uden at rykke). **Verificér også at alle 4 D3-puljer stadig viser `pool_all_real=true`** — mister én pulje det (frosset hold e.l.), udebliver dens nedrykning tavst, og ejeren skal vide det før kørslen.

**Rollback herfra:** intet kørt endnu — ejeren kan stadig aflyse alt.

### Skridt 3 — "Afslut sæson" (søndag ~17:45, EFTER ejer-ja)

**Hvem:** ejeren klikker **⏹ Afslut** på `/admin/season` (eller Claude via `POST /api/admin/seasons/00000000-0000-0000-0000-000000000001/end` med ejerens go).

Hvad der sker, i rækkefølge (`routes/api.js` → `economyEngine.processSeasonEnd`): standings genberegnes → board-evaluering pr. menneskehold (satisfaction/konsekvenser) → divisionsbonusser udbetales → **op/nedrykning** (muterer `teams.division` + `league_division_id`) → AI-fyld-rekonciliation pr. pulje (24 hold) → `seasons.status='completed'` → sekventiel board-forhandling for S2 åbnes → season_ended-notifikationer (~150 managere, in-app) + Discord-broadcast.

Verificér:

```sql
select status, end_date from seasons where number=1;                          -- completed + dato
select count(*) from notifications where type='season_ended';                 -- ~150
select division, count(*) filter (where not is_ai) as real_teams from teams group by division order by 1;
-- forventet (ud fra 23/7-listen; endelige tal følger skridt 2-listen): D1 = 0 ægte,
-- D2 = 8 (før: 0), D3 = ~83 (96 − 8 op − 16 ned + ~11 fra D4), D4 = ~59 (54 − ~11 + 16). Sum = 150.
select ld.label, count(*) from teams t join league_divisions ld on ld.id=t.league_division_id group by 1 order by 1;  -- alle puljer = 24
```

**Rollback herfra (grænsen skærpes):**
- **Kan rulles tilbage:** flytningerne (skriv `division`/`league_division_id` tilbage fra skridt 0-snapshottet) og `seasons.status` (ét UPDATE tilbage til `'active'` genopliver stage-scheduler/sweeps). Gør det KUN hvis transitionen endnu ikke er kørt.
- **Kan IKKE rulles pænt tilbage:** divisionsbonusser (penge er bogført — reversering = manuelle modposteringer, ejer-gated), board-konsekvenser, og alle notifikationer/Discord-beskeder er SET af spillere. En fortrudt season-end er altså synlig udadtil uanset.
- Fejler `processSeasonEnd` halvvejs: **STOP — ingen blind re-run.** Flytningerne er idempotente (samme destination), men board/bonus-siden har `repairSeasonEndFinanceAndBoard()` som dedikeret reparationsvej. Diagnosticér først.

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

**5a. Forventet fase-log** (rækkefølgen i `transitionToNextSeason`): `insert_next_season` (promoverer S2 upcoming→active) → `mark_previous_completed` (no-op, allerede sat) → `global_rank_decay` → `close_prev_transfer_window` → `insert_next_transfer_window` (S2-racing-window, `closed_at=NULL`) → `sponsor_contracts_renewal` (70 pending→active; dagsrater genberegnes mod S2's 28 dage, #2589) → `contract_expiry_release` (**~195 frigivelser**, 1 menneskehold-rytter) → `sponsor_payout` (~153) → `season_payroll` (**første nogensinde, ~2,62M**) → `season_parachute` (forventet 0 — kun D1/D2-nedrykkere er berettigede, og de er AI) → `rider_progression` (**udvikling + pension, første gang**) → `retirement_release` (team_id ryddes for netop-pensionerede) → `admin_log` → Discord `season_started` → `season_started_notifications` (~150) → `contract_expiring_notifications` (varsler S2-udløb).

**5b. Hvis `no_active_auctions` er rød** (auktioner løber ~24t, så søndags-auktioner kan være i luften): mål overlap mod risiko-mængden:
```sql
select count(*) from auctions a join riders r on r.id=a.rider_id
where a.status in ('active','extended')
and (r.contract_end_season <= 1 or r.is_retired);
```
Er overlappet **0** (som 23/7): kør med `force=true` — men KUN efter at preview har vist alle andre checks grønne, og force-begrundelsen er "aktive auktioner uden risiko-ryttere, bevidst accepteret" (audit-logges automatisk). Er overlappet **> 0**: annullér de konkrete auktioner via admin (`cancelAuctionByAdmin`) først, eller vent på deres udløb.

**5c. Hård stop-regel:** fejler fasen `global_rank_decay`, **STOP HELT** — RPC'en er ikke retry-sikker (en delvist kørt halvering, kørt igen, halverer dobbelt). Alle ANDRE faser er idempotente; ved delvis fejl i dem er recovery = ret årsagen og kør transitionen igen (resume-stien er designet til det, #578).

Verificér (fra den gamle checklistes trin 3, stadig gyldige):

```sql
select number, status, start_date, end_date from seasons order by number;      -- S1 completed, S2 active; PRÆCIS +0 nye rækker
select id, season_id, status, closed_at, final_whistle_sent_at from transfer_windows order by created_at desc limit 2;
  -- S2-window: closed + closed_at NULL (racing-invariant); S1-window: fuldt wrapped
select count(*) from finance_transactions where type='sponsor' and season_id='00000000-0000-0000-0000-000000000002';   -- ~150
select count(*) from finance_transactions where type='salary'  and season_id='00000000-0000-0000-0000-000000000002';   -- ~150
select count(*) from riders where is_retired = true and team_id is not null;   -- 0 (retirement_release virkede)
select count(*) from riders where team_id is not null and is_academy=false and contract_end_season <= 1;  -- 0 eller kun løb-udskudte
select created_at, description from admin_log where action_type='season_transition' order by created_at desc limit 3;  -- præcis 1 ny
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

### Skridt 7 — Slutkontrol søndag aften

1. `GET /api/admin/season-transition/preview` → `already_transitioned` og ingen ny kilde-sæson (defensivt).
2. Discord: **præcis én** "Sæson 2 startet"-besked (2+ = loop, se abort).
3. Sentry: ingen nye events med `phase:`-tags fra transitionen.
4. Stage-scheduler-log (Railway): næste tick melder "0 due" — første etape er først 09:00.
5. Kør post-cutover-tjeklisten **#2846**.

### Skridt 8 — Morgenvagt (mandag 08:45–09:30)

Claude-session åben FØR 09:00: følg stage-scheduler-logs + første etapers afvikling (455 løbs S2-premiere), tjek `race_stage_passages` begynder at fyldes (#2811, Sub-2-persistens — første reelle måling), og at præmie-sweepen betaler S2-løb. Berede på `detectInFlightRacesWithoutEntries`-alarmer (skulle være umulige efter skridt 6-verifikationen).

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

- **Test-konti i sponsor/payroll** (3 stk): `processSeasonStart` filtrerer ikke `is_test_account` — samme adfærd som S0→S1. Oprydning efter cutover.
- **Payroll før pension:** en rytter der pensioneres i fase `rider_progression` har allerede fået sin S2-løn trukket i fasen før. Én sæsons løn til en afgående rytter — accepteret spilregel-nuance.
- **D3→D4-nedrykning hviler på data, ikke en regel:** `poolAllReal`-gaten er åben fordi alle 4 D3-puljer er 24/24 ægte. Efter S2 (hvor AI-fyld lander i D3) lukker gaten igen af sig selv — **#2164 skal implementeres eksplicit før S2→S3**. Skridt 2 verificerer gaten på dagen.
- **`resolveCalendarAnchor`/kalender-regenerering:** ikke relevant — S2-kalenderen ER materialiseret og røres ikke.

## Reference

- #2361 (drejebogs-issuet) · #2742 (rækkefølgen) · #2805 (season-end-spærren, merget som PR #2850) · #2846 (post-cutover-tjekliste) · #2164 (D3→D4 eksplicit regel, efter cutover)
- Transition-motor: `backend/lib/seasonTransition.js` · season-end: `backend/lib/economyEngine.js` (`processSeasonEnd`→`processDivisionEnd`) · gate: `backend/lib/seasonTransitionReadiness.js`
- Scripts: `simulateSeasonTransitionDryRun.js` (read-only dry-run) · `executeSeasonTransition.js` (ugatet nød-transition — brug admin-endpointet i stedet) · `generateSeasonEntries.js` (skridt 6)
- Incident-arv: `.claude/learnings/2026-05-22-season-transition-cron-loop-racing-window-leakage.md` · `docs/GAME_INVARIANTS.md`
