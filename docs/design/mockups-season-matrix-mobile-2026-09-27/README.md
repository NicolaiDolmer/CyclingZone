# Season matrix mobile design directions (#5124)

**Status:** Option A approved for build by the owner on 28 September 2026 in [#5124](https://github.com/NicolaiDolmer/CyclingZone/issues/5124). Option B remains a design comparison only.

**Sources:** `docs/PLANNING_CENTER_RULES.md` §§0, 1, 3 and `docs/CALENDAR_RULES.md` §0 govern the two time axes and the existing draft/save contract. `docs/design/PAGE_TEMPLATES.md` T2 and `docs/design/TASTE.md` P10 govern data density, hairline borders, one primary action and mobile overflow. #4535 records that the previous shared-header proposal was rejected; this mockup makes no change to that desktop header.

## Problem

The current rider × race-day grid needs horizontal movement on a phone. The owner asked for a better mobile season matrix with no horizontal scroll. The selection draft and one `Save plan` action must remain available.

## Options

- **A · Race focus (recommended):** Keep a matrix with rider names plus three race-day columns. Select a race, then move through that race's days with explicit Earlier/Later controls. A selected cell opens the existing role choice. The race picker and controls move the time window without horizontal scrolling. The date and race-day number remain distinct.
- **B · Day focus:** Select a season date and stack all overlapping races with their chosen riders. This exposes overlap directly but loses the rider-across-days comparison that makes this a matrix.

Both are shown in `directions.html` and `directions.png` using representative, fictional display data. A live 390 px Season 3 before/after comparison was shown privately to the owner in the Codex chat on 27/9; it is not included in this public repository. A deliberately differs from D-047's `Full table` option because the owner explicitly required no horizontal scrolling in this matrix. The owner approved that exception on 28/9.

## Verification plan after design approval

- **Tier FULL:** the change affects Planning Center markup and selection behavior. Run targeted `seasonMatrix` unit tests, type/lint/build checks, the full frontend e2e suite, and all three Playwright projects where snapshots are touched. Wrap heavy runs with `scripts/verify-lock.ps1`.
- At **390 px**, check long names, 3 race-day cells, race switching, Earlier/Later bounds, overlap cues, cell action, unsaved-change guard, save/error state and `document.documentElement.scrollWidth <= window.innerWidth`.
- At **1440 px**, confirm the current desktop matrix and shared timeline retain their behavior and layout.
- Before merge, show an annotated before/after composite with **real data** at 390 and 1440 px and a working preview link. Ask the owner to try race switching, an edit, Save plan and leaving with unsaved edits on staging.

No API, calendar rule, race engine rule or flag change is proposed.
