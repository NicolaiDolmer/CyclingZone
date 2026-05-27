# NOW — Aktuel arbejdsstatus

> **🟢 2026-05-27 close-out ([#667](https://github.com/NicolaiDolmer/CyclingZone/issues/667), PR [#703](https://github.com/NicolaiDolmer/CyclingZone/pull/703)):** dyn_cyclist fkIDteam sync Fase 1 — migration backfilder `teams.ai_source_id` for 17 manager-hold (PCM-ID-mapping i DB), `scripts/sync-dyn-cyclist-teams.mjs` genererer paste-ready full column med cz-assignment + cleanup-evict regel. End-state: 16/17 PCM-tracked teams matcher CZ-roster præcis (1 mismatch: Marco Tizza pcm_id=4044 mangler i ark). 482 ændringer i Downloads/`dyn-cyclist-fkIDteam-FULL-COLUMN.txt`. Audit-row `b4db5225-...`. Mikkel Bjerg→14, Brunel→13 verificeret. Follow-ups: [#704](https://github.com/NicolaiDolmer/CyclingZone/issues/704) Fase 2 /admin UI (vent på race-engine), [#705](https://github.com/NicolaiDolmer/CyclingZone/issues/705) **CRITICAL SUPABASE_SERVICE_KEY legacy-disabled**, [#706](https://github.com/NicolaiDolmer/CyclingZone/issues/706) Chris/Vestas mapping.

> **🟢 2026-05-27 close-out (PR [#700](https://github.com/NicolaiDolmer/CyclingZone/pull/700)):** UCI scraper decimal-points fix — `procyclingstats` library returnerede stille `points: 0` for top-ryttere med decimaltal (Vingegaard 6885.1 → 0, etc.), hvilket downgraded 319 ryttere til 5 UCI-point i morges scheduled sync. Patch parser nu rå PCS-HTML for at recovere decimaler; fix-sync via workflow_dispatch genopretede 296 ryttere. PR merged til main med admin override (kendt mobile-webkit auctions flake urelateret). PatchNotes 4.05 + postmortem `.claude/learnings/2026-05-27-uci-scraper-decimal-points-bug.md`. **Spillerne kan byde igen.** Follow-ups åbnet: [#701](https://github.com/NicolaiDolmer/CyclingZone/issues/701) backup-trigger + monitoring, [#702](https://github.com/NicolaiDolmer/CyclingZone/issues/702) safety-gate matched-with-zero.

> **🟢 2026-05-27 close-out (#649):** Country names on rider surfaces now follow active i18next locale via `Intl.DisplayNames`; `/riders` filter dropdown/chip and `/riders/:id` nationality line fixed, plus localized sort and regression coverage. PR [#699](https://github.com/NicolaiDolmer/CyclingZone/pull/699) merged til main (PatchNotes bumpet til v4.06 efter kollision med PR #700's v4.05). Verification: `countryUtils` targeted 11/11, frontend tests 116/116, frontend build green, Playwright `core-smoke.spec.js` 12/12 grøn på alle 3 projekter efter refresh af pre-existing `mobile-webkit auctions` baseline (#646 follow-up).

> **🟢 2026-05-27 close-out (#638):** `sanitize-secrets` regression guard tilføjet for `openssl rand -hex 2`/kort hex-output, og PowerShell-testen resolver nu Git Bash eksplicit. Verification: sanitizer-suite 32/32 grøn + hook-suite 16/16 grøn. PatchNotes/FEATURE_STATUS ikke opdateret: intern agent-tooling.

> **🟢 2026-05-26 close-out (#656):** Authenticated prod i18n-smoke på `/riders`, `/riders/:id`, `/notifications`, `/team`: EN/DA toggle grøn på desktop + mobile, ingen synlige raw keys; issue lukket med matrix; screenshots flyttet fra `.codex.local` til OneDrive-context `codex-local/issue-656-i18n-smoke/`. PatchNotes/FEATURE_STATUS ikke opdateret: runtime-verificering only.

> **🟢 2026-05-26 close-out (#689):** `scripts/agent-doctor.ps1` label/Sentry-probe edge-cases rettet; targeted checks + Sentry-probe tests grønne. PatchNotes/FEATURE_STATUS ikke opdateret: intern agent-tooling.

> **🟢 2026-05-26 close-out (#646):** AuctionsPage mobile smoke-snapshot stabiliseret med route-readiness gate; repeat smoke grøn. CI-observation over 3 PR merges mangler stadig.

> **🟢 2026-05-26 close-out (#652):** `auctionLogic` regression coverage tilføjet; targeted test, frontend test-suite og lint grønne. PatchNotes ikke opdateret: test-only.

> **📚 Arkiv:** Tidligere detaljer ligger i `docs/archive/NOW-2026-05-22.md` til `docs/archive/NOW-2026-05-26.md` samt relevante GitHub issues/PRs.

## Aktiv styring

> **🎯 Next action:** **Bruger paster `dyn-cyclist-fkIDteam-FULL-COLUMN.txt` ind i sheet E2** (verificér Mikkel Bjerg row 1209 = 14, Brunel row 6971 = 13) → importér ark tilbage i PCM for sæson 1. Derefter højest prioritet: [#705](https://github.com/NicolaiDolmer/CyclingZone/issues/705) **CRITICAL SUPABASE_SERVICE_KEY legacy-disabled** (kan ramme prod-backend). Også: [#702](https://github.com/NicolaiDolmer/CyclingZone/issues/702) safety-gate matched-with-zero, [#701](https://github.com/NicolaiDolmer/CyclingZone/issues/701) backup-trigger + monitoring, [#706](https://github.com/NicolaiDolmer/CyclingZone/issues/706) Chris/Vestas mapping (manager-svar), [#697](https://github.com/NicolaiDolmer/CyclingZone/issues/697) mobile-nav verify, [#452](https://github.com/NicolaiDolmer/CyclingZone/issues/452) tilmeld-knap. Pending bruger-actions: #355 MCP-disconnect, #621 item 1 Sentry Discord-alert, NICOLAIPC Infisical bootstrap (#327 Phase 5E) + trace-verify for #684. **Optional follow-up:** Clarity cross-check på retention-cohort (se [`docs/research/retention-cohort-may-2026.md`](research/retention-cohort-may-2026.md), refs #670).
>
> _Format: `<#issue eller fil-path> — <1-sætnings opgave>`. Cross-device handoff PC1↔mobil↔PC2._

> **🤖 Working agent:** _Ingen aktiv session._
>
> _Nulstil til "Ingen aktiv session" ved close-out._
