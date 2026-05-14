# Game invariants (stabile konstanter)

Stabile rules der sjældent ændrer sig. Hvis du redigerer økonomi-kode, race-resultat-flow eller upload-håndtering — tjek herinde først.

Flyttet fra `NOW.md` 2026-05-14 (Phase 4 af `scalable-wobbling-blossom`) for at holde NOW.md som ren ephemeral status.

## Kritiske invarianter

- **Verificér runtime før claims** — runtime > docs. Doks går stale; koden er sandheden.
- **Economy-konstanter:**
  - `DEFAULT_BETA_BALANCE = 800_000`
  - `sponsor = 240_000`
  - `SALARY_RATE = 0.10`
  - Gældsloft: D1 = 1.2M · D2 = 900K · D3 = 600K
- **Auction finalization** har parallelle paths i `api.js` og `cron.js`; begge skal delegere til `auctionFinalization.js` — ikke duplikere logik.
- **AI/bank/frozen får aldrig board-state** — board features er manager-only.
- **Admin-resultatupload** — `/api/admin/import-results` skal fortsat modtage multipart `file`, `race_id`, `stage_number` og holde Excel-filer i memory med 10 MB loft.

## Ved ændring

Hvis nogen invariant skal ændres: opdatér både her, relevant kode-fil, og `docs/decisions/` ADR hvis det er en strategisk beslutning (fx sponsor-niveau).
