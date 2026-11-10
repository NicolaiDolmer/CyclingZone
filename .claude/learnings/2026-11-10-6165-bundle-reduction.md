# #6165 — measured client imports and SSR compatibility

Scope: invisible frontend bundle reduction. Refs #6165.

- Measure the current source/lock before edits. The old green total gate is a
  regression floor, not evidence that the owner's reduction goal is complete.
- Recharts already resolves to ESM. Direct component imports produced a small
  measured reduction; selector annotations added maintenance without a larger
  gain, and explicit chart grouping increased bytes. Keep rejected experiments
  in the measured report rather than product configuration.
- Deep Recharts ESM paths are not directly Node-loadable because their internal
  imports omit extensions. Reproduce that failure, then bundle Recharts for SSR
  and verify actual emitted chart imports plus prerender routes. A successful
  client build alone would miss this compatibility issue.
- Frozen-source chart fixtures must use a real viewport meta tag and verify
  `innerWidth`, load the existing fonts, exercise painted donut pixels instead
  of the bounding-box centre, and wait for consecutive stable screenshots.
- Never label the SPA entry graph as the anonymous homepage: middleware sends
  anonymous `/` to the independent Next marketing site.
- The exact old dependency cache is absent. A lockfile diff identifies changed
  packages, not their causal byte contributions; leave historical attribution
  explicitly unmeasured rather than guessing.

Evidence and limitations: `docs/investigations/2026-11-10-6165-before-after.md`.
