# AI/Ops blind spots beyond the current #323 epic

**Status:** Proposed roadmap review input  
**Date:** 2026-05-14  
**Owner:** Manus AI  
**Parent:** [#323](https://github.com/NicolaiDolmer/CyclingZone/issues/323)

---

## Purpose

Claude’s audit feedback was correct that another broad restatement of #323 is not valuable. The project already has an AI/Ops epic, and several items that a generic audit would recommend are already implemented, closed, or tracked. This document therefore focuses on **blind spots**: operational decisions that are easy to miss because the roadmap already looks mature.

The blind spots below are not all new implementation tasks. Some should become issue comments or acceptance criteria on existing issues. The highest-value work is to turn broad scaling goals into measurable service behavior: restore cadence, P95 latency targets, cache rollout gates, and explicit failure modes.

---

## Runtime-verified state before recommendations

| Area | Verified state on 2026-05-14 | Planning consequence |
|---|---|---|
| Parent AI/Ops epic | #323 is open and already covers the 5,000–10,000-user ambition. | Do not create duplicate meta-roadmaps. Add specific decisions and blind spots to the existing epic. |
| RLS auditing | #325 is closed. | Do not recommend building RLS audit helpers as if they are missing. |
| Secret management | #327 is open, but Infisical has already been selected in the existing ADR and Phase 6 local bootstrap is documented as live in `docs/NOW.md`. #339 remains the manual Infisical dashboard setup. | Do not run another platform-evaluation task. Move forward with approval, dashboard setup, and phased migration. |
| Realtime | #333 is open, but the current issue is about making Realtime the primary channel, not discovering Realtime from scratch. | Recommendations should focus on cache/realtime consistency and fallback behavior. |
| Cache/shared store | #334 is open and now has a concrete ADR in `docs/decisions/cache-adr.md`. | Next step is approval and a narrow implementation slice, not more research. |
| Cost model | #332 is open and now has a baseline model in `docs/AI_OPS_COST_MODEL.md`. | Next step is to turn thresholds into monitoring/review cadence. |

---

## Blind spot 1: Backup restore cadence, not just backups

A roadmap that says “backups” is incomplete until it states how often restores are tested, who owns the drill, and what “good restore” means. Supabase-managed backups reduce infrastructure burden, but they do not prove that CyclingZone can restore the right data quickly, preserve game invariants, and communicate downtime to users.

| Missing decision | Proposed baseline | Why it matters |
|---|---|---|
| Restore-test cadence | Monthly during beta; quarterly after stable launch if drills are consistently green. | Backups that are never restored are assumptions, not resilience. |
| Restore target | Restore latest production backup into a non-production project and run smoke checks. | Avoids destructive production testing while proving the operational path. |
| Acceptance criteria | Auth works, key tables load, auctions/teams/riders are consistent, and admin smoke routes pass. | Game integrity matters more than simply having a database dump. |
| Documentation | Add a restore runbook under #332 before calling the issue complete. | Makes the process repeatable for Claude/Codex/Manus sessions. |

The first drill should not wait for high traffic. It should happen before public growth because restore procedures are easiest to fix while the system is quiet.

---

## Blind spot 2: P95 latency SLO before cache rollout

The cache roadmap is weak unless it defines the latency problem it is trying to solve. Without a baseline, caching can add complexity while hiding the real bottleneck. The cache ADR therefore requires baseline timing before caching candidate endpoints.

| Metric | Proposed initial SLO | Review trigger |
|---|---:|---|
| Public/read-heavy route P95 | Under 500 ms from backend perspective. | P95 above 750 ms for one week or after launch traffic spike. |
| Authenticated manager dashboard P95 | Under 800 ms backend time for primary data load. | P95 above 1,200 ms or visible UI spinner complaints. |
| Auction bid write P95 | Under 300 ms backend time excluding client network. | P95 above 500 ms during active auction windows. |
| Cache hit ratio | No target until Phase 2; measure first. | Hit ratio under 30% after rollout means invalidation or endpoint choice is poor. |

These targets are deliberately practical rather than theoretical. They should be refined from real measurements, but having a first target prevents “cache everything” from becoming the default answer.

---

## Blind spot 3: Fail-open versus fail-closed behavior during provider outages

The current rate-limit architecture has a manual break-glass flag, `RATE_LIMIT_DISABLED=1`, which disables all limiters during catastrophe scenarios. That is useful, but it is not the same as a Redis-outage policy or Supabase-outage policy.

| Failure mode | Proposed behavior | Follow-up |
|---|---|---|
| Redis unavailable for read cache | Fail open: bypass cache and read from Supabase. | Emit warning metric/log and keep cache TTLs short. |
| Redis unavailable for authenticated write rate limiting | Fall back to in-process limiter and warn. | Ensure user-scoped limiter still uses `req.user.id` when available. |
| Redis unavailable for unauthenticated abuse-sensitive routes | Prefer conservative 503 or tighter fallback limits if identity is weak. | Define route-specific policy during #334 implementation. |
| Supabase unavailable for writes | Fail closed for business-critical writes. | User-facing message should say action was not persisted. |
| Supabase unavailable for reads | Degraded UI only if cached data is clearly marked safe. | Never use cache to show stale ownership/payment-changing state. |

The key principle is that **availability is not allowed to corrupt game state**. Failing open is acceptable for optional cached reads; failing open is not acceptable for ownership, bids, payments, squad limits, or transfer-window enforcement.

---

## Blind spot 4: Cache and Realtime can contradict each other

Realtime and caching are individually useful, but together they create a subtle consistency risk. If a user receives a fresh Realtime event but the next HTTP read returns stale cached data, the UI can appear to move backward. This is especially dangerous for auctions, notifications, and manager-facing market screens.

| Surface | Risk | Required guardrail |
|---|---|---|
| Auctions | Fresh bid event followed by stale cached auction list. | Very short TTL or event-driven invalidation on bid/create/finalize. |
| Notifications | Realtime notification appears, cached unread count remains old. | Unread count should be invalidated on notification insert/read-all. |
| Team/market state | Cached rider/team data can outlive transfer or loan changes. | Avoid cache until ownership-state invalidation is proven. |
| Admin actions | Admin update can be hidden by cache. | Admin writes should bypass or invalidate relevant cache keys. |

The project should add a cache/realtime consistency smoke test before making Realtime the primary channel in #333 or caching manager-visible market data in #334.

---

## Blind spot 5: Incident playbook needs player-facing communication rules

Incident response is not only internal debugging. A cycling manager game has live auctions, seasonal deadlines, and user trust concerns. The incident playbook should define when the project freezes market actions, pauses deadlines, or posts user-facing status updates.

| Incident type | Product policy decision needed |
|---|---|
| Auction finalization failure | Should the market be frozen until finalization is verified, or should unaffected auctions continue? |
| Supabase partial outage | Which manager actions are read-only, hidden, or queued? |
| Rate-limit false positives | When is `RATE_LIMIT_DISABLED=1` acceptable, and who verifies abuse risk afterward? |
| Data restore | What user-visible events are replayed, reversed, or communicated after restore? |
| AI/Ops automation failure | Which automated workflows are allowed to fail silently, and which must page/alert? |

This should live under #332 rather than becoming a separate meta-epic. It is an operational acceptance criterion for “ready to scale.”

---

## Recommended issue updates

| Issue | Recommended update |
|---|---|
| #323 | Add a comment linking this blind-spots document, the cache ADR, and the cost model. |
| #332 | Add acceptance criteria for restore drills, incident playbook, cost review thresholds, and provider-outage policy. |
| #333 | Add cache/realtime consistency as a required smoke test before Realtime becomes primary. |
| #334 | Use `docs/decisions/cache-adr.md` as the implementation contract. |
| #327/#339 | Treat Infisical as the selected platform; focus on manual dashboard setup and phased migration, not renewed vendor research. |

---

## Next-session start point

The next cold-start session should not begin with another broad audit. It should begin with one of two concrete paths. If Nicolai wants an implementation slice, start with **#334 Phase 0–1**: add endpoint timing baseline and Redis-backed rate-limit store behind env flags. If Nicolai wants ops hardening first, start with **#332 restore drill runbook** and a first non-production restore test plan.
