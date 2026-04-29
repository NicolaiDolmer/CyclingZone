# Season 6 Repair Verification — 2026-04-29

Command:

```powershell
cd backend
npm run season:end:verify-repair -- --markdown
```

## Service-visible result

- Season 6: `cc4410b4-9d19-4996-adbf-369e5b9e2df8`, `completed`, `end_date=2026-04-29`.
- Human non-frozen teams: `24`.
- Standings teams: `25`; all 24 human teams are covered.
- Salary rows: `5` teams, matching the 5 currently rostered human teams.
- Season-tagged finance side effects visible:
  - `salary`: `5` rows, total `-5118401`.
  - `loan_interest`: `6` rows across `4` teams, total `-644909`.
  - `sponsor`: `24` rows, total `9600000`.
  - `prize`: `10` rows, total `2922`.
- Board snapshots: `72` rows for `72` human board profiles.
- Duplicate board snapshots: `0`.
- Known promotions still correct:
  - `Ankuva CT`: Division 2.
  - `Liams geder`: Division 2.

## Finding

Verification found `3` active emergency-loan teams but `0` season-tagged `emergency_loan` finance rows for season 6.

Service-visible unseasoned emergency-loan finance rows:

| Team | Amount | Created at |
|---|---:|---|
| Liams geder | 809267 | 2026-04-29T12:16:02Z |
| Suconia STNS Cycling Team | 1251642 | 2026-04-29T12:16:07Z |
| Guinness Cycling | 775730 | 2026-04-29T12:16:12Z |

Root cause: `createEmergencyLoan` inserted `finance_transactions.type='emergency_loan'` without `season_id`, while `processTeamSeasonEnd` had the season context. That also made repair idempotence unable to see existing emergency-loan rows by season.

## Repo fix

- `createEmergencyLoan(teamId, amountNeeded, supabaseClient, seasonId)` now writes `season_id`.
- `processTeamSeasonEnd` passes the season id when creating emergency loans.
- Regression tests cover the season-tagged finance row.
- Verifier script reports unseasoned emergency-loan finance rows explicitly.

## Live data follow-up

`database/2026-04-29-backfill-season6-emergency-loan-finance.sql` was applied live on 2026-04-29 through the service-visible path. It updated exactly 3 rows.

Post-backfill verification:

- `emergency_loan`: 3 season-tagged rows across 3 teams, total `2836639`.
- Active emergency-loan teams: 3.
- Unseasoned emergency-loan rows visible: 0.
- All verifier checks: OK.

Do not rerun full season-end or repair for this issue.
