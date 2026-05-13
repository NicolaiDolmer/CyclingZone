# Postmortem: Detector E flagged milestone-gated board event (#335)

## Root cause

`feature_board_consequences_panel_viewed` was correctly listed in `KNOWN_EVENTS`, but it can only fire when `BoardConsequencesPanel` has visible consequences. Board consequences are milestone-gated and are not expected to exist until season-end flows produce them, so Detector E reported a true zero-impression signal that was intentional for the current runtime phase.

## Fix

Added `feature_board_consequences_panel_viewed` to `WHITELIST_ZERO_IMPRESSION_EVENTS` with a comment tying the exception to #284 and the season 1 rollout window.

## Læring

- Zero-impression detectors need temporary allowlists for milestone-gated UX, mirroring table-level allowlists such as `board_consequences`.
- The allowlist comment must include the removal trigger or deadline; otherwise temporary audit exceptions become permanent blind spots.
- Local live-audit verification can be blocked by auth/key state. Record that separately from code verification so auth drift is not mistaken for a failed fix.
