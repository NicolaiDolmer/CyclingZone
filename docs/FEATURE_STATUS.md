# FEATURE STATUS

_Udled fra kodebasen. Opdatér ved større ændringer._

---

## ✅ Implementeret & live

### Auth & Brugere
- Login / logout via Supabase Auth
- Admin- og managerroller
- Login-streak tracking
- Manager XP + niveauer (level = floor(xp/100)+1, max 50)
- Manager-profil med historik

### Hold & Ryttere
- Holdoversigt og holdprofil-sider
- Rytterbibliotek med søgning + filtre (nation, UCI, U25, ledig, osv.)
- Rytterdetalje-side (stats, historik, watchlist-tæller)
- Rytter-sammenligning (side-by-side)
- Watchlist
- Stat-grid med farvekodning (statBg.js)

### Auktioner
- Opret auktion med starttid + vindueslogik
- Bud-placering med auto-forlængelse (10 min ved bud nær slut)
- Garanteret salg (startpris = 50% af UCI-pris)
- Auktionsfinalisering via cron (60s interval)
- Delt auktionsfinalisering for cron + admin/API, så payout og transfer-window følger samme runtime-path
- Squad-limit ved auktionsfinalisering tæller også ventende handler og aktive indlån
- Auktionshistorik-side
- Discord-notifikationer ved sæsonevents

### Transfers
- Opret transfer-liste
- Tilbud → accepter / afvis / modtilbud
- Swap-forslag med kontantjustering + modtilbud
- Endelig transfer-/swap-bekræftelse kører nu via delt backend-path med commit-time checks for ejerskab, saldo og squad-limit
- Gennemførte handler rydder nu relaterede transfer-lister, transferbud og swapforslag op for involverede ryttere
- Trækker tilbud tilbage (withdraw) inklusive på modtilbud
- Notifikationer til sælger ved nyt tilbud

### Lån
- Manager-oprettede lån (short/long)
- Accept / afvis lånetilbud
- Lejeforslag og låneaktivering stopper nu hvis lånerens squad-limit allerede er brugt op
- Lejegebyr på aktive rider-lån trækkes ved aktivering og derefter ved hver dækket sæsonstart
- Låneoversigt (aktive + egne)
- Låneafdrag
- Auto-nødlån ved manglende løn

### Økonomi & Finans
- Sponsorindtægt ved sæsonstart (med board-modifier)
- Lønudbetaling ved sæsonslut
- Renteberegning på negativ saldo (10%/sæson)
- Præmiefordeling ved løbsimport (stage/GC/points/mountain/team/young)
- Finance-transaktionslog + Finance-side
- Balance-justering (admin)

### Sæson & Løb
- Sæsonoversigt med race-kalender
- Løbsresultater-import (Excel-upload i admin)
- Pointtavle (season_standings) recalculeres fra `race_results`
- Dashboard og Hold-siden scope'er nu current-season standings korrekt og falder tilbage til 0-point-rækker før første result-godkendelse
- Opryknings/nedrykningslogik (top/bund 2 per division)
- Sæsonpreview-side
- Races-side

### Bestyrelse (Board)
- Bestyrelsesprofil med plan + focus + tilfredshed
- Plantyper: 1yr / 3yr / 5yr
- Focustyper: youth_development / star_signing / balanced
- Kumulativ mål-tracking (stage wins, GC wins, sponsorvækst)
- Satisfaction → budget_modifier (sponsor-multiplikator)
- Mid-plan review besked (ved 50% af planvarighed)
- Board plan snapshots per sæson
- Board wizard (sign new plan)

### Admin
- Import af ryttere (Python-script)
- Import af løbsresultater (xlsx upload)
- UCI points sync (Google Sheets CSV)
- Override rider (team/stats)
- Sæsonoprettelse, sæsonstart og sæsonslut-routes i backend
- Løbsoprettelse via admin-backend route
- Season-end preview endpoint

### UI / Misc
- Responsivt layout med navigation (Layout.jsx)
- Notifikationssystem (in-app + badge)
- Aktivitets-feed
- Head-to-head sammenligning
- Hall of Fame
- Patch notes
- Hjælpeside
- Confetti modal

---

## 🔴 Broken / Kendte bugs

- Achievements tæller ikke korrekt
- Dropdown tekst usynlig (Tailwind farvekonflikt i select-elementer)

--- 

## 🚧 I gang

- [ ] Event-sekvens dokumentation (transfervindue åbner/lukker, sæsonstart, sæsonslut)
- [ ] Første live beta-verifikation af `season start -> result approval -> season end`
- [ ] Verificér dashboard/rangliste mod ny standings-recalculation efter første live sæsonflow

---

## 📋 Planlagt (backlog)

- Aktiv feature- og forbedringsbacklog vedligeholdes i `docs/PRODUCT_BACKLOG.md`
- Landekode-mapping til flag-visning
- Team ID-mapping fra PCM
- 3-sæsoners glidende gennemsnit for rangliste
- Tre parallelle bestyrelsesplaner (1yr+3yr+5yr vist samtidigt) — udskudt

---

## Versionshistorik (nyeste øverst)

| Commit | Feature |
|--------|---------|
| 667827e | Scope current-season standings på Dashboard og Hold-siden med 0-point fallback |
| 1571879 | Restore admin season flow, standings recalculation og docs sync |
| a428083 | Guaranteed sale — sælg rytter til bank til 50% |
| af7257f | Withdraw på modtilbud + sælger-notifikation |
| 8dbb7f2 | manager_name på holds (signup, profil, holdside) |
| 8893790 | Fix: VITE_API_URL til board/status og board/sign |
| 1d66668 | Multi-år bestyrelsesplaner (1yr/3yr/5yr) |
