# En invariant-vagt alarmerede på systemets egen finaliserings-hale

**Dato:** 2026-08-23 (fund fra daglig Sentry/Railway-triage)
**Sentry:** CYCLINGZONE-4M · **Modul:** `backend/lib/ownershipInvariantWatch.js` (#2647)
**Spillerpåvirkning:** ingen. Ren alarm-støj.

## Symptom

Ét Sentry-issue, én forekomst, 0 brugere:
`Ownership-invariant-brud: 1 hold-ejet rytter på aktiv ungdomsauktion (#2647)`
— fyret 2026-08-22 kl. 14:00:26.979 UTC fra vagtens boot-run.

## Hvad der faktisk skete

Auktion `7ac6f845` (ungdom, sælgerløs) blev finaliseret i præcis det sekund:

| Tid (UTC) | Hændelse |
|---|---|
| 14:00:25.288 | `actualEnd` — finaliseringen starter |
| 14:00:26.045 | `riders.team_id` sat (vinderen får rytteren) |
| 14:00:26.305 | `rider_ownership_events` skrevet |
| 14:00:26.431 | debit −888 CZ$ skrevet |
| **14:00:26.979** | **vagten alarmerer — midt i halen** |

Data var korrekte hele vejen: præcis ét ejerskabsevent, præcis én debit, ingen
dobbeltbetaling. Verificeret mod prod 23/8: 0 brud.

## Rod-årsag

To ting der hver for sig er fine, men som tilsammen garanterer falske positiver:

1. **`auctionFinalization` skriver rytteren FØR den lukker auktionen.**
   `tryPlaceYouthWinnerOnSenior` sætter `riders.team_id`, og først efter
   `clearFutureRaceEntries` + `closeTransferListings` + ownership-event + debit
   + XP + Discord-DM til vinderen + DM til *alle* tabende budgivere kaldes
   `closeAuction`. Halen indeholder netværkskald og varer let sekunder.
2. **Vagten læser auktioner og ryttere i to separate, ikke-atomiske queries.**

I hele halen er "aktiv ungdomsauktion + hold-ejet rytter" **transient sand ved
design** — ved hver eneste gennemførte ungdomsauktion. Rammer vagtens to
læsninger på hver sin side af halen, alarmerer den.

Deploy-genstarten kl. 14:00:25 gjorde det sandsynligt, fordi vagten kører et
boot-run og auktioner finaliseres hvert 60. sekund.

## Fix

Alarmér aldrig på **første** observation af invariant A/B. Vent
`RECHECK_SETTLE_MS` (15 s) og genlæs **både** auktions-status og
rytter-ejerskab; kun rækker hvor begge ben stadig holder er ægte brud.

Et rigtigt brud er en persistent tilstand og overlever genlæsningen. En
finaliserings-hale gør ikke. Genlæsningen kører kun når der faktisk er et fund,
så den daglige 0-fund-tick er uændret gratis — der er en test præcis på det.

Finaliserings-rækkefølgen blev **ikke** rørt. Den ændring er langt mere
risikabel end støjen den fjerner, og dagen for et sæson-cutover er det forkerte
tidspunkt til at flytte rundt på pengeskrivninger.

## Læring

**En vagt der alarmerer på en lovlig, forbigående tilstand mister sin værdi.**
Tredje bid af samme klasse:

- `CYCLINGZONE-31` — for stram `STALE_BACKSTOP_HOURS` spammede på lovlige, langvarige tilstande.
- `CYCLINGZONE-48` — alder alene som kriterie alarmerede på et lovligt 55-timers etapeløb.
- `CYCLINGZONE-4M` (denne) — punktmåling alarmerede på en lovlig finaliserings-hale.

**Regel fremadrettet:** når en read-only vagt læser en tilstand der er
sammensat af to tabeller, som en anden kodesti opdaterer i to trin, så skal
vagten enten læse atomisk eller genverificere efter settle. Ellers måler den
ikke invarianten — den måler et race.

**Check ved næste vagt-review:** `riderDoubleBookingWatch.js` og
`balanceDriftWatch.js` læser også flere tabeller. Er de punktmålinger på noget
der skrives i to trin?
