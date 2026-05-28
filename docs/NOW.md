# NOW — Aktuel arbejdsstatus

> **🟢 2026-05-29 close-out ([#721](https://github.com/NicolaiDolmer/CyclingZone/issues/721)):** PC3 (DolmerPC) onboarding verificeret grøn arbejdsklar. agent-doctor 14 OK / 2 WARN / 1 FAIL (FAIL = repo-global `main-protection strict=False`, ikke PC3-specifik), verify-infisical grøn (dev/preview/prod matcher ADR), frontend build exit 0, MCP discord+supabase+github aktive, OneDrive memory-junction på plads. `docs/metrics/install-snapshot-DolmerPC.json` committet (`cd67035`). Follow-up: `harness-snapshot-DOLMERPC.json` mangler (uden for scope).

> **🟢 2026-05-28 close-out ([#646](https://github.com/NicolaiDolmer/CyclingZone/issues/646) / [#512](https://github.com/NicolaiDolmer/CyclingZone/issues/512)):** AuctionsPage mobile Chromium snapshot-flake hardenet ved at vente på `document.fonts.ready` + stabil `main`-layout + stabil tekst-mask element-count før visual snapshots. Verification: repro-forsøg før fix 10/10 grøn (ikke lokalt reproduceret), efter fix mobile Chromium repeat 10/10 grøn, desktop Chromium grøn, mobile WebKit grøn, ESLint/Prettier grøn; PatchNotes ikke opdateret: test-only hardening uden brugerrettet app-adfærd.

> **🟢 2026-05-28 close-out ([#701](https://github.com/NicolaiDolmer/CyclingZone/issues/701) smalt slice):** UCI stale-data monitor leveret som read-only daglig `backend/cron.js` safety-net: læser seneste `rider_uci_history.synced_at` og sender Discord+Sentry-alert ved >8 dage eller tom historik. Verification: targeted `uciStaleDataCheck`/`cron` node tests 11/11 grønne, Prettier-check grøn, backend lint 0 errors (37 eksisterende warnings). PatchNotes ikke opdateret: intern drift-monitor uden brugerrettet UI/adfærd. Backup-trigger holdes separat.

> **🟢 2026-05-28 close-out ([#655](https://github.com/NicolaiDolmer/CyclingZone/issues/655)):** RiderStats mobile value-header runtime-verificeret efter locale formatter-fix: eksisterende `main`-fix (`159285e`) bruger ellipsis/nowrap i stedet for `break-all`, PatchNotes v4.04 er allerede opdateret. Verification: `frontend npm run build` grøn; targeted Playwright `rider profile value header` grøn på mobile Chromium, mobile WebKit og desktop Chromium.

> **🟢 2026-05-28 close-out ([#702](https://github.com/NicolaiDolmer/CyclingZone/issues/702)):** UCI scraperens high-value safety-gate fanger nu også matched-zero/upstream minimum-point matches (`points <= 5`) og genbruger protection-pathen i stedet for at patche stjerner ned til minimum. Verification: `python -m unittest scripts.uci_scraper_test` grøn (27/27). PatchNotes v4.10 + postmortem tilføjet; ARCHITECTURE/FEATURE_STATUS afstemt.

> **🟢 2026-05-28 PCM handoff:** Bruger har importeret `dyn-cyclist-fkIDteam-FULL-COLUMN.txt` tilbage i PCM; importen virker, og der er kørt 6 løb efter import.

> **📚 Arkiv:** Tidligere detaljer ligger i `docs/archive/NOW-2026-05-22.md` til `docs/archive/NOW-2026-05-26.md` samt relevante GitHub issues/PRs.

## Aktiv styring

> **🎯 Next action:** [#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605) P0 AI World-Class v2 token-friendly setup → [#705](https://github.com/NicolaiDolmer/CyclingZone/issues/705) Supabase Key verification (Railway/Vercel) → [#701](https://github.com/NicolaiDolmer/CyclingZone/issues/701) backup-trigger split.

> **🤖 Working agent:** _Ingen aktiv session._
