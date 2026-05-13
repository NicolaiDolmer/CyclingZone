# Postmortem · 2026-05-13 · Quality net reported the wrong root cause

## Hvad skete der?
`agent-doctor.ps1` and the Supabase audit scripts reported failed local audits as likely RPC-missing, even though the helper RPCs were already deployed. A separate production log showed `/api/achievements/check` failing with Supabase's "JSON object requested, multiple (or no) rows returned" message.

## Root cause
The audit scripts appended migration advice to every Supabase RPC failure instead of classifying auth failures separately. The achievements sync used `.single()` for login-streak lookup, making a missing public `users` row fatal for an otherwise best-effort achievement check.

## Fix
Audit scripts now classify `auth-failure`, `rpc-missing`, and `other`; `agent-doctor.ps1 -Json` exposes the same signal for automation. Achievements login-streak lookup now uses `.maybeSingle()` and has a regression test for auth users without a public user row.

## Forhindret-fremover
Quality Inbox runs `agent-doctor.ps1 -Json`, lint warning budgets block new warning growth, and Sentry captures backend/frontend runtime exceptions with release context once env vars are configured.

## Læring
Monitoring must diagnose its own failure mode first. A broken monitor and a broken product can look identical unless the error taxonomy is explicit.

## Post-live learning
GitHub Actions runtime is not the same as the local Windows shell:

- `gh api repos/:owner/:repo` can omit fields like `security_and_analysis`, `allow_auto_merge`, and `delete_branch_on_merge` depending on token/scope. Doctor scripts must check property existence before reading fields.
- `$env:LOCALAPPDATA` is Windows-only. Any Winget/local-tool discovery must guard the env var and degrade gracefully on Linux runners.
- Supabase realtime in Node 20 still needs explicit `ws` transport in standalone scripts that create a Supabase client.
- Deploy verification must distinguish missing provider status from a broken product. A commit can have green live endpoints while the gate is waiting on a deployment status that never arrives.
- Quality Inbox should not blindly count runner-context differences as product warnings. It needs a CI baseline or `INFO` category for expected differences like repo path, hooksPath, and missing local developer tools.

## Follow-up issues
- #347: make deploy-verify robust for script/doc-only commits and missing Railway status.
- #348: set Sentry secrets and verify real frontend/backend events with release/source maps.
- #346: reduce Quality Inbox warning debt and calibrate CI-only warnings.
- #337/#339: finish local Supabase service-key rotation and Infisical dashboard setup.
