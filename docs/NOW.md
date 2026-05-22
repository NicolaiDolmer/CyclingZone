# NOW — Aktuel arbejdsstatus

> **🆕 Næste session-kandidater:** [#518](https://github.com/NicolaiDolmer/CyclingZone/issues/518) (P1 race-result RLS — sidste `rls_policy_always_true` tilbage), [#549](https://github.com/NicolaiDolmer/CyclingZone/issues/549) (npm audit), [#545](https://github.com/NicolaiDolmer/CyclingZone/issues/545) (backend cron audit), [#546](https://github.com/NicolaiDolmer/CyclingZone/issues/546) (frontend kritiske søjler), [#547](https://github.com/NicolaiDolmer/CyclingZone/issues/547) (root-cleanup).

> **🟢 Session 2026-05-22-D — RLS audit + lockdown (#548, v3.90):** Commits `56d5349` + `4efaabe`. Manual correctness-audit fandt 5 P0/P1 eksploits (loans full-write, loan_config tampering, notifications phishing, activity_feed spam, users PII leak via email+discord_id). Migration [`database/2026-05-22-rls-permissive-policy-lockdown.sql`](database/2026-05-22-rls-permissive-policy-lockdown.sql) re-scoper 5 permissive policies fra `TO public` til `TO service_role` + erstatter users-policy med `is_admin()`-gated. Advisor 15 → 10. Del 3 migrations safety review: clean. **#527 effektivt complete.** Audit + postmortem: [`docs/RLS_AUDIT_2026-05-22.md`](docs/RLS_AUDIT_2026-05-22.md), [`docs/MIGRATIONS_AUDIT_2026-05.md`](docs/MIGRATIONS_AUDIT_2026-05.md), [`.claude/learnings/2026-05-22-rls-permissive-public-policies.md`](.claude/learnings/2026-05-22-rls-permissive-public-policies.md).

> **⚠️ Pending bruger-actions fra Session 2026-05-22-B (#550, v3.89):** (1) rotér Discord webhook URLs i Discord (Server Settings → Integrations → Webhooks → regenerate — de gamle var eksponeret), (2) test AdminPage Discord-fane → maskerede URLs + Test-knap virker, (3) tjek Railway-logs for `[discord-dm:`-entries efter en auktion-event. Detaljer: [`docs/archive/NOW-2026-05-22.md`](docs/archive/NOW-2026-05-22.md).

> **📚 Tidligere sessions arkiveret:** Session 2026-05-22-A/B/C i [`docs/archive/NOW-2026-05-22.md`](docs/archive/NOW-2026-05-22.md).

## Aktiv styring
