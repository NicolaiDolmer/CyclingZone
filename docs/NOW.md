# NOW — Aktuel arbejdsstatus

> **🆕 Næste session-kandidater:** [#549](https://github.com/NicolaiDolmer/CyclingZone/issues/549) (npm audit), [#545](https://github.com/NicolaiDolmer/CyclingZone/issues/545) (backend cron audit), [#546](https://github.com/NicolaiDolmer/CyclingZone/issues/546) (frontend kritiske søjler), [#547](https://github.com/NicolaiDolmer/CyclingZone/issues/547) (root-cleanup).

> **🟢 Session 2026-05-22-E — Race-result submit atomicity + RLS lockdown (#518, v3.91):** Commit pending. Frontend submitResults() omlagt til single RPC `submit_race_results(p_race_id, p_rows jsonb)` — parent + child rows i én transaction (var: 2 separate `.insert()`-kald, kunne efterlade orphan parent). RLS på `pending_race_result_rows` strammet: `WITH CHECK (true)` + `USING (true)` (sidste `rls_policy_always_true` advisor) → owner-or-admin gated via join til parent. Live impersonation-test: user B ser 0 rows fra user A's submission, user B's INSERT under user A's pending_id afvises med 42501. Backend approve uændret (service_role bypasser RLS). Migration: [`database/2026-05-22-pending-race-result-atomic-rpc.sql`](database/2026-05-22-pending-race-result-atomic-rpc.sql). Contract-test: [`backend/lib/pendingRaceResultRlsContract.test.js`](backend/lib/pendingRaceResultRlsContract.test.js) (6/6 ✓). Postmortem: [`.claude/learnings/2026-05-22-pending-race-result-atomicity-rls.md`](.claude/learnings/2026-05-22-pending-race-result-atomicity-rls.md).

> **⚠️ Pending bruger-actions fra Session 2026-05-22-B (#550, v3.89):** (1) rotér Discord webhook URLs i Discord (Server Settings → Integrations → Webhooks → regenerate — de gamle var eksponeret), (2) test AdminPage Discord-fane → maskerede URLs + Test-knap virker, (3) tjek Railway-logs for `[discord-dm:`-entries efter en auktion-event. Detaljer: [`docs/archive/NOW-2026-05-22.md`](docs/archive/NOW-2026-05-22.md).

> **📚 Tidligere sessions arkiveret:** Session 2026-05-22-A/B/C/D i [`docs/archive/NOW-2026-05-22.md`](docs/archive/NOW-2026-05-22.md).

## Aktiv styring
