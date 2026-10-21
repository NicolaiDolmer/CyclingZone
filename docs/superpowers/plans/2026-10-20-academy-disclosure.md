# Academy disclosure implementation plan

Goal: one training-based academy forecast on Academy, My Team and rider profile.
Spec: YOUTH_RULES section 4; owner brief #6985 issuecomment-6291093477; Refs #6853.
Design-go: owner 20/10/2026, same brief and direct assignment.

- Reuse rosterPrognosis, training-day counts and staff context in shared estimates and scouting report; owned academy riders only, existing flag gate.
- Return only academy knowledge; suppress independent hidden-cap development projection.
- Extract the existing academy cell to TSX and reuse on profile/scouting/My Team through ScoutablePotentiale; no new player text.
- Test unknown/broad/narrow/final parity, ownership, failures, endpoint payloads and sorting, then browser-check the actual surfaces at desktop and mobile sizes with fixed clocks.
- Run preflight, frontend lint/unit/build, backend tests and affected-tier classifier in foreground, heavy checks under verify semaphore; independent reviewer before push.
- Deliver one PR with both Refs, one before/after composite (1440 and 375), checked user-verification evidence and issue handoff. Claude owns merge/NOW and season-change patch notes.
