# NOW — Aktuel arbejdsstatus

> **🟢 2026-05-28 close-out ([#654](https://github.com/NicolaiDolmer/CyclingZone/issues/654)):** Resterende backend-relevante GitHub Actions Node-runtime drift rettet: `drift-monitor`, `uci_sync` og `quality-inbox` installerer nu backend-deps på Node 22, der matcher `backend/package.json` `engines.node >=22.0.0`. Verification: `backend npm ci`, backend tests 750/750, backend lint 0 errors/37 eksisterende warnings, warning-budget backend 37/38 + frontend 26/26, `git diff --check` grøn. PatchNotes ikke opdateret: intern CI/DX-only ændring uden brugerrettet app-adfærd.

> **🟢 2026-05-28 close-out ([#655](https://github.com/NicolaiDolmer/CyclingZone/issues/655)):** RiderStats mobile value-header runtime-verificeret efter locale formatter-fix: eksisterende `main`-fix (`159285e`) bruger ellipsis/nowrap i stedet for `break-all`, PatchNotes v4.04 er allerede opdateret. Verification: `frontend npm run build` grøn; targeted Playwright `rider profile value header` grøn på mobile Chromium, mobile WebKit og desktop Chromium.

> **🟢 2026-05-28 close-out ([#702](https://github.com/NicolaiDolmer/CyclingZone/issues/702)):** UCI scraperens high-value safety-gate fanger nu også matched-zero/upstream minimum-point matches (`points <= 5`) og genbruger protection-pathen i stedet for at patche stjerner ned til minimum. Verification: `python -m unittest scripts.uci_scraper_test` grøn (27/27). PatchNotes v4.10 + postmortem tilføjet; ARCHITECTURE/FEATURE_STATUS afstemt.

> **🟢 2026-05-28 PCM handoff:** Bruger har importeret `dyn-cyclist-fkIDteam-FULL-COLUMN.txt` tilbage i PCM; importen virker, og der er kørt 6 løb efter import.

> **🟢 2026-05-27 close-out ([#711](https://github.com/NicolaiDolmer/CyclingZone/issues/711)):** Blank frontend-crash fallback erstattet med DA/EN fejlside, reload-knap, Sentry event-id og `frontend_error_kind` tags. Stale lazy-chunk deploy-fejl detekteres nu og får højst én sessionStorage-gated reload pr. release. Verification: targeted chunkErrors 5/5, frontend build grøn, lint uden nye errors (kun eksisterende warnings), lokal browser smoke på `/team` → login render uden console errors. PatchNotes v4.09 + postmortem tilføjet.

> **📚 Arkiv:** Tidligere detaljer ligger i `docs/archive/NOW-2026-05-22.md` til `docs/archive/NOW-2026-05-26.md` samt relevante GitHub issues/PRs.

## Aktiv styring

> **🎯 Next action:** [#705](https://github.com/NicolaiDolmer/CyclingZone/issues/705) Supabase Key verification (Railway/Vercel) → [#701](https://github.com/NicolaiDolmer/CyclingZone/issues/701) Stale-data monitor → [#706](https://github.com/NicolaiDolmer/CyclingZone/issues/706) Chris/Vestas mapping.

> **🤖 Working agent:** _Ingen aktiv session._
