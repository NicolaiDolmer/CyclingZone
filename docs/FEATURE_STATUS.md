# FEATURE STATUS

_Udled fra kodebasen. Opdatér ved større ændringer._

---

## ✅ Implementeret & live

### Auth & Brugere
- Login / logout (Supabase Auth)
- Glemt password + reset-flow (`/reset-password`)
- Admin- og managerroller
- Login-streak tracking
- Manager XP + niveauer (level = floor(xp/100)+1, max 50)
- Manager-profil med historik
- `ProfilePage.jsx` — `/profile` route viser konto-/holdindstillinger; hold- og managernavn redigeres via `PUT /api/teams/my` (v1.74)

### Hold & Ryttere
- Holdoversigt og holdprofil-sider
- Rytterbibliotek med søgning + filtre (nation, UCI, U25, ledig, evne-min/max, osv.) + løn-kolonne og lønfilter (v1.47)
- Rytterdetalje-side (stats, historik, watchlist-tæller, ryttertype-badge, ⚡-badge ved aktiv auktion)
- Rytter-sammenligning (side-by-side)
- Watchlist + notifikation når ønskeliste-rytter sættes til salg eller auktion (v1.35)
- Stat-grid med farvekodning (statBg.js)

### Auktioner
- Opret auktion med starttid + vindueslogik
- Bud-placering med auto-forlængelse (10 min ved bud nær slut)
- Garanteret salg (startpris = 50% af UCI-pris) — kun egne ryttere; exploit lukket (v1.46)
- Minimum startpris håndhævet (backend + frontend): startbud ≥ rytterens Værdi; garanteret salg er eneste undtagelse
- Minimum overbud håndhæves som 10% over nuværende pris, afrundet op til nærmeste 1.000 CZ$
- Aktive auktionsføringer reserverer både disponibel balance og squad-plads ved nye bud
- Auktionsfinalisering via cron (60s) — delt path for cron/admin/API, korrekt ejer-check og squad-limit
- Bank/AI/fri rytter-auktioner kan startes fra rytterprofilen; startprisen tæller som initiatorens første førende bud, og finalizer har fallback for aktive legacy-auktioner hvor første bud ikke blev skrevet til `current_bidder_id`
- Auktionshistorik-side
- Discord-notifikationer (auktioner, overbud, transfers, sæsonevents)

### Transfers
- Opret transfer-liste
- Tilbud → accepter / afvis / modtilbud
- Swap-forslag med kontantjustering + modtilbud
- Delt backend confirm-path (ejerskab, saldo, squad-limit + oprydning ved gennemførelse)
- Parkerede `window_pending` transfers/swaps kan ikke manager-annulleres efter begge parter har accepteret
- Bank/AI-ryttere skjules fra direkte tilbud på rytterprofilen; bankryttere blokeres også server-side fra direkte transfer/bytte
- Tilbagetræk tilbud (withdraw, inkl. modtilbud)
- Notifikationer til sælger ved nyt tilbud

### Lån
- Manager-oprettede lån (short/long)
- Accept / afvis lånetilbud
- Squad-limit check ved lejeforslag og låneaktivering
- Lejegebyr ved aktivering + ved dækket sæsonstart
- Låneoversigt (aktive + egne)
- Låneafdrag
- Auto-nødlån ved manglende løn

### Økonomi & Finans
- **Alle beløb skaleret ×4000 (v1.43)** — rytterværdi = uci_points × 4000 CZ$
- **Økonomi retuneret (v1.46)** — startkapital 800K, sponsor 240K/sæson
- **Economy baseline simulation (2026-04-29)** — read-only live baseline + lokale scenarier er dokumenteret i `docs/archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md`, med gentagelig kommando `backend/scripts/economyBaselineSimulation.js`
- Sponsorindtægt ved sæsonstart (med board-modifier)
- Lønudbetaling ved sæsonslut
- Renteberegning på negativ saldo (10%/sæson)
- Resultatpoint ved løbsimport (stage/GC/points/mountain/team/young)
- CZ$-præmiepenge er ikke færdigdesignet endnu og skal laves før større økonomituning
- Finance-transaktionslog + Finance-side
- Balance-justering (admin)
- Finance transaction type-kontrakt er afstemt i schema/migration/test med runtime for lån, lånerenter, nødlån og admin-justeringer
- Live DB migration for finance-/notification type-kontrakt er applied 2026-04-29.
- Season-end nødlån sender nu `season_id` med til finance-loggen, så `emergency_loan` rows kan verificeres per sæson fremover.
- Service-visible season 6 repair verifier findes som `backend/scripts/verifySeasonEndRepair.js` / `npm run season:end:verify-repair -- --markdown`.
- UCI salary recalculation: GitHub Actions kører `backend/scripts/recalculateRiderSalaries.js` efter UCI scraperen, så `riders.salary` følger opdaterede `uci_points` med eksisterende `prize_earnings_bonus`

### Sæson & Løb
- Sæsonoversigt med race-kalender
- Løbsresultater-import (xlsx) og approve via delt backend result-path
- Google Sheets-resultatimport matcher løbsnavne robust på accenter, tegnsætning og kendte kalenderaliaser
- Google Sheets-resultatimport er idempotent for prize finance: gamle prize-transaktioner for samme løb reverseres før re-import
- Adminens `race_points`-editor bruger moderne herre-UCI-klasser og seedede UCI-point for klassement, klassikere, etaper, pointtrøje, bjergtrøje og førertrøje
- Pointtavle (season_standings) inkl. rank_in_division, recalkuleres fra race_results
- Opryknings/nedrykningslogik (top/bund 2 per division)
- Holdranglisten viser opryknings-/nedrykningszoner efter samme season-end-regel: Division 2-3 kan rykke op, Division 1-2 kan rykke ned
- Sæsonpreview-side + Races-side
- Løbsarkiv (`/race-archive`) og løbshistorik (`/race-archive/:raceSlug`)
- Season-end preview bruger economy engine til løn, lånerente som gæld, projected board satisfaction og næste sponsorudbetaling, så preview matcher season-end/season-start runtime
- Season-end runtime loader teams/riders/board_profiles separat og fejler hårdt på Supabase load/write errors, så finance/board side effects ikke silently skippes før season completion.

### Bestyrelse (Board)
- Tre parallelle planer (1yr/3yr/5yr) kører simultant per hold med egne mål og tilfredshed → budget_modifier
- Kumulativ mål-tracking, mid-plan review, plan snapshots, board wizard
- Delt boardEngine for proposal/sign/renew/season-end
- Gradvis, vægtet evaluering med 2-3 sæsoners hukommelse (resultater, økonomi, identitet, rangering)
- Board-outlook på dashboard og Board-siden (kategori-scores, drivere, signalnoter)
- Én board request pr. sæson (DB-enforced); approved/partial/rejected/tradeoff
- Mål skaleret efter division, standings og holdspecialisering
- Afledt holdprofil (specialisering, U25, national kerne + landenavn/flag, stjerneprofil)
- Nationale identitetsmål i balancerede planer; focus-switch lander som gradvis tradeoff

### Admin
- Import af ryttere (Python-script)
- Import af løbsresultater (xlsx upload)
- UCI points sync (Google Sheets CSV)
- Override rider (team/stats)
- Sæsonopcioner (create/start/end/result import) via kanoniske admin-routes
- Genberegning af standings fra gemte race_results
- Løbsoprettelse og season-end preview endpoint
- Admin repair endpoint til season-end finance/board side effects uden at køre season status eller oprykning/nedrykning igen; deployed 2026-04-29 og kan resume missing side effects uden at duplikere eksisterende salary/snapshots.
- Beta-reset komplet suite: marked, trupper, balancer, divisioner, bestyrelse, løbskalender, sæsoner, XP/level og achievement unlocks via delt reset-service

### UI / Misc
- Responsivt layout med navigation (Layout.jsx)
- Segment-aware sidebar active-state: `/team` matcher ikke `/teams`
- Sidebar og egen managerprofil linker til `/profile` → `ProfilePage` (indstillinger)
- Mobile beta-critical flows: rytterliste, rytterside-market actions, auktioner/bud, transfers, indbakke og admin beta quick actions er optimeret til smalle skærme uden primær horisontal scroll
- Frontend route-level code-splitting: sider lazy-loades via `React.lazy`/`Suspense`, så initial bundle er reduceret og Vite-build kører uden large chunk warning
- Rytterprofilens `Udvikling`-tab viser UCI-point og stats over tid fra `rider_uci_history`/`rider_stat_history`
- Notifikationssystem (in-app + badge, deduplicering ved cron/retries)
- Notification type-kontrakt er afstemt i schema/migration/test med runtime for transfer-interesse, watchlist og lånebeskeder
- Achievement-sync fra live historiktabeller (bid, transfer, watchlist, hold, board)
- Aktivitets-feed · Head-to-head sammenligning · Hall of Fame · Patch notes · Hjælpeside · Confetti modal

### Discord & Integrationer
- Discord webhooks: admin kan tilføje webhooks med navn, URL og type (general / transfer_history)
- Gennemførte transfers og byttehandler sendes til `transfer_history` webhook; runtime-bekræftet med rigtig transfer completion 2026-04-28
- dyn_cyclist sync: PCM-stats (14 stat-felter + højde, vægt, popularitet) fra Google Sheets (match på pcm_id) — logger nu stats-historik i `rider_stat_history` ved hver sync
- UCI-points sync fra Google Sheets — logger nu historik i `rider_uci_history` ved hver sync
- UCI scraper: GitHub Actions cron henter top 3000 fra ProCyclingStats, skriver Google Sheets, synkroniserer Supabase, genberegner rytterlønninger og har safety-gates for coverage og mass minimum downgrade; live data-repair godkendt 2026-04-28

---

## 🔴 Broken / Kendte bugs

- Ingen kendt live result-import blocker efter 2026-04-29-verifikation. Sæson 6 har 98 races, 709 race_results, 25 standings rows og 10 prize finance rows efter idempotent re-import.
- Finance-/notification runtime/schema-drift fundet 2026-04-29 er rettet i repo og live DB migrationen er applied.
- Live season-end for sæson 6 blev kørt 2026-04-29. Status/divisioner blev applied først; root cause var embedded `teams.riders(...)` load uden error-check. Runtime-fix er deployed, og live repair er kørt med `success=true`. Service-visible verification bekræfter salary, loan-interest, emergency-loan rows og board snapshots efter målrettet backfill af 3 emergency-loan finance rows til season 6.

---

## 🚧 I gang

- [ ] Prize-money backend (S4): `points_earned` fra race_points, `prize_money = points × 15K`, divisionsbonus ved sæsonslut — design godkendt 2026-04-30.
- [ ] Economy tuning implementation efter prize-money baseline: centraliser/ændr salary rate, division-aware sponsor og debt ceilings med regressionstests.
- [ ] Admin-authenticated deployed season-end preview smoke + UI sanity i browser-session efter repair.

---

## 📋 Planlagt (backlog)

- Aktiv feature- og forbedringsbacklog vedligeholdes i `docs/PRODUCT_BACKLOG.md`
- Economy baseline & simulation er gennemført; næste økonomispor er tuning implementation efter admin/service-visible repair-verifikation.
- Team ID-mapping fra PCM
- Cyclist ID-mapping fra PCM
- 3-sæsoners glidende gennemsnit for rangliste
