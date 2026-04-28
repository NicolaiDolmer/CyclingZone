# Patch Notes

## 2026-04-28 — UCI-R2 salary recalculation

### Released
- UCI rankings sync now recalculates rider salaries automatically after UCI points are updated.
- Added a manual salary recalculation script: `backend/scripts/recalculateRiderSalaries.js`.
- Reused the existing economy formula for salary updates:
  `max(1, round((max(5, uci_points) * 4000 + prize_earnings_bonus) * 0.15))`.

### Fixed
- Rider value recalculation now paginates Supabase reads, so it covers the full rider table instead of only the first 1000 rows.
- Salary updates run in controlled parallel batches to avoid long single-row update runs timing out.

### Verification
- Backend regression suite passed: 72/72 tests.
- Frontend production build passed.
- Live salary recalculation updated 8699 riders.
- Full live sanity check verified 8699 riders with 0 salary mismatches.
- Production deploy verified for commit `17b74f6` on Vercel and Railway.
