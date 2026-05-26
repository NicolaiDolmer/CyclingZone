# NOW — Aktuel arbejdsstatus

> **🟢 2026-05-27 close-out (#638):** `sanitize-secrets` regression guard tilføjet for `openssl rand -hex 2`/kort hex-output, og PowerShell-testen resolver nu Git Bash eksplicit. Verification: sanitizer-suite 32/32 grøn + hook-suite 16/16 grøn. PatchNotes/FEATURE_STATUS ikke opdateret: intern agent-tooling.

> **🟢 2026-05-26 close-out (#656):** Authenticated prod i18n-smoke på `/riders`, `/riders/:id`, `/notifications`, `/team`: EN/DA toggle grøn på desktop + mobile, ingen synlige raw keys; issue lukket med matrix; screenshots flyttet fra `.codex.local` til OneDrive-context `codex-local/issue-656-i18n-smoke/`. PatchNotes/FEATURE_STATUS ikke opdateret: runtime-verificering only.

> **🟢 2026-05-26 close-out (#689):** `scripts/agent-doctor.ps1` label/Sentry-probe edge-cases rettet; targeted checks + Sentry-probe tests grønne. PatchNotes/FEATURE_STATUS ikke opdateret: intern agent-tooling.

> **🟢 2026-05-26 close-out (#646):** AuctionsPage mobile smoke-snapshot stabiliseret med route-readiness gate; repeat smoke grøn. CI-observation over 3 PR merges mangler stadig.

> **🟢 2026-05-26 close-out (#652):** `auctionLogic` regression coverage tilføjet; targeted test, frontend test-suite og lint grønne. PatchNotes ikke opdateret: test-only.

> **📚 Arkiv:** Tidligere detaljer ligger i `docs/archive/NOW-2026-05-22.md` til `docs/archive/NOW-2026-05-26.md` samt relevante GitHub issues/PRs.

## Aktiv styring

> **🎯 Next action:** **Bruger-verifikation** af [#697](https://github.com/NicolaiDolmer/CyclingZone/issues/697) mobile-nav på prod (kun mobil — kør på telefon). Derefter [#452](https://github.com/NicolaiDolmer/CyclingZone/issues/452) tilmeld-knap eller [#667](https://github.com/NicolaiDolmer/CyclingZone/issues/667) dyn_cyclist (Excel klar; lokalisér fil + afklar hold-ID mapping hvis runtime tvetydig). Lavprioritet post-TdF: [#694](https://github.com/NicolaiDolmer/CyclingZone/issues/694) + [#695](https://github.com/NicolaiDolmer/CyclingZone/issues/695). Pending bruger-actions: #355 MCP-disconnect, #621 item 1 Sentry Discord-alert, NICOLAIPC Infisical bootstrap (#327 Phase 5E) + trace-verify for #684. **Optional follow-up:** Clarity cross-check på retention-cohort (se [`docs/research/retention-cohort-may-2026.md`](research/retention-cohort-may-2026.md), refs #670).
>
> _Format: `<#issue eller fil-path> — <1-sætnings opgave>`. Cross-device handoff PC1↔mobil↔PC2._

> **🤖 Working agent:** _Ingen aktiv session._
>
> _Nulstil til "Ingen aktiv session" ved close-out._
