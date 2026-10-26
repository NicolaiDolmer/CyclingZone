# Retirement notice display during cutover

Refs #7235. Design-go: 26 October 2026 owner-approved day plan on #7153.
SSOT: PROGRESSION_RULES section 6; a frozen retirement notice is a promise.

- The active season advances before retirement finishes. The endpoint resolved against that new season and returned only a boolean; the profile independently used its own season snapshot.
- A deterministic old-code probe returned season 5 for an outstanding season-4 promise. No production retirement-status endpoint was called because it can lazy-freeze.
- Display reads retain an outstanding stored promise and the previous-season guaranteed-retirement answer until the rider is retired. Retired riders receive no new promise. Cutover retains its existing explicit-season resolver.
- The response carries retirement_after_season; the profile uses that response snapshot. Old boolean-only backend responses retain the previous frontend fallback.
- Tests cover frozen yes/no, current/older promises, guaranteed retirement without a stored roll, retired riders and independently advanced frontend season. New tests do not read the wall clock.
- No retirement probabilities, ages, production data, flags, migrations or cutover outcomes change. No patch notes per the owner's instruction. PC1 owns release and production verification.
