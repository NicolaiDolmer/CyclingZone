# World-Class Performance Architecture

**Status:** Proposed for independent review

**Date:** 2026-06-13

**Scope:** Perceived frontend speed, capacity for concurrent managers, and a cost-conscious path to long-term scale

**Decision owner:** Product owner

**Review requested from:** Claude or another independent engineering reviewer before implementation planning

> **Sequencing (added in review, 2026-06-13):** None of the work in this document is pre-launch. The 2026-06-20 fresh-season relaunch takes priority, and every phase below is sequenced *after* it; do not start a data-layer refactor during launch week. Execution is tracked in [#1375](https://github.com/NicolaiDolmer/CyclingZone/issues/1375).
>
> **Review verification (2026-06-13):** the four load-bearing premises were checked against the code and all hold: no shared client cache (`frontend/package.json`), the `loadAll` broad-refetch pattern appears 62 times across 17 pages, rate limiting is an in-process memory store (`backend/lib/rateLimiters.js`), and cron shares the web process (`server.js` imports `startCron`). The diagnosis is verified, not assumed.

## 1. Context and goals

CyclingZone currently uses:

- React 18 and Vite on Vercel
- Node.js and Express on Railway
- Supabase Postgres, Auth, Data API, RLS, and Realtime
- Sentry, Vercel Speed Insights, GA4, and Microsoft Clarity

The near-term target is a polished experience for 100-500 concurrent managers. The longer-term expectation is 5,000-35,000 monthly active players. The infrastructure budget at 500 concurrent managers should remain below approximately DKK 1,000 per month.

**Current measured baseline (must be filled before these targets are treated as gaps):**

- Current peak concurrent managers: *not yet measured*; establish in Phase 0 ([#1375](https://github.com/NicolaiDolmer/CyclingZone/issues/1375)). The app is in open beta with a small tester group; infrastructure is currently rated for roughly 100 active managers, not 500.
- Total verified monthly infrastructure spend: *not yet measured*. The only known fixed component is Supabase Pro (~$25/month, [#1181](https://github.com/NicolaiDolmer/CyclingZone/issues/1181)); Railway and Vercel are usage-based, and a possibly-unused Railway Postgres + Redis project may still be billing ([#1182](https://github.com/NicolaiDolmer/CyclingZone/issues/1182)).

Until these two numbers exist, the 100-500 concurrent target and the DKK 1,000/month ceiling are aspirational, not measured headroom. Do not treat estimated capacity as verified capacity.

The primary product goal is not merely low server response time. Navigation and interactions should feel immediate:

- A cached page transition should show useful content within 100 ms.
- Safe interactions should react immediately and synchronize in the background.
- Competitive and financial actions must remain server-authoritative.
- The architecture should have a credible growth path without a premature platform migration.

This document defines the target architecture and decision gates. Exact bottlenecks and capacity remain runtime claims that must be verified through instrumentation and load tests.

## 2. Platform decision

Retain Vercel, Railway, and Supabase for the current scaling phase.

The existing providers are capable of supporting the near-term target. The more immediate constraints are application-level:

- Page-specific data fetching lacks a shared client cache.
- Many routes issue several independent Supabase and Railway requests.
- Realtime events can trigger broad refetches.
- Cron and user-facing HTTP traffic share one Railway process.
- Rate limiting is stored in process memory and cannot safely span replicas.
- There is no defined load-test gate or performance budget for releases.

A platform migration would not, by itself, fix these issues. It would add migration risk close to the June 20, 2026 relaunch.

### Platform-specific decisions

**Vercel:** Retain for the Vite SPA and global static delivery. Moving the same SPA to another static host is unlikely to improve in-app navigation materially.

**Railway:** Retain for the persistent Express runtime. Before multiple replicas are introduced, cron ownership, rate limiting, and cross-instance coordination must be separated from process-local state.

**Supabase:** Retain for Postgres, Auth, RLS, and selective Realtime. Optimize queries, indexes, payloads, and cache behavior before increasing compute or considering migration.

**Cloudflare:** Keep as an optional later edge layer for public or broadly shared reads. Do not add it until measurements show meaningful geographic origin latency or cacheable traffic.

**Next.js or another frontend rewrite:** Not required for the target. A well-designed Vite SPA with route preloading, shared data caching, and optimistic interactions can provide the intended experience.

## 3. Experience contract

### 3.1 Interaction classes

Use three interaction classes according to risk.

#### Immediate optimistic state

The UI updates immediately and rolls back on failure.

Examples:

- Watchlist changes
- Marking notifications as read
- Local filters and sorting
- Non-financial preference changes

#### Immediate pending state

The UI immediately acknowledges the action but labels it as pending until the server confirms it.

Examples:

- Training selection
- Transfer offers
- Contract or academy decisions
- Other actions whose acceptance can fail because game state changed

#### Server-confirmed final state

The UI reacts instantly to the click, but does not claim the final outcome before server confirmation.

Examples:

- Auction leadership
- Balance changes
- Purchases, payouts, and loan transactions
- Deadline-sensitive or competing writes

An auction bid may immediately show "Submitting bid", but must not show the manager as leading until the authoritative write succeeds.

### 3.2 Loading behavior

- Preserve the app shell during navigation.
- Prefer cached content, skeletons, and localized pending indicators over full-page spinners.
- Preserve scroll position, filters, and useful prior data.
- Do not blank a page while background revalidation runs.
- Surface stale or disconnected state when it affects a competitive action.

## 4. Client data architecture

Adopt TanStack Query, or an equivalent shared query-cache library, as the standard client data layer.

The library selection should be confirmed during implementation planning, but the required capabilities are:

- Stable query keys by domain and entity
- Request deduplication
- Stale-while-revalidate behavior
- Background refresh
- Optimistic mutation support with rollback
- Targeted invalidation
- Prefetching
- Cache inspection and test utilities

### 4.1 Freshness classes

| Data class | Typical freshness | Update mechanism |
|---|---:|---|
| Auction bids, leaders, deadlines | 0-2 seconds | Realtime plus authoritative mutation response |
| Balance, notifications, transfer status | 5-15 seconds | Targeted invalidation, background refresh, selective Realtime |
| Riders, teams, standings, recent results | 30-60 seconds | Cached reads and background revalidation |
| History, Hall of Fame, help, static configuration | Minutes or longer | Long-lived cache and explicit invalidation |

These are defaults, not blanket guarantees. Each query must document its correctness requirements.

### 4.2 Navigation prefetch

Prefetch both route code and critical data when intent is reasonably clear:

- Pointer hover or keyboard focus on desktop navigation
- Touch-down or navigation intent where safe on mobile
- High-probability next destinations after login
- Entity detail data when a visible row is likely to be opened

Prefetch must be budgeted. It should not download every route or flood the API on low-bandwidth devices.

### 4.3 Realtime invalidation

Realtime events should invalidate or patch the narrowest relevant cache key. They should not normally call a page-wide `loadAll`.

Examples:

- An auction event updates the affected auction entity and relevant list summary.
- A notification event updates the notification list and unread count.
- A standings update invalidates the active season and affected division.

## 5. Frontend rendering and delivery

- Retain route-level lazy loading.
- Add intentional chunk boundaries for unusually heavy components and libraries.
- Keep rarely used admin, export, analytics, and charting code out of critical routes.
- Virtualize long lists when DOM size or render cost is measured as significant.
- Use pagination or windowing for large result sets.
- Add bundle-size budgets and route-level bundle reporting to CI.
- Measure render and interaction costs on representative mobile hardware, not only development machines.
- Keep mobile 4G as a minimum safety profile while prioritizing actual traffic segments from production telemetry.

## 6. Read-path design

Direct Supabase reads remain appropriate for simple RLS-protected entity queries. Request-heavy screens should use purpose-built read models or aggregate endpoints when this reduces round trips and duplicated work.

Priority candidates include:

- Dashboard bootstrap
- App-shell identity, team summary, unread count, and feature availability
- Finance overview
- Transfer workspace
- Team overview

Aggregate endpoints must remain bounded and explicit. They should not become generic endpoints that return an entire account graph.

Guidelines:

- Select only required columns.
- Avoid `select("*")` on hot paths.
- Run independent server-side reads concurrently.
- Paginate potentially growing collections.
- Prefer compact, stable response contracts.
- Apply short response caching only where authorization and invalidation are well understood.

## 7. Backend topology

### 7.1 Web process

The Railway web service owns:

- Authenticated commands
- Transactional game rules
- Fast read endpoints that require backend composition
- Health and readiness reporting

User-facing request latency must not depend on long-running cron or simulation work.

### 7.2 Worker process

Move scheduled and heavy background work into a separately deployable worker before horizontal web scaling.

Worker requirements:

- Idempotent jobs
- Retry policy with bounded backoff
- Dead-letter or failure visibility
- Distributed ownership or locking
- Correlation IDs and Sentry context
- Safe shutdown and resumability

The first implementation may reuse the existing codebase and Railway project. It does not require microservices.

### 7.3 Redis trigger

Do not add Redis only for architectural fashion. Add a managed Redis-compatible service when one of these becomes true:

- The Railway web service uses more than one replica.
- Rate-limit state must be shared across instances.
- A durable job queue is required.
- Distributed locks or short-lived shared cache provide measured value.

At that point Redis can support:

- Shared rate limiting
- Job queues
- Distributed locks
- Short-lived computed response caching

## 8. Database performance

Establish evidence before scaling compute.

Required practices:

- Enable and review `pg_stat_statements`.
- Capture slow-query and high-frequency-query reports.
- Inspect query plans for the hottest user journeys.
- Add composite or partial indexes based on observed filters and ordering.
- Track row counts and index growth for high-write tables.
- Monitor connections, CPU, memory, disk IO, and cache hit ratios.
- Use the correct Supabase connection or pooler mode for each runtime.

Read models, materialized views, or denormalized summaries may be introduced for expensive, frequently read projections such as standings or dashboard summaries. They must have explicit refresh and correctness contracts.

Supabase compute should be upgraded only after software-level bottlenecks are addressed and load testing shows a resource constraint.

## 9. Observability and performance budgets

Measure production separately by device class, browser, geography, and important route.

### User experience targets

- Cached navigation to useful content: under 100 ms
- INP p75: under 150 ms
- LCP p75: under 2.0 seconds
- CLS p75: under 0.05

### Service targets

- Ordinary read endpoints p95: under 300 ms
- Critical write endpoints p95: under 500 ms
- Error rate during target load: under 0.5 percent
- No material degradation at 500 concurrent managers

### Required telemetry

- Vercel Speed Insights for field Core Web Vitals
- GA4 for traffic segmentation and journeys
- Clarity for qualitative friction and device-specific behavior
- Sentry for frontend and backend errors, traces, and affected users
- Backend route latency, status, and request volume
- Database query timing and connection metrics

Review performance monthly and after major releases. Production traffic determines priority, while a mid-range mobile device on 4G remains the regression safety profile.

## 10. Capacity verification

**Realtime is the most likely first capacity bottleneck for this game, not database CPU.** CyclingZone is a live-auction product. Supabase Realtime connection and message limits, combined with the current broad-refetch pattern (a single Realtime event triggering a page-wide reload), are more likely to bind first. The `loadAll` pattern is present 62 times across 17 pages as of 2026-06-13. Treat Realtime connection counts, message rates, and refetch fan-out as first-class load-test outputs, not secondary metrics. Replacing broad refetches with targeted invalidation (auctions first) is tracked in [#1374](https://github.com/NicolaiDolmer/CyclingZone/issues/1374).

Capacity claims must be tested through representative scenarios rather than a single synthetic endpoint.

Load-test journeys should include:

- Login and app-shell bootstrap
- Dashboard navigation
- Rider search and detail opening
- Team and standings reads
- Auction viewing with concurrent bids
- Transfer offer submission
- Notification and presence traffic

Tests should ramp through 100, 250, and 500 concurrent managers and record:

- End-to-end latency percentiles
- Error and timeout rate
- Railway CPU and memory
- Supabase CPU, connections, IO, and query latency
- Realtime connection and message behavior
- Cost estimates at sustained and burst traffic

Competitive writes require concurrency correctness tests in addition to throughput tests.

## 11. Delivery phases

### Phase 0: Establish the baseline

- Add journey and route-level timing.
- Record request counts and payload sizes for priority pages.
- Capture current bundle sizes and Core Web Vitals.
- Define repeatable load-test fixtures.
- Document the current Supabase compute tier and Railway resources.

Exit gate: the team can identify the slowest journeys and distinguish network, render, API, and database time.

### Phase 1: Make navigation feel immediate

- Introduce the shared query cache.
- Convert app-shell and priority routes incrementally.
- Add stale-while-revalidate defaults by data class.
- Add route and data prefetch.
- Implement risk-based optimistic and pending UI.
- Replace broad realtime refetches with targeted invalidation.
- Remove avoidable full-page loading states.

Suggested order:

1. App shell and dashboard
2. Riders and rider detail
3. Team
4. Auctions
5. Transfers and finance
6. Remaining lower-traffic routes

Exit gate: priority cached navigations meet the 100 ms perceived-response target and no correctness regressions are found.

### Phase 2: Prove 500-manager capacity

- Optimize hot database queries and indexes.
- Add bounded aggregate read endpoints.
- Separate worker and web workloads.
- Run staged load and concurrency tests.
- Add a Railway replica and shared infrastructure only if the measured single-instance limit requires it.

Exit gate: representative load meets the latency and error budgets at 500 concurrent managers within the cost ceiling.

### Phase 3: Scale beyond the initial target

- Add read models where query evidence supports them.
- Introduce Redis-backed coordination if multiple instances require it.
- Add a Cloudflare edge layer for public or broadly shared traffic if geographic latency justifies it.
- Reassess Supabase compute and Realtime limits based on actual usage.

## 12. Platform reconsideration triggers

Reopen the platform decision if one or more of these conditions is verified:

- Railway cannot meet latency or availability targets after application optimization and appropriate scaling.
- Supabase compute, Realtime, or egress cost becomes disproportionate to usage.
- Infrastructure exceeds DKK 1,000 per month before supporting 500 concurrent managers.
- At least 30 percent of reads are public or shared and experience material origin latency.
- The game evolves toward large-scale coordinated realtime simulation that does not fit selective database events.
- Required regional placement, failover, or compliance cannot be met economically.

Potential alternatives should then be benchmarked against the current stack, not chosen from feature lists alone.

## 13. Cost posture

The design deliberately delays additional infrastructure until triggered by evidence.

Expected near-term paid components are:

- Existing Vercel plan and usage
- Existing Railway service
- Existing Supabase Pro project
- Existing monitoring services

Possible later additions are a small Redis-compatible service, a separate Railway worker, or Cloudflare Workers. Each addition must include a cost estimate and a measurable problem it solves.

## 14. Error handling and resilience

- Keep stale data visible during transient read failures when it is safe.
- Show actionable retry states instead of blank screens.
- Roll back failed optimistic changes.
- Distinguish rejected game actions from transport failures.
- Use idempotency keys for retryable high-value writes where duplicate execution is possible.
- Apply timeouts and bounded retries to backend dependencies.
- Degrade non-critical analytics, presence, and decorative data before blocking core gameplay.

## 15. Verification strategy

Implementation work must include:

- Unit tests for cache keys, mutation rollback, and invalidation rules
- Integration tests for aggregate endpoint contracts
- Concurrency tests for auctions and financial writes
- Browser tests for cached navigation and loading behavior
- Bundle-budget checks
- Database query-plan review for changed hot paths
- Repeatable load tests for the target journeys
- Production monitoring after staged rollout

Performance improvements must not be accepted solely from local Lighthouse scores. Field data and backend/database evidence are the authoritative measures.

## 16. Scope boundaries

This design does not authorize:

- A platform migration
- A frontend framework rewrite
- Immediate adoption of Redis, Cloudflare, or microservices
- Relaxing server authority for competitive or financial actions
- Treating estimated capacity as runtime-verified capacity

Those decisions require implementation plans or new evidence.

## 17. Documentation impact

This specification is a design-only change. It does not alter player-facing behavior or game mechanics, so Patch Notes and Help/FAQ updates are not required.

## 18. Primary external references

- Vercel pricing and caching: https://vercel.com/pricing
- Railway pricing and replica limits: https://railway.com/pricing
- Supabase billing and quotas: https://supabase.com/docs/guides/platform/billing-on-supabase
- Supabase compute and connection limits: https://supabase.com/docs/guides/platform/compute-and-disk
- Supabase Realtime limits: https://supabase.com/docs/guides/realtime/limits
- Supabase connection pooling: https://supabase.com/docs/guides/database/connecting-to-postgres
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
