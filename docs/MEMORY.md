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

### Slice 14 — UCI-historik og stats-udvikling (status 2026-04-28)

**Del B ✅ FÆRDIG:** Supabase-tabeller `rider_uci_history` og `rider_stat_history` oprettet. `sheetsSync.js` og `dynCyclistSync.js` logger historikrækker ved hver sync.

**Del A ✅ FÆRDIG:** UCI scraper er hardenet til top 3000. Root cause var PCS pretty URL, der ignorerede `?offset=100`; scraperen bruger nu `rankings.php?p=me&s=uci-individual&offset=...`. Live workflow_dispatch `25053357290` skrev 3000 rækker til Google Sheets, synkroniserede Supabase og loggede 1000 `rider_uci_history` rækker. Done proof ligger i `docs/archive/UCI_R1_SCRAPER_TOP_3000_DONE_PROOF.md`.

**Del C ⏳ IKKE STARTET:** Frontend-visualisering på `RiderStatsPage.jsx`.

**UCI-R2 ✅ FÆRDIG:** GitHub Actions workflowet kører `backend/scripts/recalculateRiderSalaries.js` efter UCI scraperen. Scriptet bruger `updateRiderValues`, så `riders.salary` følger nye `uci_points` uden at UCI-sync nulstiller `prize_earnings_bonus`. Regressionen ligger i `backend/lib/economyEngine.test.js`.

#### Del A — Scraper-arkitektur
- Script: `scripts/uci_scraper.py`
- Dependencies: `scripts/requirements_uci.txt`
- Workflow: `.github/workflows/uci_sync.yml` — cron mandag 06:00 UTC
- Kilde: ProCyclingStats `rankings/me/uci-individual`
- Output: Google Sheets `1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic` + Supabase REST
- GitHub secrets: `UCI_GOOGLE_SERVICE_ACCOUNT_JSON`, `UCI_GOOGLE_SHEET_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- Service account: cycling-zone@cycling-zone.iam.gserviceaccount.com

#### Del C — Frontend-spec
**Fil:** `frontend/src/pages/RiderStatsPage.jsx`

**Kræver:** `cd frontend && npm install recharts`

**Ny tab** tilføjes efter "Historik": `{ key: "udvikling", label: "Udvikling" }`

**Data via Supabase direkte:**
```js
// UCI historik
supabase.from("rider_uci_history")
  .select("uci_points, synced_at")
  .eq("rider_id", id).order("synced_at", { ascending: true }).limit(104)

// Stats historik
supabase.from("rider_stat_history")
  .select("synced_at, stat_fl, stat_bj, ...")
  .eq("rider_id", id).order("synced_at", { ascending: true }).limit(52)
```

**Tab-indhold:**
1. Recharts LineChart: UCI-points over tid (X=dato, Y=points, farve #e8c547)
2. Stat-dropdown + LineChart: vælg én af 14 stats, vis udvikling (farve blue-400)
3. Tom-state: "Ingen historik endnu — data akkumuleres fra næste ugentlige sync"

**Styling:** `bg-white border border-slate-200 rounded-xl p-5`

**Regel:** Del C bygges først når Del A har kørt succesfuldt mindst én gang.
