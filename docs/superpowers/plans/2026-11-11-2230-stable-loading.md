# #2230 — stable loading, choice A

Owner build-go: 2026-11-11, [issue record](https://github.com/NicolaiDolmer/CyclingZone/issues/2230#issuecomment-6795797186).

**Contract:** each ready card reveals independently; static neutral gray placeholders retain the same footprint. No pulse/shimmer. Reuse the UI skeleton primitive. Preserve dashboard ordering, conditional visibility and customization from `docs/DASHBOARD_RULES.md` §2–4, card chrome from `docs/design/PAGE_TEMPLATES.md`, and quiet motion from `TASTE.md`. No subscription, analytics SDK, bundle-budget increase or marketing flash.

**Implementation:** measure the unchanged compiled application first. Keep layout prerequisites (identity, warnings and conditional-card presence) together; split independent fixed-card data from the page barrier. Use one typed reserved-body component for loading/data/empty states, with row capacity matching each bounded list and natural expansion for longer text. Keep existing content during refresh. Resolve errors so no permanent skeleton remains. Public landing is prerendered: inspect hydration shifts before changing its geometry.

1. Add reproducible Chromium LAB harness: fixed clock, fixtures, API latency, desktop/mobile, five cold loads per route, CLS session windows and LCP. Save measurements and actual screenshots.
2. Add failing behavior tests for delayed card independence, settled geometry, static animation and error completion. Run before product edits.
3. Implement shared static loading and reserved card bodies; independent readiness, preserving visibility and offline behavior. Update the SSOT loading contract and EN/DA patch note in this PR.
4. Repeat the identical LAB protocol. Inspect mobile/desktop, EN/DA, light/dark, empty/failure/hidden cards and refresh. FULL verification behind `verify-lock.ps1 -Max 2`; all three Playwright projects; independent reviewer before push.
5. One PR, annotated before/after evidence, measured bundle size and preview for owner approval. Claude reviews/merges. Production Clarity follow-up after release; Search Console over its rolling window.

**Evidence boundary:** Clarity 9–11 November all-page p75 CLS 0.48 (1,330 page views), not a route baseline. Speed Insights reports no events. Comparable LAB measurements are the before/after evidence available before merge; do not label them production percentiles. Search Console uses delayed grouped field data.

**Risks:** unknown conditional cards cannot reserve an invented permanent cell; keep presence prerequisites. Reserve bounded-list capacity without clipping or inner scrolling. Slow/failed secondary queries must not block unrelated cards. Distinguish an empty success from still pending. No production writes or merge authorized.
