# PRODUCT BACKLOG — Cycling Zone

_Kanonisk, token-effektiv roadmap. Ingen done-historik her — kun fremadskuende slices og kandidater._
_Færdige detaljer bor i `docs/FEATURE_STATUS.md` og `docs/archive/`._

---

## Pre-launch roadmap

**S6 ✅ lukket (v1.78)** — onboarding MVP, navn-wizard, velkomstmodal.

### S7 — Launch readiness (aktiv)
**Status:** Gate 1+2+3+4+6+7 ✅ · Gate 5 🔒 7/5  
**Næste session:** Gate #5 (salary/dyn sync) → start ny sæson → open beta live.  
Se `docs/NOW.md` for detaljeret tjekliste.

---

## Post-launch queue

### Deadline Day — 4-session feature (parallel med S8+)

**Vision:** 24-timers oplevelse med 3 faser (anticipation → pressure → chaos) der aktiveres automatisk når transfervinduet nærmer sig lukketid. Live feed, holdoversigt og eksklusive mekanikker.

**S1 ✅ (2026-05-02):** Fundament live
- `DeadlineDayBanner` — fase-aware countdown i Layout (amber/rød/pulserende)
- Admin toggle: auto/tændt/slukket + `closes_at` input på transfervindue
- DB: `transfer_windows.closes_at`, `auction_timing_config.deadline_day_override`
- Backend: `GET /api/deadline-day/status`, `PUT /api/admin/deadline-day/override`, `PUT /api/admin/transfer-window/closes-at`
- **Test nu:** AdminPage → sæt "Tændt" for at se banneret

**S2 ✅ (2026-05-02):** Ticker + Panic Board live
- `GET /api/deadline-day/ticker` + `DeadlineDayTicker` — horisontal scrollende feed (10s poll, fixed bottom)
- `GET /api/deadline-day/squads` + `DeadlineDayBoard` (`/deadline-day`) — grøn/gul/rød squad-status (30s poll)

**S3 ✅ (2026-05-02):** Flash Auction + hastebudsignal live
- Flash Auktion: 30-min varighed under Deadline Day — guard i `POST /api/auctions`, `is_flash` kolonne i DB
- Hastebudsignal: 🚨-badge på modtagne og sendte tilbud når sælgerhold er ≤ divisionsminimum

**S4 ✅ (2026-05-02):** Notifikationer + Final Whistle-rapport live
- Planlagte advarsler T-24h/T-2h/T-30min via cron (5-min interval) → `notifyTeamOwner` med dedupe på (window_id, step-titel)
- Final Whistle: atomic claim på `transfer_windows.final_whistle_sent_at` → største handel + mest aktive manager + panikhandler → Discord embed til default webhook
- Pure functions i `backend/lib/deadlineDayReport.js`, orkestrering i `backend/cron.js`

---

### S8 — Discord DM & Manager-rename
**Trigger:** Umiddelbart efter beta-lancering  
**Scope:**
- Discord Bot setup (bot-token i Vercel env) — webhooks kan ikke sende DMs; Bot kræves
- `discordNotifier.js`: tilføj `sendDM(discordId, embed)` ved siden af webhook-logik
- Discord-status synlig på `ProfilePage` (grøn checkmark / rød mangler-badge)
- Dashboard-nudge til managers uden `users.discord_id`

**Kritiske filer:** `backend/lib/discordNotifier.js` · `frontend/src/pages/ProfilePage.jsx` · `frontend/src/pages/DashboardPage.jsx` · `backend/routes/api.js`

---

### S8.5 — Løbsresultat-import UX (delvist leveret)
**Trigger:** Uge 1–2 efter lancering  
**Leveret (v1.98):** Præmieudbetaling adskilt fra import — admin-kontrolleret, preview før udbetaling, `races.prize_paid_at` tracker status.  
**Resterende scope:** Import-feedback UI — ingen synlig matchrapport ved filupload (hvilke ryttere matchede eksakt vs. fuzzy, hvilke løb blev skippet). Overvej preview-tilstand til `POST /api/admin/import-results-sheets` der returnerer diff uden at committe.  
**Næste skridt:** Kan starte direkte — kravene er nu klare fra session 2026-05-02.

---

### S9 — Løb & Info-sider
**Trigger:** Uge 2–3 efter lancering  
**Scope:**
- `/race-library` — alle løb i DB, søgbar/filtrerbar (navn, klasse, sæson, status)  
  Backend: udvid `GET /api/races?season=&class=&q=`
- `/seasons/:seasonId` — kalender for afsluttet sæson (ikke kun aktiv)  
  Frontend: ny `SeasonCalendarPage.jsx`
- Point-oversigt — `race_points` tabel synlig for managers; ny `GET /api/race-points` public route
- Præmie-oversigt — forklarer `points × 15.000 CZ$`-formlen med eksempler

**Kritiske filer:** `backend/routes/api.js` · `frontend/src/pages/RaceArchivePage.jsx` · `frontend/src/App.jsx`

---

### S10 — Admin økonomi-panel
**Trigger:** Uge 3–4 efter lancering  
**Scope:**
- `GET /api/admin/teams-economy-summary` — per-hold: balance, sponsor-base, budget_modifier, gæld
- `GET /api/admin/prize-summary?seasonId=` — præmiepenge per hold per sæson
- Ny "Økonomi"-tab i `AdminPage.jsx`

**Kritiske filer:** `backend/routes/api.js` · `frontend/src/pages/AdminPage.jsx`

---

- **Economy tuning iteration** — baseret på live data fra første beta-sæson; salary rate, sponsor, debt ceilings
- **Season countdown + dashboard UX** — ✅ leveret v1.88
- **Manager cross-season statistik** — fuld historik og vækst over sæsoner fra `board_plan_snapshots` og `season_standings`
- **XLSX security advisory** — evaluer og patch eller erstat `xlsx`-pakken (high-severity advisory)
- **Onboarding v2** — progressiv disclosure af bestyrelses- og økonomi-kompleksitet; guided squad-builder
- **Inbox/activity consolidation v2** — trigger: launch-critical flows er stabile; ingen chat mellem managers

---

## Data Depth Candidates

- **Teams PCM mapping** — trigger: økonomi og season-flow er stabile
- **Cyclists PCM mapping** — trigger: sammen med eller efter team mapping
- **3-sæsoners glidende rangliste** — trigger: kræver mindst 3 sammenlignelige sæsoner med data

---

## Engagement + Polish Candidates

- **Discord-name matching** — trigger: managerprofil/presence poleres
- **Richer notification filters** — trigger: efter inbox IA er låst
- **Dark mode decision** — trigger: design/IA-afklaring før UI-retuning
- **Secret achievement presentation audit** — trigger: hvis runtime viser achievements før unlock

---

## Locked Product Defaults

- `Liga` beholdes som navn indtil videre
- Managers kan ikke sende beskeder til hinanden
- `Min aktivitet` forbliver separat side under `Marked`
- `Indbakke` er kun til systemhændelser og notifikationer
- Garanteret salg: eneste undtagelse til minimum-startpris-reglen (50% af Værdi)
- Første bud på AI-/bank-/fri rytter-auktion = initiatorens implicitte vinderposition; gælder også legacy-auktioner
- Økonomi: **stram men fair** — ikke let beta-start, ikke hardcore sim
- Konkrete økonomi-tal vælges baseret på live data + simulation

---

## Archived Done Proof

- `docs/archive/UCI_R1_SCRAPER_TOP_3000_DONE_PROOF.md`
- `docs/archive/RECENT_DONE_PROOF_2026-04-29.md`
- `docs/archive/ECONOMY_BASELINE_SIMULATION_2026-04-29.md`
- `docs/archive/SEASON_6_REPAIR_VERIFICATION_2026-04-29.md`
- Runtime feature truth: `docs/FEATURE_STATUS.md`
