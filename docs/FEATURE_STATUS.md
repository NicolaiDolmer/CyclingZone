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
- Auktionshistorik-side
- Discord-notifikationer ved sæsonevents

### Transfers
- Opret transfer-liste
- Tilbud → accepter / afvis / modtilbud
- Swap-forslag med kontantjustering + modtilbud
- Trækker tilbud tilbage (withdraw) inklusive på modtilbud
- Notifikationer til sælger ved nyt tilbud

### Lån
- Manager-oprettede lån (short/long)
- Accept / afvis lånetilbud
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
- Låneoprettelsesgebyr fratrækkes kun ved accept, **ikke** løbende
- AI auktion bug: provenu ved salg af ikke-ejet rytter går til forkert manager
- Ranglisten vises ikke korrekt på dashboard/forsiden
- Squad limit håndhæves ikke korrekt
- Lånefunktion virker ikke længere

---

## 🚧 I gang

- [ ] Double-confirmation flow — begge parter godkender endeligt inden deal lukkes
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
| 1571879 | Restore admin season flow, standings recalculation og docs sync |
| a428083 | Guaranteed sale — sælg rytter til bank til 50% |
| af7257f | Withdraw på modtilbud + sælger-notifikation |
| 8dbb7f2 | manager_name på holds (signup, profil, holdside) |
| 8893790 | Fix: VITE_API_URL til board/status og board/sign |
| 1d66668 | Multi-år bestyrelsesplaner (1yr/3yr/5yr) |
