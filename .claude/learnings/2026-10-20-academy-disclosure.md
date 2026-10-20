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

CI follow-up: the combined browser test exhausted its total deadline while
navigating the later knowledge stages on WebKit. Each stage now has an isolated
browser context and named surface steps, preserving every assertion and the
existing timeout instead of increasing the deadline.

The follow-up review found two further direct estimate readers: Training
Development and Graduation Day. Training now renders the shared academy cell;
the graduation coach reads the academy band and stays hedged until final
knowledge. Existing coach copy and legacy non-academy behavior are unchanged.

Owner follow-up: reusing a compact table cell as the entire Scouting tab left
the player without an explanation. The tab now gives the current disclosure
stage in a four-step sequence, the public rating range or no estimate, and
the server's days to the next stage. Short context links to Academy Help.
The owner explicitly requested new EN-first copy in all five locales on
20 October. Browser assertions cover the content, current step and help link
at both widths, in addition to preserving the disclosure ceiling.
