# Economy Baseline & Simulation — 2026-04-29

## Scope
- Live read-only data, no writes.
- Active team/loan state from season 7.
- Latest completed result sample from season 6.
- Local scenario templates for competent active managers, because live season 7 has no races yet and current human divisions have no Division 1 teams.

Important correction:
- Cycling Zone currently has a result-points system.
- A real CZ$ prize-money economy is not fully designed/implemented yet.
- Any `Prizes`/`prize_money` values in this report should be treated as existing result/import placeholder data, not as the final prize-money model.
- Larger economy tuning should wait until real prize-money payouts are designed, implemented, and included in a rerun baseline.

Repeat with:

```powershell
node backend/scripts/economyBaselineSimulation.js --markdown
```

or:

```powershell
cd backend
npm run economy:baseline -- --markdown
```

## Live Baseline

Live source:
- Season 7: active teams/current loans.
- Season 6: 98 races, 709 result rows.
- Read-only visibility still shows `0` finance transactions for season 6, so finance row verification remains an admin/service-visible task.
- Read-only sees `0` `board_profiles`, so live forecast uses neutral sponsor modifier where board data is not visible.

| Division | Teams | Avg riders | Sponsor | Salaries | Prizes | Loan interest | Net before emergency | Emergency teams | Emergency amount | Active debt |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2 | 2 | 5.5 | 480,000 | 2,279,047 | 4,372 | 213,647 | -2,008,322 | 1 | 1,832,435 | 1,068,233 |
| 3 | 22 | 0.9 | 5,280,000 | 2,839,354 | 1,021 | 558,246 | 1,883,421 | 2 | 2,418,559 | 2,905,082 |

Interpretation:
- Division averages are misleading because many live human teams are empty or nearly empty.
- Active squads with 9-10 riders and star-heavy salary profiles are already in automatic emergency-loan territory.
- Current `prize_money`/finance-like values are effectively negligible at current scale, but they must not be treated as final prize-money design.
- Sponsor and salary dominate cashflow in this placeholder baseline.
- Current manual loan ceilings are low (`240k-360k`) while emergency-loan debt can exceed `1M`; that split makes planned borrowing too constrained and emergency borrowing too dominant.

## Local Competent Manager Scenario

Scenario assumptions:
- Division 1: 22-rider contender roster, 1,150,000 salary, placeholder 160,000 cash-result income.
- Division 2: 15-rider competitive roster, 650,000 salary, placeholder 70,000 cash-result income.
- Division 3: 9-rider lean roster, 310,000 salary, placeholder 25,000 cash-result income.
- 8 teams per division, 800,000 starting balance.

### Current Rules

Current rules keep sponsor flat at 240,000/team and salary at the existing runtime scale.

| Division | Teams | Sponsor | Salaries | Prizes | Net before emergency |
|---:|---:|---:|---:|---:|---:|
| 1 | 8 | 1,920,000 | 9,200,000 | 1,280,000 | -6,000,000 |
| 2 | 8 | 1,920,000 | 5,200,000 | 560,000 | -2,720,000 |
| 3 | 8 | 1,920,000 | 2,480,000 | 200,000 | -360,000 |

Conclusion: current rules are not "stram men fair" for active competent managers above the leanest Division 3 profile.

### Strict Fair Candidate

This is a candidate target, not an implemented change:
- Effective salary multiplier: `0.67` of current salaries (roughly salary rate `15% -> 10%`).
- Division sponsor: D1 `600,000`, D2 `400,000`, D3 `260,000`.
- Prize scale left unchanged for local scenario; separate prize tuning still needs runtime decision because live prize rows look tiny relative to the 4000x economy scale.
- Suggested manual debt ceilings: D1 `1,200,000`, D2 `900,000`, D3 `600,000`.

| Division | Teams | Sponsor | Salaries | Prizes | Net before emergency | Suggested debt ceiling |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 8 | 4,800,000 | 6,164,000 | 1,280,000 | -84,000 | 1,200,000 |
| 2 | 8 | 3,200,000 | 3,484,000 | 560,000 | 276,000 | 900,000 |
| 3 | 8 | 2,080,000 | 1,661,600 | 200,000 | 618,400 | 600,000 |

This target is tight in Division 1, survivable in Division 2, and forgiving enough in Division 3 for active managers to recover without immediate emergency-loan spiral.

## Recommended Next Steps

Do not implement larger economy tuning yet. First:

1. Admin/service-visible season 6 repair verification.
2. Design and implement real CZ$ prize-money payouts:
   - separate result points from cash rewards;
   - choose payout scale by race class/result type;
   - verify finance transaction contracts and UI copy;
   - rerun this baseline with real prize income.
3. Then consider a tuning package such as:
   - centralize economy constants before changing values;
   - change salary rate from `0.15` to approximately `0.10`, with regression tests for salary recalculation and season-end preview;
   - make sponsor income division-aware or reset existing teams to a division-aware sponsor baseline:
   - D1: `600,000`
   - D2: `400,000`
   - D3: `260,000`
   - raise manual debt ceilings so managers can plan recovery before emergency loans:
   - D1: `1,200,000`
   - D2: `900,000`
   - D3: `600,000`
   - keep emergency loans expensive, but verify their ceiling/status semantics.

## Open Risks

- Read-only RLS still hides season 6 finance transactions, so this baseline cannot prove repaired salary/interest/emergency rows exist.
- `board_profiles` are not visible through read-only, so board-modified sponsor projections are neutral in this report.
- Current live team distribution is not representative of a full launched league: no human Division 1 teams and many empty human Division 3 teams.
