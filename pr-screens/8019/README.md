# #8019: stable loading evidence

Public synthetic fixture evidence for draft [#8022](https://github.com/NicolaiDolmer/CyclingZone/pull/8022). No production customer, account, telemetry or financial data. Screenshots are unmodified browser captures; all names and values come from local E2E fixtures.

Runtime before: `2b0af720f`. Runtime after: `db78ea6e3`. Evidence-only close-out does not change that runtime or its tests.

## Measured scope and method

- Local static production/E2E builds, same synthetic authenticated fixtures; mobile **375 x 812**, desktop **1440 x 900** CSS pixels.
- Native Chromium-harness initial CLS is captured **before interaction**. Empty-stage date: `2026-09-29T21:00:00Z`; filled-stage date: `2026-09-30T10:00:00Z`. Clock is explicitly injected.
- Native normal profiles: 650 ms delay for API/PostgREST requests, 6500 ms settle. Slow filled-stage profiles: 1200 ms delay, 12000 ms settle. Three pages x two viewports x three scenarios = **18 after cases**.
- Lighthouse **13.6.0** navigation: three runs for each page/viewport profile (**18 after runs**); tables show medians, with after CLS ranges. Auctions uses canonical `/auctions?tab=all`; native navigation also exercises `/auctions` and its initial default.
- Lighthouse uses simulated throttling: mobile 150 ms RTT, 1638.4 Kbps throughput and 4x CPU slowdown; desktop 40 ms RTT, 10240 Kbps and 1x CPU. Both use device scale factor 1. The native injected request delays above are a separate setup.
- INP is measured separately with native trusted click/keyboard flows, not by Lighthouse navigation. All final native flows reported **16 ms** and no horizontal page overflow.
- Native and Lighthouse CLS were **< 0.05 in every measured after case**. Native maximum: **0.02799246024**; Lighthouse maximum: **0.04985055272**. This proves only the profiles above.
- Performance scores vary and LCP did not show a consistent improvement. No causal speedup, production RUM, field-performance or general-device claim is made. Some auxiliary Lantern insights warned; the primary Lighthouse metrics had no runtime error.
- Exact sanitized values: [measurements.json](measurements.json). Full raw Lighthouse JSON and private execution logs are intentionally not published.

## Lighthouse navigation medians

| Profile | Route | Performance before / after | CLS before / after | LCP ms before / after | After CLS range |
|---|---|---:|---:|---:|---:|
| mobile | `/dashboard` | 65 / 71 | 0.16426 / 0 | 16734 / 16765 | 0 - 0 |
| mobile | `/transfers?tab=market` | 64 / 68 | 0.00173 / 0.00173 | 14322 / 14305 | 0.00173 - 0.01523 |
| mobile | `/auctions?tab=all` | 96 / 92 | 0.07148 / 0.00901 | 1507 / 1508 | 0.00829 - 0.00901 |
| desktop | `/dashboard` | 80 / 80 | 0.04985 / 0.03238 | 3689 / 3699 | 0.03238 - 0.04985 |
| desktop | `/transfers?tab=market` | 83 / 83 | 0.01942 / 0.01942 | 2884 / 2874 | 0.01942 - 0.01975 |
| desktop | `/auctions?tab=all` | 84 / 84 | 0.02119 / 0.02118 | 2698 / 2719 | 0.02118 - 0.02919 |

## Native initial CLS and separate interaction INP

INP values below are native trusted-input measurements. They are not Lighthouse navigation INP, and the observed desktop change is not a causal improvement claim.

| Profile | Route | Empty CLS before / after | Filled CLS before / after | Slow filled CLS after | Native INP ms before / after |
|---|---|---:|---:|---:|---:|
| mobile | `/dashboard` | 0.32955 / 0 | 0.08627 / 0 | 0 | 16 / 16 |
| mobile | `/transfers?tab=market` | 0.01523 / 0.01523 | 0.01523 / 0.01523 | 0.01523 | 16 / 16 |
| mobile | `/auctions` | 0.1254 / 0.00897 | 0.1254 / 0.00897 | 0.00845 | 16 / 16 |
| desktop | `/dashboard` | 0.15287 / 0.02799 | 0.03505 / 0.02799 | 0.02045 | 24 / 16 |
| desktop | `/transfers?tab=market` | 0.01635 / 0.01635 | 0.01635 / 0.01635 | 0.01034 | 16 / 16 |
| desktop | `/auctions` | 0.01635 / 0.01635 | 0.01635 / 0.01635 | 0.01034 | 16 / 16 |

## Before / after screenshots

These are the matching 650 ms empty-stage captures. Pending captures are taken before data settle; settled captures show the final layout. The first-layout behavior is quantified by the native measurements above, not inferred from a still image.

| Page | 375 before | 375 after | 1440 before | 1440 after |
|---|---|---|---|---|
| Dashboard | [before](./before-mobile-dashboard-settled.png) | [after](./after-mobile-dashboard-settled.png) | [before](./before-desktop-dashboard-settled.png) | [after](./after-desktop-dashboard-settled.png) |
| Transfer market | [before](./before-mobile-transfers-settled.png) | [after](./after-mobile-transfers-settled.png) | [before](./before-desktop-transfers-settled.png) | [after](./after-desktop-transfers-settled.png) |
| Auctions | [before](./before-mobile-auctions-settled.png) | [after](./after-mobile-auctions-settled.png) | [before](./before-desktop-auctions-settled.png) | [after](./after-desktop-auctions-settled.png) |

### Loading captures

| Page | 375 before / after | 1440 before / after |
|---|---|---|
| Dashboard | [before](./before-mobile-dashboard-pending.png) / [after](./after-mobile-dashboard-pending.png) | [before](./before-desktop-dashboard-pending.png) / [after](./after-desktop-dashboard-pending.png) |
| Transfer market | [before](./before-mobile-transfers-pending.png) / [after](./after-mobile-transfers-pending.png) | [before](./before-desktop-transfers-pending.png) / [after](./after-desktop-transfers-pending.png) |
| Auctions | [before](./before-mobile-auctions-pending.png) / [after](./after-mobile-auctions-pending.png) | [before](./before-desktop-auctions-pending.png) / [after](./after-desktop-auctions-pending.png) |

### Actual per-card progressive loading

Unlike the early global-readiness captures above, these four captures hold `race_stage_profiles`, `recent-results` and `rider-ranking` responses. At both 375 and 1440, the team is visible while the recent-results and rider-ranking regions remain pending; no horizontal overflow occurs. This preserves the existing independent fixed-card loading behavior. After the fix, real base stage cards do not wait for optional profile enrichment. Compact before/after observations are in [verification.json](verification.json).

| 375 before | 375 after | 1440 before | 1440 after |
|---|---|---|---|
| [before](./before-mobile-dashboard-progressive.png) | [after](./after-mobile-dashboard-progressive.png) | [before](./before-desktop-dashboard-progressive.png) | [after](./after-desktop-dashboard-progressive.png) |

### Filled-stage Dashboard

| 375 before | 375 after | 1440 before | 1440 after |
|---|---|---|---|
| [before](./before-mobile-dashboard-stages-settled.png) | [after](./after-mobile-dashboard-stages-settled.png) | [before](./before-desktop-dashboard-stages-settled.png) | [after](./after-desktop-dashboard-stages-settled.png) |

What to inspect: the empty day has no transient stage strip; the filled day keeps real fixed-height stage cards while optional details arrive; the result badge occupies its first-render space; auction actions start on their settled mobile row; the initial no-involvement default does not paint an empty pane before All. Explicit/manual Mine and last-owned-auction completion are covered by browser regressions.

## Delivery gates

- Runtime source: independent review found no actionable P0/P1 after the final one-time-default correction.
- Local checks on runtime SHA: 81 focused/core browser cases across all three projects, 5559 frontend unit tests, strict TypeScript, preflight and production build passed. Existing core snapshots are unchanged.
- Gzipped JS: **1425.8 KB**, below the unchanged **1426.95 KB** ceiling.
- Full production-build E2E: **2107 passed, 191 skipped, 0 failed, 0 flaky, 0 retry attempts**, 30.9 minutes; 2298 configured across all three projects. Desktop 739 passed/27 skipped; mobile Chromium 691/75; mobile WebKit 677/89. Observed process exit: 0. Sanitized counts: [verification.json](verification.json).
- Reused nightly backend/root FULL baseline: **23832 passed, 17 skipped, 12 todo, 0 failed** on unchanged backend tree `b890f4dca`; this is not a new FULL run. The full tree identity is recorded in verification.json.
- Owner preview/release remains a separate gate. Final independent evidence review and the repeated pre-push checks passed. The PR stays draft, ready for Claude review; owner preview/release is still pending.
