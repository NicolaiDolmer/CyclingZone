# Synthetic beta verification, 11 November 2026

Synthetic authenticated fixtures in a local static preview, captured by
`frontend/tests/e2e/auto-accept2176.spec.ts`. API responses are mocked; real SQL
authorization and financial transactions are verified separately.

`eligible`: the approved auto-price row. `ineligible-false/true`: no auto-price
or start button for an excluded pair, regardless of the viewer's feature flag.
`ordinary-counter`: the existing normal counteroffer form above the hidden price.

All three browser projects captured these states on 11 November. The capture
resets horizontal scroll so the first table columns and expanded content are
visible; the existing desktop table still has more columns to the right.
The expanded form is scrolled into view before capture, with its Send action
checked above the fixed mobile navigation. This is an evidence position, not
a change to the page's layout or initial scroll position.

`before-after.png` compares an excluded pair (normal negotiation) with an
eligible beta pair in the same build, on desktop and mobile Chromium. It is
an eligibility comparison, not a production rollout. All twelve browser source
images remain here. In the WebKit eligible capture the sticky table header
partly covers the rider row; the auto-price and all form actions remain clear.

The full suite's result is recorded separately in the PR body; screenshots do
not establish that the suite passed. Owner visual approval and staging/Fable
verification remain release gates. No production apply or activation is part
of this verification.
