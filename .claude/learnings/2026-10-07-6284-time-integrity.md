# Official time integrity (#6284)

The shared result bridge capped official stage gaps before persistence. GC
therefore accumulated the capped representation rather than the official gap.
The original contract test was recovered unchanged from the previous lane and
observed RED before implementation.

Keep display policy separate from authoritative saved results. This change is
gated by a new immutable race revision branching from v2 mechanics; a newer
revision identity must not implicitly opt into v3 mechanics. Existing pinned
races and stored results remain unchanged. Activation requires a separately
approved additive DB allow-list change and a separately approved default change.

Private design/simulation evidence remains in the owner's existing private
analysis directory; no private population identifiers or calibration are copied.

Validation: the original test blob is unchanged. Targeted contract/adapter/runner
and pin regressions passed, as did FULL local verification and strict engine
TypeScript checking. Paired runs on the same five private stage fixtures passed
raw v2 output parity, official saved gaps and resumed GC integrity. This is a
new-seed contract comparison, not a replay or a time-model calibration approval.

Scope extended by the owner on 7 October: #6327 shares this future revision.
Endpoint-only proximity missed a descent attack when another group passed it
between checkpoints. Reconciliation now occurs after tempo movement and after
pursuit; a known pursuit catch remains authoritative and is not reported twice.
Finish rank no longer invents a missing descent-catch actor in this revision.

The original A-only raw-v2 parity proof predates that added physical correction.
After #6327, new-revision output may intentionally differ at real descent contact.
Old legacy/v1/v2/v3 complete outputs were measured byte-identical against the
pre-extension commit on five fixed fields (20 comparisons). Three loop cases and
contact/history edge cases were first RED, then GREEN. E14/e16 fixtures preserve
measured relative positions with synthetic identities, not historical seed replay.

Owner checkpoint 7 October: activation choice B. Official time integrity and
physical descent contact must activate together with the approved #6199 model.
Contact at checkpoints and contact-based outcomes remain provisional until the
owner reviews the annotated same-data film card. No historical rewrite.
Independent review added RED-to-GREEN cases for final bunch and selective final
pools, a last-segment attack losing its original group ID, and preservation of
morning-break provenance during a downhill move.

Final #6327 verification (7 October): 18 focused regressions pass; strict engine
TypeScript passes; FULL passes 13,215 backend tests (4 existing skips), 141
isolated tests and 4,423 frontend tests, plus frontend build. Independent review
findings were reproduced RED, corrected and re-reviewed without remaining P1/P2.
All 20 old-revision complete-output digests still match the pre-extension base.
The five-field, five-seed paired contract run reports 19/25 changed future-revision
outputs, with official saved times and resumed GC integrity passing. This is
explicitly not v2 physics parity or calibration approval after #6327.
