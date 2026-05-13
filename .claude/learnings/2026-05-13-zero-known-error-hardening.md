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
