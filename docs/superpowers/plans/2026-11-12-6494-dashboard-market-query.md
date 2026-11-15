# Dashboard and market Query migration
Spec: #6494, issuecomment-6807783111; owner night mandate 11–12 November narrows implementation to Dashboard, Transfers and Auctions. Claude reviews the spec before merge.
Design-go: 12/11/2026, direct owner night mandate. No merge, production, migration, flag activation, NOW, MASTERPLAN or player copy.

- [ ] Capture baseline from 115de657e using identical local fixtures, 375px and desktop.
- [ ] Add pinned TanStack Query v5 with explicit retry, freshness and memory retention settings. Test deduplication, scope cancellation and isolation first.
- [ ] Move scoped server resources behind typed data hooks/repositories. Keep filters/dialogs as UI state and cross-cutting services as named legacy owners.
- [ ] Preserve server-authoritative money/bids and existing API 401/429/abort behavior. Invalidate after confirmed writes and realtime events; no polling or persistent data cache.
- [ ] Frontend lint/test/typecheck/build, preflight and independent review before push. Draft PR at first commit; parent owns full e2e and matched before/after evidence.
- [ ] Document actual completion and remaining gates; never call partial migration complete.

SSOT: DASHBOARD_RULES §2–3, TRANSFER_MARKET_RULES, PAGE_TEMPLATES, TASTE. No ordering/style/copy changes.
Modern Web Guidance CLI 1.0.0 performance: reduce duplicate work, preserve layout and split JS to actual consumers. Query is loaded only by migrated page modules; no devtools. Deviation from generic caching advice: app/API data never enters service-worker or disk cache.
Dependency: @tanstack/react-query 5.107.1, exactly pinned. It supplies the approved shared server-state cache and observer/cancellation behavior; no recurring service cost. Bundle ceilings unchanged.
