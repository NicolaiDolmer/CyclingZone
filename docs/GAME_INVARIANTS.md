# Game invariants (stabile konstanter)

Stabile rules der sjældent ændrer sig. Hvis du redigerer økonomi-kode, race-resultat-flow eller upload-håndtering — tjek herinde først.

Flyttet fra `NOW.md` 2026-05-14 (Phase 4 af `scalable-wobbling-blossom`) for at holde NOW.md som ren ephemeral status.

## Kritiske invarianter

- **Verificér runtime før claims** — runtime > docs. Doks går stale; koden er sandheden.
- **Economy-konstanter** (backend SSOT: `backend/lib/economyConstants.js`):
  - `DEFAULT_BETA_BALANCE = 800_000`
  - `sponsor = 240_000`
  - `SALARY_RATE = 0.10`
  - `MARKET_VALUE_MULTIPLIER = 4000` (× uci_points, min 5 point)
  - `PRIZE_PER_POINT = 1_500` — race_results.prize_money = points × 1500 i alle import-stier (XLSX, Google Sheets, PCM). Backend importerer fra `economyConstants.js`; frontend har sin egen kilde (`frontend/src/lib/expectedPrizeCalculator.js`) — de to codebaser kan ikke dele import, så hold dem i sync.
  - Gældsloft: D1 = 1.2M · D2 = 900K · D3 = 600K
- **Fri/AI-ryttere & præmie:** præmie optjent af ryttere uden manager-hold tæller med i deres `market_value` + `salary` (`updateRiderValues` summerer `prize_money` pr. rytter **uden** team-filter), men **udbetales aldrig** til et hold. Det er bevidst: holdsløse ryttere stiger i værdi, men ingen modtager pengene.
- **race_results.result_type — kanonisk for endags-løb = `gc`** (ikke `stage`). Matcher XLSX-stien ("general results"→gc) + engine-opslaget `single: {gc: "Klassiker"}`. result_type er kun en label; præmie afhænger af `race_points`-opslaget, ikke result_type.
- **Auction finalization** har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js` — ikke duplikere logik.
- **AI/bank/frozen får aldrig board-state** — board features er manager-only.
- **Admin-resultatupload** — `/api/admin/import-results` skal fortsat modtage multipart `file`, `race_id`, `stage_number` og holde Excel-filer i memory med 10 MB loft.

## Ved ændring

Hvis nogen invariant skal ændres: opdatér både her, relevant kode-fil, og `docs/decisions/` ADR hvis det er en strategisk beslutning (fx sponsor-niveau).
