# NOW — Aktuel arbejdsstatus

> **🟢 Session 2026-05-25-A — #348 LUKKET (frontend Sentry + source-maps live):** Resten af #348 leveret. 8 Vercel prod env vars sat via [`scripts/setup-sentry-frontend.ps1`](../scripts/setup-sentry-frontend.ps1) (VITE_SENTRY_* + SENTRY_AUTH_TOKEN/ORG/PROJECT). URL-trigger commit `cdaa9d0` → Vercel build inkluderede source-map upload → verifikation via Chrome MCP navigation til `?sentry-test=1` → [CYCLINGZONE-3](https://cycling-zone.sentry.io/issues/CYCLINGZONE-3) i Sentry med fuldt unminified stacktrace (kildelinjer 45-51 i `sentry.jsx`), release-tag=`cdaa9d0`, environment=production, custom tag `verify:frontend-348`. URL-trigger fjernet igen i opfølgende commit `26ab3ee`. CYCLINGZONE-3 resolved (test-event). Doctor `sentry-config` rapporterer stadig WARN da checken kun læser lokale env vars (ikke prod-state) — spawnet task til at probe Vercel/Railway via CLI.

> **🟢 Session 2026-05-24-M+O — #614 LUKKET + Sentry ESM-init delivered:** #614 P2-A pattern landet (bd0de79), AC #4 verificeret end-to-end via Sentry MCP ([CYCLINGZONE-1](https://cycling-zone.sentry.io/issues/CYCLINGZONE-1) + 700 http-spans/h fra prod). Railway DSN sat efter arkitektur-confusion (antog Vercel-backend, men prod lever på Railway). ESM follow-up: `backend/instrument.mjs` + Node `>=22.0.0` pin (4f524d0, c39e66d) — Express auto-instrument virker (Sentry MCP viser http.server-spans for `/api/deadline-day/status` osv.). Stale Sentry-warning `[Sentry] express is not instrumented` persisterer pga false-positive — spawnet som #619 (investigation). Prod var nede ~2 min under Node-version-iteration. Postmortem opdateret + memory tilføjet (`feedback_verify_observability_pipeline_live.md`).

> **🆕 Næste session-kandidater:** [#621](https://github.com/NicolaiDolmer/CyclingZone/issues/621) Sentry hardening backlog (top: Discord-alert + user-context — ~30 min, høj ROI), [#615](https://github.com/NicolaiDolmer/CyclingZone/issues/615) (P2-B auction overlap-guard, dækket bredere af #330), [#596](https://github.com/NicolaiDolmer/CyclingZone/issues/596) sprint-metrics decision, [#532](https://github.com/NicolaiDolmer/CyclingZone/issues/532) manual sæson 0→1 validation. Bruger-decision pending: [#563](https://github.com/NicolaiDolmer/CyclingZone/issues/563) OneDrive-secret-accel.

> **⚠️ Pending bruger-actions:**
> - **#348 DSN rotation (stadig anbefalet):** Backend DSN var pastet i prior transcript. Sentry UI → Client Keys → disable+regenerate, derefter `railway variables --service CyclingZone --set "SENTRY_DSN=<ny>"`. Frontend bruger samme DSN (public-by-design embedded i bundle), så ny DSN skal også sættes på Vercel via `pwsh -File scripts/setup-sentry-frontend.ps1 -OverwriteExisting`.
> - **#619 (stale Sentry warning):** Investigation om false-positive `[Sentry] express is not instrumented` warning — auto-instrument virker faktisk per MCP, men warning logger ved hver startup. Lav prioritet.
> - **Session N (#339):** (1) slet residual cert-manager "Cycling Zone" workspace i Infisical, (2) enable 2FA på Infisical-konto, (3) tjek EU/gmail Infisical-konto. Detaljer: [`.claude/learnings/2026-05-22-infisical-cert-manager-workspace-trap.md`](../.claude/learnings/2026-05-22-infisical-cert-manager-workspace-trap.md).
> - **Session B (#550, v3.89):** (1) rotér Discord webhook URLs i Discord, (2) test AdminPage Discord-fane → maskerede URLs + Test-knap, (3) tjek Railway-logs for `[discord-dm:`-entries efter en auktion-event. Detaljer: [`docs/archive/NOW-2026-05-22.md`](archive/NOW-2026-05-22.md).
> - **Session A (#601):** Admin-verify ved næste reelle sæsonskift → bekræft PayrollSummaryTable vises med 4 kategori-rækker (Lånerenter/Lønninger/Nødlån/Renter på negativ balance). Invariant-test låser count-konsistens, men UI er kun smoke-testet.

> **🟢 Session 2026-05-24-N — github-housekeeping audit:** 17 closes (største batch til dato): #383, #501, #508, #521, #524, #535, #547, #549, #565, #567, #589, #590, #591, #597, #598, #607, #608 — alle backend/docs/CI med PR på main + ingen UI at verify. #521 label-konflikt (todo+done) ryddet. #505 escalation-ping (admin race_points editor, 103h). 3 STRONG <24h (#577/578/579) afventer 24h-tærskel. 4/4 skill self-improvement edits applied (author-tracking-begrænsning, NO_COMMENTS+PR+backend auto-suggest, STRONG-timestamp, PYTHONUTF8=1). Done-pile 20→8. Artifact: `.claude/audits/audit-2026-05-24.md`.

> **📚 Tidligere sessions arkiveret:** 2026-05-22-A til Q i [`docs/archive/NOW-2026-05-22.md`](archive/NOW-2026-05-22.md). 2026-05-23-A til O i [`docs/archive/NOW-2026-05-23.md`](archive/NOW-2026-05-23.md). 2026-05-24-A til L i [`docs/archive/NOW-2026-05-24.md`](archive/NOW-2026-05-24.md).

## Aktiv styring

> **🎯 Next action:** **Bruger:** DSN-rotation (~30 sek, se pending-actions). Derefter session-kandidater: [#615](https://github.com/NicolaiDolmer/CyclingZone/issues/615) P2-B auction overlap-guard, [#596](https://github.com/NicolaiDolmer/CyclingZone/issues/596) sprint-metrics, eller [#619](https://github.com/NicolaiDolmer/CyclingZone/issues/619) Sentry warning-investigation.
>
> _Format (max 2 linjer): `<#issue eller fil-path> — <1-sætnings opgave>`. Cross-device handoff PC1↔mobil↔PC2._

> **🤖 Working agent:** _Ingen aktiv session._
>
> _Format: `<agent> · <kanal> · <PC> · <ISO-tid CET>`. Multi-AI claim. Opdatér ved session-start; nulstil til "Ingen aktiv session" ved close-out._
