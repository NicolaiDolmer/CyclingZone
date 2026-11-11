# #2230 — browser evidence, 11 November 2026

Before: compiled baseline `3e62633c7`. After: product commit `d35929658`.
`annotated-before-after.png` composes original browser screenshots; annotations are outside the UI pixels. `comparison.html` and `summary.json` contain the same eight groups.

## Reproduce

Build both revisions with the repository E2E build environment. From the PR worktree, run `node scripts/measure-loading-cls.mjs before <baseline-dist>` and `node scripts/measure-loading-cls.mjs after <PR-dist>` behind `scripts/verify-lock.ps1 -Max 2`, then `node scripts/capture-loading-comparison.mjs`. These scripts start and stop their own compiled static servers and browsers. They never read production credentials.

Protocol 2: Chromium 156.0.8078.4; five fresh browser contexts per group; desktop 1280×900, mobile 393×852; DA; fixed clock 2026-11-11T12:00Z; synthetic fixtures; API latency 300 ms, result/ranking cards 3000 ms; observe six seconds after heading readiness. Results scenario scrolls to that card during loading. CLS excludes recent input and uses the largest session window (1 s gap / 5 s maximum). No CPU throttle. Host load is not fully controlled; medians and every raw sample are retained. The generic schedule fixture is overridden to respect the requested date. Earlier exploratory captures without this correction are not included as evidence.

## Interpretation and limits

All eight median CLS comparisons improve; this does not establish zero production CLS. The bounded 500 ms initial presence wait reduces late top-card insertion. Dashboard LCP increases by 352–476 ms in the empty-day/results cases; the calmer layout has a measured initial-paint cost. Desktop race-day LCP selects an earlier candidate and must not be read as a corresponding improvement in data readiness. Very late conditional content can still move after the bounded wait. Long content grows naturally; reserved empty lists retain whitespace.

`ui/observations.json` records 16 additional route/language/theme/viewport combinations. All eight dashboard combinations measured results at 320 px and ranking at 280 px before/after loading, no skeleton animations and no horizontal document overflow. The screenshots use synthetic data. Dark placeholders are faint (P2 visual follow-up); an existing long winner-name layout can consume the adjacent race-name column on mobile. Neither finding is a claim of full accessibility compliance.

Clarity's 9–11 November all-page field baseline was p75 CLS 0.48 across 1,330 page views, not a route baseline. Speed Insights had no events. Clarity follow-up belongs after release; Search Console is delayed grouped field data. LAB numbers here are not production percentiles. No analytics subscription or SDK was added.

Bundle gzip: 1425.0 → 1425.4 KiB, measured E2E builds. Existing 1359 KiB + 5% budget (1426.95 KiB) unchanged. Owner preview approval and Claude review/merge remain required.

## Verification

FULL ops: 13,779 passed. Backend: 4,114 passed, 19 skipped. Frontend unit rerun: 5,557 passed. Build and preflight passed before the product commit. Full Playwright run: 2,042 passed, 191 skipped, two desktop failures. Sponsor setup waited for a Danish email placeholder while the captured login was English; academy setup hit Chromium `ERR_NO_BUFFER_SPACE`, then denied localStorage on the failed document. Both affected complete specs passed in a fresh single-worker run (15/15, no retries or code changes). These are disclosed initial failures, not a claim that the first full run was green. All 18 new loading cases passed across the three projects. Independent code re-review found no P0/P1; the visual reviewer recorded the P2 caveats above.
