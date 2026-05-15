# ADR: Cache and shared-store platform for CyclingZone

**Status:** Accepted — Phase 1 implemented as in-process LRU (2026-05-15). Upstash deferred to #330.
**Date:** 2026-05-14 (proposed), 2026-05-15 (accepted with amendment)
**Owner:** Manus AI (proposal), Nicolai Dolmer (approval), Claude (implementation)
**Issue:** [#334](https://github.com/NicolaiDolmer/CyclingZone/issues/334)
**Parent:** [#323](https://github.com/NicolaiDolmer/CyclingZone/issues/323)

---

## Amendment 2026-05-15 — Phase 1 via in-process LRU first

Approved by Nicolai with the constraint **"do the optimal thing that costs zero money right now."** Implementation proceeds as:

| Phase | Original ADR proposal | Actual implementation |
|---|---|---|
| 0. Baseline | Add P50/P95 timing logs before caching. | ✅ `backend/lib/responseCache.js` emits Sentry breadcrumbs (`endpoint-timing` category) with route, namespace, hit/miss, duration_ms on every wrapped request. |
| 1. Shared limiter store (Redis-backed) | Swap `express-rate-limit` to Upstash Redis. | ⏸ **Deferred to #330** (multi-instance trigger). In-process MemoryStore stays. |
| 2. Read-through cache | Cache 1-2 endpoints via Upstash. | ✅ **In-process LRU**: `/api/riders` (60s TTL), `/api/races` (10 min), `/api/race-pool` (10 min), `/api/race-points` (10 min). Zero external deps, zero cost, max 200 entries/namespace. |
| 3. Realtime/cache alignment | Verify under fresh bid/notification events. | ✅ Aggressive 60s TTL on riders + explicit invalidation on auction-finalize, transfer-execute, swap-execute, loan-buyout, race-results-approve, admin override-rider / retirement / race-creation / race-pool import / race-selection apply. `/api/auctions` deliberately **not** cached (Realtime updates rapidly). |
| 4. Scale decision | Pick Upstash plan based on volume. | ⏸ Re-evaluate when #330 triggers (second Railway instance). |

**Cost outcome:** $0/month additional. Upstash sign-up and `REDIS_URL` secret-provisioning are deferred to the same milestone that introduces a second backend instance.

**Break-glass:** `RESPONSE_CACHE_DISABLED=1` env-flag bypasses all in-process caches without code change (parallel to existing `RATE_LIMIT_DISABLED=1`).

**Operational visibility:** `GET /api/admin/cache-stats` returns per-namespace size + hit/miss/invalidation counters for admin operators. Sentry breadcrumbs aggregate to P50/P95 across endpoints.

---

## Decision (original proposal — superseded by amendment above for Phase 1)

CyclingZone should adopt **Upstash Redis as the first shared cache and rate-limit store** when the project moves beyond the current single Railway backend instance. The implementation should begin with a narrow production slice: shared storage for backend rate limiting and a small read-through cache for high-frequency, low-risk read endpoints. The existing in-process memory store remains acceptable only while the backend runs as a single instance.

This decision intentionally chooses a managed Redis-compatible service rather than self-hosted Redis, Railway-hosted Redis, or a Supabase-table-backed cache. The main reason is operational focus. CyclingZone’s near-term scale target is **5,000–10,000 active users**, not a mature platform team. A managed serverless Redis service gives the project a shared store, low setup overhead, predictable early cost, and an easy rollback path without introducing another long-running service to patch, monitor, and back up.

> **Decision rule:** if a value must coordinate behavior across backend replicas, it belongs in a shared store. If a value is only an optimization and can be recomputed safely, it may use a TTL cache. If stale data could change ownership, payments, squad limits, transfer-window enforcement, or auction finalization, it must not be cached without a domain-specific invalidation contract.

---

## Runtime evidence

The current architecture explicitly documents that backend rate limiting uses `express-rate-limit` with an **in-process memory store** on a day-one, single-instance Railway backend. The same section states that multi-instance scaling requires a shared store, either Redis or a Supabase-backed alternative, before a second backend instance starts. It also documents the operational break-glass flag `RATE_LIMIT_DISABLED=1`, which disables all limiters during catastrophe scenarios.[^1]

Issue verification on 2026-05-14 found that **#334 is still open** and specifically tracks “Redis/in-memory cache for hyppigt læste endpoints.” That means the useful deliverable is not a new greenfield task, but this concrete ADR and a phased rollout plan attached to the existing issue.

| Runtime fact | Source | Consequence |
|---|---|---|
| Rate limiting is currently in-process memory only. | `docs/ARCHITECTURE.md`, backend rate-limiting section. | It is safe for one Railway backend instance, but not for horizontal scaling. |
| Multi-instance scaling requires a shared store. | `docs/ARCHITECTURE.md`, backend rate-limiting section. | Cache/shared-store work becomes a precondition before adding backend replicas. |
| Break-glass disables all limiters with `RATE_LIMIT_DISABLED=1`. | `docs/ARCHITECTURE.md`, backend rate-limiting section. | The rollout must define fail-open versus fail-closed behavior before production traffic depends on Redis. |
| #334 is open. | GitHub issue verification, 2026-05-14. | The ADR should update the existing issue rather than creating duplicate work. |

---

## Option analysis

| Option | Fit for CyclingZone | Strengths | Weaknesses | Decision |
|---|---|---|---|---|
| **Upstash Redis** | High | Serverless Redis-compatible store, free tier, pay-per-command pricing, fixed plans, native Vercel-friendly operating model, no self-hosted process. | Production SLA/security features such as Prod Pack add cost; latency must be measured from Railway region to selected Redis region. | **Chosen for Phase 1.** |
| Railway-hosted Redis or Valkey container | Medium | Keeps backend-adjacent infrastructure in Railway and can be simple for one team. | Adds another stateful service to operate, monitor, secure, and back up; less attractive before a dedicated ops cadence exists. | Defer. |
| Supabase-backed cache tables/RPCs | Medium-low | No new vendor and strong SQL observability. | Poor fit for hot counters/rate-limit buckets; risks adding write pressure to the primary database; cache invalidation becomes application-specific SQL. | Reject for hot cache/rate limiting. |
| In-process LRU only | Medium for single instance | Cheapest, fastest, and trivial rollback. | Incorrect under multiple backend replicas and does not solve distributed rate limiting. | Keep only as day-one fallback. |
| Self-hosted Redis | Low near term | Maximum control and familiar ecosystem. | Highest operational burden; backups, patching, failover, network hardening, and incident response become project-owned. | Reject for 5k–10k phase. |

Upstash’s official pricing page lists a Redis free plan with 256 MB data and 500,000 monthly commands, a pay-as-you-go model at **$0.20 per 100,000 commands**, and a fixed 250 MB plan at **$10/month** with no per-command pricing.[^2] That is a better early scaling profile than running and operating a dedicated Redis service before the project has evidence that cache traffic is large or latency-critical.

---

## Scope boundaries

The first implementation must treat Redis as an **operational coordination layer**, not a business-state source of truth. PostgreSQL/Supabase remains the canonical store for riders, teams, auctions, bids, finances, board state, and notifications. Redis entries should use short TTLs unless an explicit invalidation contract exists.

| Allowed in Phase 1 | Not allowed without a separate contract |
|---|---|
| Rate-limit buckets shared across backend replicas. | Auction ownership, winning bid state, or transfer acceptance state. |
| Read-through cache for public or manager-safe read endpoints with clear TTL. | Finance balances, salary obligations, or loan ownership state. |
| Idempotency keys for defensive write handling if backed by tests. | Any cached value that can pay the wrong team or leave a rider in conflicting owner-state. |
| Lightweight health metrics around Redis availability and hit ratio. | Using Redis as a replacement for Supabase row-level security or domain constraints. |

---

## Recommended rollout

The rollout should be deliberately small and measurable. The project should not introduce broad caching before it has a baseline latency target, cache-hit instrumentation, and a fail-mode policy.

| Phase | Change | Exit criteria |
|---|---|---|
| 0. Baseline | Add timing logs or lightweight metrics for candidate endpoints before caching. | P50/P95 latency is known for the selected endpoints during normal traffic. |
| 1. Shared limiter store | Add a Redis-backed store for `express-rate-limit`, with in-process fallback controlled by explicit env flags. | Existing rate-limit tests pass; multi-instance behavior is documented; no route semantics change. |
| 2. Safe read-through cache | Cache only one or two low-risk read endpoints with short TTLs and explicit bypass during admin writes if needed. | P95 improves or Supabase read volume drops; no stale business-critical state appears in smoke tests. |
| 3. Realtime/cache alignment | Verify that Supabase Realtime and polling/cached reads do not show contradictory UI state. | Auction and notification screens behave consistently under fresh bid/notification events. |
| 4. Scale decision | Choose fixed plan versus pay-as-you-go based on actual command volume. | Monthly command count and cost are visible in a simple cost table. |

---

## Fail-mode policy

The cache implementation should be **fail-open for non-critical read-through cache** and **degraded but explicit for write-protection rate limiting**. If Redis is unavailable, ordinary cached reads should bypass Redis and read from Supabase. Rate limiting is more nuanced: silently disabling all write limiters during a Redis outage may protect availability but weakens abuse protection, while fail-closed could block legitimate managers during a provider incident.

CyclingZone should therefore implement a two-level policy. For manager-authenticated writes, Redis outage should fall back to the existing in-process limiter and emit an operational warning. For unauthenticated or high-abuse routes, the project should prefer conservative limits or temporary 503 responses if fallback cannot safely identify users. The existing `RATE_LIMIT_DISABLED=1` remains a manual break-glass tool and must not become the automatic default.

---

## Cost expectation

The cache cost should initially be modest. At low command volume, Upstash pay-as-you-go is effectively usage-based, while the fixed 250 MB plan gives predictable cost once command volume becomes steady. The project should delay the $200/month Prod Pack until either production revenue, SLA requirements, or incident history justifies it.[^2]

| Scenario | Recommended plan | Expected monthly cache platform cost | Rationale |
|---|---|---:|---|
| Pre-scale and beta | Free or pay-as-you-go | $0–$10 | Enough for experiments and baseline measurements. |
| 5k active users | Pay-as-you-go or fixed 250 MB | $10–$40 | Choose fixed if command volume becomes steady; choose pay-as-you-go if bursty and low. |
| 10k active users | Fixed 250 MB or larger fixed tier | $10–$75 before Prod Pack | Move only when measured command count or storage requires it. |
| Paid/professional operations | Fixed plan + optional Prod Pack | $210+ | Use only when SLA/security requirements justify the operational spend. |

---

## Consequences

This ADR gives #334 a concrete direction: **managed Redis via Upstash, introduced first as shared rate-limit/cache infrastructure, with in-process LRU retained as a local fallback**. It also creates two implementation requirements that should be reflected in the eventual slice: baseline P95 latency before caching and an explicit Redis-outage policy before production rollout.

The decision avoids overbuilding. CyclingZone does not need a generalized caching platform across every domain right now. It needs one shared coordination layer before multi-instance backend scaling and a disciplined way to prove whether caching materially improves the user experience.

---

## References

[^1]: [CyclingZone Architecture — Backend rate limiting](../ARCHITECTURE.md#backend-rate-limiting-328).
[^2]: [Upstash Pricing](https://upstash.com/pricing).
