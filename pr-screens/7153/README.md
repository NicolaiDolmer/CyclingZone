# #7153: browser evidence

Real screenshots of the application with the repository's deterministic fixture API, not live player data. Captured 28 October 2026 by `frontend/tests/e2e/7153-selection-rejoin.spec.ts`.

- `panel-*`: new selection is editable after voluntary withdrawal, starts without the historical riders, explains that saving cancels withdrawal; automatic selection remains disabled.
- `matrix-conflict-*`: manual replacement is editable; a rejected save names the rider and competing race.
- `matrix-locked-*`: after lock, the withdrawal message replaces editing controls.
- `matrix-save-*`: a successful replacement contains only the new picks.

Desktop Chromium and mobile Chromium are shown. The same regression also passes in mobile WebKit. Planning SSOT: `docs/PLANNING_CENTER_RULES.md`. Owner design: #7153, comment 6468132613. No production data repair or scheduler change.
