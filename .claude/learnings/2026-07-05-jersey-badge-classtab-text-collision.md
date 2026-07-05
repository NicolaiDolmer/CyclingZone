# Jersey-badge / classification-tab text collision (#2081)

**Symptom:** CI job `frontend-smoke` failed on PR #2225 with a Playwright strict-mode
violation: `getByText('Bjerg', { exact: true })` matched two elements — the
existing jersey-badge `<span>` (who holds the mountains jersey after this stage)
and a NEW classification-tab `<button>` (added by this PR, labeled "Bjerg" for
the mountains classification). Both are correct, intentional UI; the pre-existing
e2e test (`frontend/tests/e2e/race-detail.spec.js`) just assumed the text
"Bjerg" would only ever appear once on the page.

**Root cause:** This is the SECOND time this exact class of bug has hit this
file. The same test already has a comment (near the "Holdkonkurrence" assertions)
documenting the first occurrence: recap prose text collided with a classification
heading, fixed by scoping to `getByRole("heading", ...)` instead of a bare
`getByText`. This second collision wasn't caught by that precedent because it's
a *different* pair of elements (span vs. button, not prose vs. heading) — the
fix pattern generalizes, but nobody grepped for OTHER label reuses when adding
the classification tabs.

**Fix (PR #2225, commit `c84168a6`):** scoped the jersey-badge assertion to
`page.locator("span", { hasText: /^Bjerg$/ })` — a `<span>` locator structurally
cannot match a `<button>`, so no exact-text ambiguity is possible regardless of
what other UI reuses the same word.

**Why this recurred / how to actually prevent a third occurrence:** the
`detail.classTab.*` i18n keys (Etape/Samlet/Point/Bjerg/Ungdom/Hold) were
deliberately chosen to read naturally as tab labels, and they collide by
design with existing `detail.jersey.*` labels (`points_day`→"Point",
`mountain_day`→"Bjerg", `young_day`→"Ungdom") because both describe the same
underlying concept (points/mountains/youth classification) in the same
language. This is NOT a bug to fix in the app — short tab labels and jersey
badges legitimately share vocabulary. The durable fix is on the TEST side:
**any new e2e assertion on `RaceDetailPage.jsx` (or any page with reusable
short UI labels) should default to a role/element-scoped locator
(`getByRole`, or a tag-scoped `locator("span"/"button", {hasText})`) instead
of a bare `page.getByText(...)`**, precisely because this page's short labels
(jerseys, classification tabs, classification headings) are drawn from a small,
overlapping vocabulary by design.

**Verification lesson:** this branch's local "full verification pass" (plan
Task 11) only ran `core-smoke.spec.js`, not `race-detail.spec.js` — a separate,
pre-existing e2e file covering this exact page. The regression was only caught
by CI, after push, not by local verification. When touching a page that has its
own dedicated e2e spec file (not just `core-smoke.spec.js`'s generic blank-screen
sweep), run that dedicated spec file locally too before declaring "full verify"
done — `core-smoke` is a breadth check, not a substitute for a page's own
targeted regression suite.
