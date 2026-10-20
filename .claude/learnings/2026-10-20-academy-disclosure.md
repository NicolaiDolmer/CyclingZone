# Academy knowledge across surfaces

Refs #6985 #6853. Owner design-go: 20 October 2026, #6985 issuecomment-6291093477.

The academy roster used training-based knowledge while the shared estimates and
profile scouting report treated all owned riders as fully scouted. This exposed
inconsistent forecasts and bypassed the academy learning process.

The two endpoints now reuse rosterPrognosis with the same team training-day and
staff context. The shared UI renders the existing academy cell, including My Team Development.
Its direct estimate reader must not substitute the generic missing-forecast label. No scout stars,
labels, verdicts or alternative-role forecasts accompany academy knowledge.
The legacy development projection is suppressed for owned academy riders too.
Unknown/error flag reads fail closed; rollout failures cannot restore full scouting.

Regression coverage must exercise endpoint payloads, every knowledge stage,
foreign/senior isolation, unknown sorting and real browser surfaces. Failures
loading training knowledge must never fall back to fully scouted information.
Patch notes are intentionally deferred to Claude's season-change collection,
as instructed by the owner. No feature or flag lifecycle changes.
