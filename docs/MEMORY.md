# MEMORY — Kontekst til AI-assistenter

Denne fil er git-tracked spejl af Claude Code's memory-system og supplerende kontekst til Codex og andre AI-assistenter. Opdateres løbende.

---

## Feedback — arbejdsstil

### Push følger commit automatisk
Push efter commit uden at spørge. Commit → push er én operation.

**Why:** Bruger spurgte "hvorfor spørger du om dette?" da AI bad om bekræftelse på push.

**How to apply:** Når brugeren beder om commit, push til remote med det samme — ingen bekræftelsesspørgsmål.

---

## Projekt-kontekst

### Slice 14 — UCI-historik og stats-udvikling (status 2026-04-29)

**Del B ✅ FÆRDIG:** Supabase-tabeller `rider_uci_history` og `rider_stat_history` oprettet. `sheetsSync.js` og `dynCyclistSync.js` logger historikrækker ved hver sync.

**Del A ✅ FÆRDIG:** UCI scraper er hardenet til top 3000. Root cause var PCS pretty URL, der ignorerede `?offset=100`; scraperen bruger nu `rankings.php?p=me&s=uci-individual&offset=...`. Live workflow_dispatch `25053357290` skrev 3000 rækker til Google Sheets, synkroniserede Supabase og loggede 1000 `rider_uci_history` rækker. Done proof ligger i `docs/archive/UCI_R1_SCRAPER_TOP_3000_DONE_PROOF.md`.

**Del C ✅ FÆRDIG:** Frontend-visualisering er implementeret på `RiderStatsPage.jsx` via lazy-loaded `RiderDevelopmentTab.jsx`; `frontend/package.json` har `recharts`.

**UCI-R2 ✅ FÆRDIG:** GitHub Actions workflowet kører `backend/scripts/recalculateRiderSalaries.js` efter UCI scraperen. Scriptet bruger `updateRiderValues`, så `riders.salary` følger nye `uci_points` uden at UCI-sync nulstiller `prize_earnings_bonus`. Regressionen ligger i `backend/lib/economyEngine.test.js`.

#### Del A — Scraper-arkitektur
- Script: `scripts/uci_scraper.py`
- Dependencies: `scripts/requirements_uci.txt`
- Workflow: `.github/workflows/uci_sync.yml` — cron mandag 06:00 UTC
- Kilde: ProCyclingStats `rankings/me/uci-individual`
- Output: Google Sheets `1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic` + Supabase REST
- GitHub secrets: `UCI_GOOGLE_SERVICE_ACCOUNT_JSON`, `UCI_GOOGLE_SHEET_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- Service account: cycling-zone@cycling-zone.iam.gserviceaccount.com

#### Del C — Done proof
- `frontend/src/pages/RiderStatsPage.jsx` har `Udvikling`-tab efter Historik.
- `loadDevelopmentHistory()` henter `rider_uci_history` og `rider_stat_history`.
- `frontend/src/components/RiderDevelopmentTab.jsx` viser Recharts-linjegrafer for UCI-point og valgt stat samt seneste datapunkter.
- `frontend/package.json` har `recharts`.

### Launch roadmap efter docs cleanup (status 2026-04-29)

1. Season-flow sanity before economy tuning.
2. Economy baseline & simulation.
3. Economy tuning implementation.
4. Post-economy launch readiness med Data Depth-kandidater.

Økonomi-target er **stram men fair**. Konkrete økonomital vælges først efter live read-only data og simulation.
