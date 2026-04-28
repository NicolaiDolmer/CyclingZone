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
- Hold- og managernavn via kanonisk backend-path `PUT /api/teams/my`

### Hold & Ryttere
- Holdoversigt og holdprofil-sider
- Rytterbibliotek med søgning + filtre (nation, UCI, U25, ledig, osv.) + løn-kolonne og lønfilter (v1.47)
- Rytterdetalje-side (stats, historik, watchlist-tæller, ryttertype-badge, ⚡-badge ved aktiv auktion)
- Rytter-sammenligning (side-by-side)
- Watchlist + notifikation når ønskeliste-rytter sættes til salg eller auktion (v1.35)
- Stat-grid med farvekodning (statBg.js)

### Auktioner
- Opret auktion med starttid + vindueslogik
- Bud-placering med auto-forlængelse (10 min ved bud nær slut)
- Garanteret salg (startpris = 50% af UCI-pris) — kun egne ryttere; exploit lukket (v1.46)
- Minimum startpris håndhævet (backend + frontend): startbud ≥ rytterens Værdi; garanteret salg er eneste undtagelse
- Auktionsfinalisering via cron (60s) — delt path for cron/admin/API, korrekt ejer-check og squad-limit
- Auktionshistorik-side
- Discord-notifikationer (auktioner, overbud, transfers, sæsonevents)

### Transfers
- Opret transfer-liste
- Tilbud → accepter / afvis / modtilbud
- Swap-forslag med kontantjustering + modtilbud
- Delt backend confirm-path (ejerskab, saldo, squad-limit + oprydning ved gennemførelse)
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
- Sponsorindtægt ved sæsonstart (med board-modifier)
- Lønudbetaling ved sæsonslut
- Renteberegning på negativ saldo (10%/sæson)
- Præmiefordeling ved løbsimport (stage/GC/points/mountain/team/young)
- Finance-transaktionslog + Finance-side
- Balance-justering (admin)

### Sæson & Løb
- Sæsonoversigt med race-kalender
- Løbsresultater-import (xlsx) og approve via delt backend result-path
- Pointtavle (season_standings) inkl. rank_in_division, recalkuleres fra race_results
- Opryknings/nedrykningslogik (top/bund 2 per division)
- Sæsonpreview-side + Races-side
- Løbsarkiv (`/race-archive`) og løbshistorik (`/race-archive/:raceSlug`)

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
- Beta-reset komplet suite: marked, trupper, balancer, divisioner, bestyrelse, løbskalender, sæsoner, XP/level og achievement unlocks via delt reset-service

### UI / Misc
- Responsivt layout med navigation (Layout.jsx)
- Notifikationssystem (in-app + badge, deduplicering ved cron/retries)
- Achievement-sync fra live historiktabeller (bid, transfer, watchlist, hold, board)
- Aktivitets-feed · Head-to-head sammenligning · Hall of Fame · Patch notes · Hjælpeside · Confetti modal

### Discord & Integrationer
- Discord webhooks: admin kan tilføje webhooks med navn, URL og type (general / transfer_history)
- Gennemførte transfers og byttehandler sendes til `transfer_history` webhook
- dyn_cyclist sync: PCM-stats (14 stat-felter + højde, vægt, popularitet) fra Google Sheets (match på pcm_id) — logger nu stats-historik i `rider_stat_history` ved hver sync
- UCI-points sync fra Google Sheets — logger nu historik i `rider_uci_history` ved hver sync
- UCI scraper: GitHub Actions cron henter top 3000 fra ProCyclingStats, skriver Google Sheets, synkroniserer Supabase og har safety-gates for coverage og mass minimum downgrade; live data-repair godkendt 2026-04-28

---

## 🔴 Broken / Kendte bugs

- Lønninger genberegnes ikke automatisk efter UCI value-sync; se Slice UCI-R2 i `docs/PRODUCT_BACKLOG.md`
- Evne-filter/slider kræver frisk live-reproduktion; ingen statisk root cause fundet
- Discord/webhook-regression kræver frisk live-reproduktion; inkl. transferhistorik til Discord-tråd

---

## 🚧 I gang

- [ ] Event-sekvens dokumentation (transfervindue åbner/lukker, sæsonstart, sæsonslut)
- [ ] Første live beta-verifikation af `season start -> result approval -> season end`
- [ ] Slice UCI-R2 — lønninger skal følge UCI value-sync

---

## 📋 Planlagt (backlog)

- Aktiv feature- og forbedringsbacklog vedligeholdes i `docs/PRODUCT_BACKLOG.md`
- Team ID-mapping fra PCM
- 3-sæsoners glidende gennemsnit for rangliste
