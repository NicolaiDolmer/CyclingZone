# 2026-06-01 — Board DNA must precede board-member assignment

## Incident

Issue #820 showed that managers could see a board voice such as `klassiker_purist` even when their club direction was not classics-focused.

## Root Cause

`startSequentialNegotiation` assigned `team_board_members` immediately at season-1 close from `season_1_identity_basis` alone. Club DNA was chosen later, so the first board composition could not use `team_dna_key` and could feel mismatched.

## Fix Pattern

Treat Club DNA as the mandatory first season-2 board choice. Assign or regenerate board members only after DNA exists, and make auto-accept choose the best DNA suggestion before signing a plan.

## Guardrail

Any future board-member selection path must pass both `identityBasis` and `dnaKey`, except explicit tests for the pre-DNA gated state.
