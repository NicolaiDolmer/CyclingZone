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
