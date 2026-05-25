# NOW — Aktuel arbejdsstatus

> **🟢 Session 2026-05-25-H — #455 NICOLAIPC live-verifikation + #455 LUKKET:** 5/5 tests kørt fra [#455](https://github.com/NicolaiDolmer/CyclingZone/issues/455) NICOLAIPC-section: 2 PASS (`weekly-memory-audit` cron registreret via MCP, next run mandag 09:02; hook scripts virker standalone), **2 FAIL identisk med EmmaPC** (`block-archived-edit.sh` tillod Write til `docs/archive/test-455-nicolaipc.md`; `check-now-md-edit.sh` tillod Edit NOW.md 25→35 linjer), 1 PASS-mekanisk/FAIL-live (gh-lint warning ikke visuelt observeret på `gh issue view 73`), 1 DEFERRED (idempotency næste session). **#385 root cause bekræftet på BÅDE PCs** — Edit|Write|NotebookEdit PreToolUse hooks fyrer ikke på nogen PC, selv om user-`~/.claude/settings.json` IKKE har Edit|Write matcher. Escalation-comment posted på [#385](https://github.com/NicolaiDolmer/CyclingZone/issues/385) med 2 hypoteser + workaround-test (split sammensat matcher → 3 entries). #455 → `claude:done` (acceptance: "fejl dokumenteret" opfyldt). Session G arkiveret.

> **🆕 Næste session-kandidater:** **🔴 Anbefalet:** [#385](https://github.com/NicolaiDolmer/CyclingZone/issues/385) Settings split + workaround-test for sammensat-matcher-bug (~1 time, blocker for fungerende Edit|Write hooks på BÅDE PCs). Andre: secret-rotation (3 keys per #634, ~30 min), [#623](https://github.com/NicolaiDolmer/CyclingZone/issues/623) PatchNotes Guard BUILD (priority:high), [#621](https://github.com/NicolaiDolmer/CyclingZone/issues/621) Sentry hardening (~30 min), [#636](https://github.com/NicolaiDolmer/CyclingZone/issues/636) MEMORY.md HOT-trim, [#632](https://github.com/NicolaiDolmer/CyclingZone/issues/632) Discord-memory-pilot, [#563](https://github.com/NicolaiDolmer/CyclingZone/issues/563) Infisical-acceleration, [#596](https://github.com/NicolaiDolmer/CyclingZone/issues/596) sprint-metrics decision, [#532](https://github.com/NicolaiDolmer/CyclingZone/issues/532) manual sæson 0→1 validation.

> **⚠️ Pending bruger-actions:**
> - **🟡 Secret rotation (efter #634):** Rotér SUPABASE_SERVICE_KEY (Supabase → Settings → API → Reset service_role; opdatér Railway + GitHub Actions). Rotér SENTRY_DSN (Sentry → Settings → Projects → Client Keys → Generate New; opdatér Vercel + Railway). Rotér DISCORD_BOT_TOKEN (Discord Developer Portal → Reset Token; opdatér Railway). Verify: `pwsh -File scripts/verify-deploy.ps1`. Optional: `pwsh -File scripts/install-git-hooks.ps1 -InstallGitleaks`.
> - **🟢 Stale scheduled-tasks cleanup (cross-PC, lav-prio):** Slet `time-tracker-phase2-reminder` (lastRun 2026-05-19) + `verify-season-1-transition-2026-05-21` (lastRun 2026-05-21) via `mcp__scheduled-tasks__delete_scheduled_task` på BÅDE EmmaPC og NicolaiPC. Allerede fired + enabled=false, kun støj.
> - **#619 (stale Sentry warning):** False-positive `[Sentry] express is not instrumented` warning — auto-instrument virker faktisk per MCP, men warning logger ved hver startup. Lav prioritet.
> - **Session N (#339):** (1) slet residual cert-manager "Cycling Zone" workspace i Infisical, (2) enable 2FA på Infisical-konto, (3) tjek EU/gmail Infisical-konto. Detaljer: [`.claude/learnings/2026-05-22-infisical-cert-manager-workspace-trap.md`](../.claude/learnings/2026-05-22-infisical-cert-manager-workspace-trap.md).
> - **Session B (#550, v3.89):** (1) rotér Discord webhook URLs i Discord, (2) test AdminPage Discord-fane → maskerede URLs + Test-knap, (3) tjek Railway-logs for `[discord-dm:`-entries efter en auktion-event. Detaljer: [`docs/archive/NOW-2026-05-22.md`](archive/NOW-2026-05-22.md).
> - **Session A (#601):** Admin-verify ved næste reelle sæsonskift → bekræft PayrollSummaryTable vises med 4 kategori-rækker (Lånerenter/Lønninger/Nødlån/Renter på negativ balance). Invariant-test låser count-konsistens, men UI er kun smoke-testet.

> **📚 Tidligere sessions arkiveret:** 2026-05-22-A til Q i [`docs/archive/NOW-2026-05-22.md`](archive/NOW-2026-05-22.md). 2026-05-23-A til O i [`docs/archive/NOW-2026-05-23.md`](archive/NOW-2026-05-23.md). 2026-05-24-A til O i [`docs/archive/NOW-2026-05-24.md`](archive/NOW-2026-05-24.md). 2026-05-25-A til G i [`docs/archive/NOW-2026-05-25.md`](archive/NOW-2026-05-25.md).

## Aktiv styring

> **🎯 Next action:** [#385](https://github.com/NicolaiDolmer/CyclingZone/issues/385) Settings split + workaround-test (split sammensat matcher) — blocker for fungerende Edit|Write hooks på BÅDE PCs. Sekundære: secret-rotation (3 keys per #634), [#623](https://github.com/NicolaiDolmer/CyclingZone/issues/623) PatchNotes BUILD, [#636](https://github.com/NicolaiDolmer/CyclingZone/issues/636) MEMORY.md trim.
>
> _Format (max 2 linjer): `<#issue eller fil-path> — <1-sætnings opgave>`. Cross-device handoff PC1↔mobil↔PC2._

> **🤖 Working agent:** _Ingen aktiv session._
>
> _Format: `<agent> · <kanal> · <PC> · <ISO-tid CET>`. Multi-AI claim. Opdatér ved session-start; nulstil til "Ingen aktiv session" ved close-out._
