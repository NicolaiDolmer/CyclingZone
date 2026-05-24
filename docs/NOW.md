# NOW — Aktuel arbejdsstatus

> **🟢 Session 2026-05-24-M — #614 P2-A Sentry per-team capture i 5 crons KOMPLET:** Gold-standard pattern fra `dailySeasonCountCheck` replikeret i 5 crons (#2 deadlineDayReport, #3 squadEnforcement, #5 checkDebtWarnings, #6 boardAutoAccept, #7 boardMidSeason). Hver cron accepterer nu optional `captureExceptionFn` der kaldes ved per-team try/catch med `{ tags: { cron: "<name>" }, extra: { teamId, ...context } }`. `backend/cron.js` wrappers passer `sentryCapture`. **741/741 backend tests pass (+7 nye).** Issue-bodyens cron-liste indeholdt typo (`processSeasonAutoTransitionCron` vs `processSquadEnforcementCron`) — krydsrefereret med audit-doc og rettet til de korrekte 5 (#4 har allerede ✅ observability via trackedTick). CRON_AUDIT_2026-05-24.md P2-A 🔴→✅ + matrix + 5 per-cron observability ⚠️→✅. Backend-only → PatchNotes skipped. Pre-flight `npm run sync-deps` fixede `ws`-drift før test-run (forward-guard fra #618 virker). AC #4 (post-deploy Sentry-verify) pending bruger.

> **🆕 Næste session-kandidater:** [#615](https://github.com/NicolaiDolmer/CyclingZone/issues/615) (P2-B auction overlap-guard, dækket bredere af #330), [#596](https://github.com/NicolaiDolmer/CyclingZone/issues/596) sprint-metrics decision, [#532](https://github.com/NicolaiDolmer/CyclingZone/issues/532) manual sæson 0→1 validation. Bruger-decision pending: [#563](https://github.com/NicolaiDolmer/CyclingZone/issues/563) OneDrive-secret-accel.

> **⚠️ Pending bruger-actions:**
> - **Session M (#614, AC #4):** Verificér Sentry-dashboard modtager events ved forced/transient prod-fail efter `SENTRY_DSN` aktiveret (#348). Luk #614 efter verify.
> - **Session N (#339):** (1) slet residual cert-manager "Cycling Zone" workspace i Infisical, (2) enable 2FA på Infisical-konto, (3) tjek EU/gmail Infisical-konto. Detaljer: [`.claude/learnings/2026-05-22-infisical-cert-manager-workspace-trap.md`](../.claude/learnings/2026-05-22-infisical-cert-manager-workspace-trap.md).
> - **Session B (#550, v3.89):** (1) rotér Discord webhook URLs i Discord, (2) test AdminPage Discord-fane → maskerede URLs + Test-knap, (3) tjek Railway-logs for `[discord-dm:`-entries efter en auktion-event. Detaljer: [`docs/archive/NOW-2026-05-22.md`](archive/NOW-2026-05-22.md).
> - **Session A (#601):** Admin-verify ved næste reelle sæsonskift → bekræft PayrollSummaryTable vises med 4 kategori-rækker (Lånerenter/Lønninger/Nødlån/Renter på negativ balance). Invariant-test låser count-konsistens, men UI er kun smoke-testet.

> **📚 Tidligere sessions arkiveret:** 2026-05-22-A til Q i [`docs/archive/NOW-2026-05-22.md`](archive/NOW-2026-05-22.md). 2026-05-23-A til O i [`docs/archive/NOW-2026-05-23.md`](archive/NOW-2026-05-23.md). 2026-05-24-A til L i [`docs/archive/NOW-2026-05-24.md`](archive/NOW-2026-05-24.md).

## Aktiv styring

> **🎯 Next action:** [#615](https://github.com/NicolaiDolmer/CyclingZone/issues/615) P2-B auction overlap-guard (backend-only, lav prioritet — dækket bredere af #330). Alternativer: [#596](https://github.com/NicolaiDolmer/CyclingZone/issues/596), [#532](https://github.com/NicolaiDolmer/CyclingZone/issues/532). Parallel run unblocked — backend/docs candidates via `scripts/find-parallel-candidates.ps1`.
>
> _Format (max 2 linjer): `<#issue eller fil-path> — <1-sætnings opgave>`. Cross-device handoff PC1↔mobil↔PC2._

> **🤖 Working agent:** _Ingen aktiv session._
>
> _Format: `<agent> · <kanal> · <PC> · <ISO-tid CET>`. Multi-AI claim. Opdatér ved session-start; nulstil til "Ingen aktiv session" ved close-out._
