# #7980 visual evidence

Real browser screenshots using synthetic riders/routes and a fixed test clock.
No production data or live staging verification is represented.
Before/after uses the flag off/on in mocked browser responses; no flag row is
written. The final overview uses fresh desktop/mobile Chromium captures from
the full E2E run on `b93a7560d`.

[Annotated before/after overview](before-after-final.png) ·
[Browsable comparison](comparison-final.html)

- Desktop: 1280 px, Chromium. Mobile: 375 px, Chromium and WebKit.
- `da-*` / `en-*`: the five team plans, qualitative task costs and draft/save flow.
- `*-choices-before-viewport` / `*-plan-before-viewport`: viewport baselines for
  the matching `*-choices-viewport` / `*-plan-viewport` captures. These preserve
  navigation at its real viewport position.
- `climbs-*`: the shared full profile, named route points and selected climb detail.
- `multi-*-controls`: approved choice A, explicit destination stages 3 and 6.
- `multi-*-before` / `multi-*-after`: destination stage 3 before and after its
  route-specific plan is confirmed. The browser scenario also checks that the
  manually saved empty reset on stage 5 survives and that reload retains the plan.

The multi-stage scenario checks keyboard activation on desktop, real hit testing
and a minimum 44 px button height on mobile, and no horizontal page overflow.
The screenshots show the UI; assertions and local PG17 tests provide the separate
evidence for persistence, rollback and concurrent manual-save protection.

Early attacks (#7884) are a separate track. Owner visual review, a staging tester
round and Claude's Help/patch note remain release gates.
