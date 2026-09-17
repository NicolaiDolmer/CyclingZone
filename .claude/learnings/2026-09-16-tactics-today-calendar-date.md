# 2026-09-16: next unfinished stage is not today (#5290)

Source confirmed before editing: the Discord screenshot shows the Tactics toolbar, "Stage 4 · today" and a Wednesday lock time. It maps to RaceTacticsTab.jsx, not Planning or Dashboard.

Root cause: the toolbar used stages_completed + 1 as a proxy for today, with no calendar comparison. At the reported Tuesday 18:06 CEST, tomorrow's stage therefore said today. This reproduces away from either UTC or Copenhagen midnight; timezone offset alone cannot explain it. game_day is not used in this expression.

Fix: compare each actual scheduled_at against an injected now using the existing relativeDayKey helper (Europe/Copenhagen). Missing schedule yields no today label. A 30-second timer updates an open tab across midnight. Locking, selection, saving and mechanics are unchanged; help.json and FEATURE_REGISTRY need no update. SSOT: CALENDAR_RULES section 0 and RACE_ENGINE_RULES tactics date rule.

Evidence: before the fix, browser tests failed at the report time and 23:30 Copenhagen, while 00:30 passed. The tests run in America/Los_Angeles to prove the comparison does not use the browser's date. Unit tests explicitly cover both sides of Copenhagen midnight, previous/current/next dates and invalid timestamps. Browser coverage includes the actual toolbar and an open-tab midnight transition.

Earlier cases read: #3724 (date-only formatting), #3119 (game_day versus calendar day), #3773 (measured patch-note dates). Prevention: never infer a calendar label from progress or ordering; test the visible consumer with fixed time as well as the date helper.

Handoff: PR awaits owner merge. NOW.md is owned by the orchestrator and intentionally untouched. No production writes.
