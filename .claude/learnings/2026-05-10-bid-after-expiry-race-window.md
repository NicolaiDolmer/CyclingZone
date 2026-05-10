# 2026-05-10 · Race-vindue mellem expiry-tjek og bid-INSERT (#269)

## Symptom
Axel Zingle auktion (`4b754d83-20b4-4ca0-b98d-178072e43b77`) blev forlænget 5 gange — den 4. forlængelse skete på et bud placeret **308 ms EFTER** auktionens daværende `calculated_end`. Det udløste forlængelse #5 og holdt auktionen åbent i 11+ ekstra minutter. #257's leder-skift-regel virkede korrekt; bug'en sad ét lag dybere.

## Konkret data fra prod
| bid_time | amount | team | prev_calc_end_after_prev_ext | late_by |
|---|---|---|---|---|
| 2026-05-10 12:08:27.944+00 | 639,684 | Swatt | 2026-05-10 12:08:27.636+00 | **+00:00:00.308** |

## Root cause
POST /bid og PATCH /proxy gjorde fetch → validér → INSERT uden transaktion:

1. `SELECT auction` → læser `calculated_end`
2. `if (isAuctionExpired(...))` — tjekker `new Date() >= calculated_end` på **fetch-tidspunktet**
3. Validerings-roundtrips (assertSigningAllowed, balance-gates, getProxyOpeningBidAmount, getTeamMarketState) — **100-500 ms**
4. `bidTime = new Date()` — typisk for sent
5. `INSERT auction_bids` — gennemgår uden gen-tjek

Cron'en (`finalizeExpiredAuctions`) løber kun hver 60 sek, så vinduet hvor en sent landet bid kunne sneges igennem var stort.

## Løsning
**Option B fra investigation: BEFORE INSERT trigger** på `auction_bids` (migration `2026-05-10-reject-late-auction-bid-trigger.sql`):

```sql
IF NEW.bid_time >= v_calculated_end THEN
  RAISE EXCEPTION 'auction_expired_at_insert (bid_time=% calculated_end=%)',
    NEW.bid_time, v_calculated_end USING ERRCODE = 'P0001';
END IF;
```

App-laget detekterer P0001 + symbolic message via ny helper `isLateBidTriggerError` i `auctionEngine.js` og oversætter til 400 "Auktionen er udløbet" i alle 3 INSERT-sites: POST /bid, PATCH /proxy openingBid, og cascade-bids i `proxyBidding.js`.

## Hvorfor option B over A
Option A (server-side gen-tjek af `bidTime >= calculated_end` lige før INSERT) ville fange 90% af casen, men:
- Stadig race med sig selv (samme app-niveau race i mindre vindue)
- Ville ikke dække fremtidige callsites (admin-tools, seed-scripts, andre endpoints der inserter til auction_bids)

Trigger er race-tæt og automatisk dækkende.

## Lære
1. **Når du finder "fetch → validér → INSERT uden transaktion"-mønster i Supabase JS-kode, mistænk race-vindue.** Memory entry `feedback_db_trigger_for_race_windows.md` markerer mønsteret som signal til DB-trigger-fix.
2. **Gem konkrete prod-data ved bug-undersøgelse.** SQL-snippet med `LAG()` over triggered_extension-bids gjorde late_by="+00:00:00.308" synlig som smoking gun. Uden den var det bare "den 4. forlængelse virker forkert."
3. **Lignende mønstre findes andre steder** — transferExecution (transfer-window-close race), loanEngine (active loan-state race). Worth at audit som follow-up når en bruger rapporterer "denne handling skulle ikke være tilladt."
4. **#257 var ikke buggy.** Når en ny bug overlapper med en nyligt fixet feature, så undgå at vende tilbage til den fixede kode først. `applyLeaderShiftExtension` blev kaldt korrekt på alle 5 forlængelser; bug'en var at den 4. INSERT aldrig skulle være sket. Et lag dybere.

## Verifikationsteknik
SQL der rekonstruerer hvert ekstension-events forventede calculated_end (10 min fra previous extension's bid_time) og sammenligner med den faktiske bid_time på næste extension:

```sql
WITH triggered AS (
  SELECT bid_time, amount, team
  FROM auction_bids JOIN teams ON ...
  WHERE auction_id = ? AND triggered_extension
  ORDER BY bid_time
)
SELECT bid_time, amount, team,
  LAG(bid_time) OVER (ORDER BY bid_time) + INTERVAL '10 minutes' AS prev_calc_end,
  bid_time - (LAG(bid_time) OVER (ORDER BY bid_time) + INTERVAL '10 minutes') AS late_by
FROM triggered;
```

Genbrugbart til debugging af enhver "auction extended for længe"-rapport.

## Genbrug
Trigger-pattern + P0001-detection kan replikeres for andre boundary-håndhævelser:
- `transfer_offers` BEFORE INSERT: afvis hvis `transfer_window.status != 'open'` (p.t. app-tjek + race-vindue)
- `loan_agreements` BEFORE UPDATE: afvis cancel hvis `status='active'` (allerede app-tjekket i #156, men trigger ville være race-tæt fallback)
- `auction_proxy_bids` BEFORE INSERT: afvis hvis `team_id == auction.seller_team_id` (eksisterende app-tjek, kunne hærdes til DB-niveau)
