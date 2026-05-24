# ADR: RLS regression guard — structural over behavioral

**Status:** Accepted — implemented 2026-05-22 via PR [#585](https://github.com/NicolaiDolmer/CyclingZone/pull/585).
**Date:** 2026-05-22 (decision), 2026-05-24 (documented).
**Owner:** Claude (proposal + implementation), Nicolai Dolmer (approval).
**Issue:** [#580](https://github.com/NicolaiDolmer/CyclingZone/issues/580). Refs [#518](https://github.com/NicolaiDolmer/CyclingZone/issues/518), [#548](https://github.com/NicolaiDolmer/CyclingZone/issues/548).

---

## Decision

For `pending_race_result_rows` RLS-policies (og lignende kritiske policies fremover), bruger vi en **structural REQUIRED_POLICIES guard** der verificerer at navngivne policies eksisterer på live-DB — IKKE en behavioral integration-test der prøver at exploit'e dem som authenticated user.

Behavioral proof tages **én gang** ved migration-merge via manual impersonation (samme metode som [#518](https://github.com/NicolaiDolmer/CyclingZone/issues/518)). Den gentages kun hvis RLS-logikken (JOIN-betingelser, role-gates) ændres semantisk.

## Context

[#518](https://github.com/NicolaiDolmer/CyclingZone/issues/518) erstattede permissive `USING (true)` / `WITH CHECK (true)` policies på `pending_race_result_rows` med owner-or-admin-gated policies. Migrationen blev verificeret live med impersonation før merge.

Codex-review 2026-05-23 pegede på at `backend/lib/pendingRaceResultRlsContract.test.js` kun er en SQL-text-contract test (regex mod migration-filen). Spørgsmålet: skal vi have en varig behavioral regression guard så fremtidige PRs beviser runtime-adfærd, ikke kun migration-tekst?

## Alternatives considered

### A. Behavioral integration-test i CI (REJECTED)

Setup en lokal Supabase-instans eller hit live-DB med to JWT'er (service_role + impersoneret attacker), prøv at SELECT/INSERT andres pending rows, assertion `403`/`empty`.

**Reasons rejected:**

1. **JWT-kompleksitet** — kræver to rigtige Supabase-brugere med signerede tokens. Service_role til test-setup + impersoneret authenticated user til attack-path. Ingen simpel løsning i CI uden enten nye secrets eller `supabase start`-orchestrering.
2. **Mutation-risiko** — Supabase REST API har ingen client-side transactions. Test-data eksisterer kortvarigt i prod-DB; cleanup er best-effort. `database/RLS_AUDIT_2026-05-22.md` brugte `BEGIN; ... ROLLBACK;` mod prod-DB, men det kræver direct psql access, ikke REST.
3. **CI-flakiness** — netværk, Supabase rate-limits, ikke-deterministisk timing. Risikerer flaky CI der koster mere end den fanger.
4. **Allerede behavioral bevist** — [#518](https://github.com/NicolaiDolmer/CyclingZone/issues/518) blev live-verificeret med impersonation ved merge. Den behavioral proof eksisterer i issue-historikken.

### B. Local Supabase via `supabase start` i CI (REJECTED)

Spin docker-Supabase op i hver PR-run, replay migrations, kør behavioral assertions.

**Reasons rejected:**

- ~2-3 min ekstra per PR-run for at validere ÉN tabels policies.
- Docker-orchestrering tilføjer CI-failure-modes der ikke har med kode at gøre.
- Migration-replay-state divergerer fra prod over tid (advisor-warns, Studio-side ændringer).

### C. Structural guard mod live-DB (ACCEPTED)

Udvid eksisterende `backend/scripts/audit-rls-coverage.js` (lever fra [#279](https://github.com/NicolaiDolmer/CyclingZone/issues/279)) med en `REQUIRED_POLICIES` map. Verificér via service-role read-only RPC `audit_rls_coverage()` at navngivne policies findes på live-DB.

```js
const REQUIRED_POLICIES = {
  pending_race_result_rows: [
    "Owner or admin insert pending rows",
    "Owner or admin read pending rows",
  ],
};
```

**Hvorfor det vandt:**

- Ingen nye secrets (genbruger `SUPABASE_SERVICE_KEY`).
- Ingen mutation-risiko (read-only RPC).
- Køres allerede på alle DB/frontend-PRs + weekly cron via `.github/workflows/rls-audit.yml`.
- Fanger Studio-side policy-deletion + glemte migrations (det reelle drift-scenarie).
- Marginale CI-omkostninger (< 5 sek per kørsel).

## Coverage-matrix efter denne beslutning

| Lag | Hvad det beviser | Trigger |
|---|---|---|
| Text-contract ([`pendingRaceResultRlsContract.test.js`](../../backend/lib/pendingRaceResultRlsContract.test.js)) | Migration SQL indeholder korrekte policy-definitioner | CI på hvert push |
| Structural REQUIRED_POLICIES guard ([`audit-rls-coverage.js`](../../backend/scripts/audit-rls-coverage.js)) | De navngivne policies eksisterer på live-DB | CI: alle DB/frontend PRs + weekly cron mandag 05:00 UTC |
| Behavioral proof ([#518](https://github.com/NicolaiDolmer/CyclingZone/issues/518) impersonation) | Policies håndhæver korrekt adfærd runtime | One-time ved migration-merge — gentages manuelt hvis RLS-logik ændres |

## Consequences

**Positive:**
- Fanger 99% af regression-scenarierne (forkert migration, manglende deploy, Studio-side deletion) uden CI-kompleksitet.
- Genbruger eksisterende infra (`audit-rls-coverage.js`, `audit_rls_coverage` RPC, `rls-audit.yml` workflow).
- Skalerer: ny kritisk tabel = én entry i `REQUIRED_POLICIES`.

**Negative — accepteret:**
- Dækker IKKE semantisk korrekthed af JOIN-betingelser (f.eks. om `submitted_by = auth.uid()` faktisk gør det forventede). Hvis RLS-logikken ændres senere skal behavioral impersonation gentages manuelt.
- Detection er reaktiv på drift (weekly cron + PR-trigger), ikke realtime.

## When to re-evaluate

Trigger en ny vurdering af denne beslutning hvis:

1. **RLS-logik ændres semantisk** — ny JOIN, ny role-gate, ny CHECK-betingelse. Behavioral impersonation skal kørt manuelt ved merge (samme procedure som [#518](https://github.com/NicolaiDolmer/CyclingZone/issues/518)).
2. **Studio-side policy-deletion sker uden cron-detection** (drift-vindue > 7 dage er for langt). Så enten flyt cron til daily eller tilføj realtime trigger.
3. **Flere end 5 tabeller** kommer i `REQUIRED_POLICIES`. Så bør guarden refaktoreres til en deklarativ konfig-fil i stedet for hardcoded map.
4. **Supabase introducerer first-class behavioral RLS-test tooling** (lokal psql-impersonation via SDK eller managed pgTAP).

## References

- [#518](https://github.com/NicolaiDolmer/CyclingZone/issues/518) — pending_race_result atomic RPC + RLS-tightening (oprindelig fix).
- [#279](https://github.com/NicolaiDolmer/CyclingZone/issues/279) — RLS audit guard pattern (slice 14 silent-empty bug).
- [#548](https://github.com/NicolaiDolmer/CyclingZone/issues/548) — RLS correctness audit 2026-05-22.
- [PR #585](https://github.com/NicolaiDolmer/CyclingZone/pull/585) — REQUIRED_POLICIES guard implementation.
- [`docs/RLS_AUDIT_2026-05-22.md`](../RLS_AUDIT_2026-05-22.md) — manual impersonation methodology der bevarer behavioral proof for fremtidige migrationer.
