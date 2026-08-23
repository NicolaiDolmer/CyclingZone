# Point mod præmiepenge pr. division (S3-kalender + S2-facit)

Refs #4103 #3719. Dato 2026-08-23. READ-ONLY mod prod (Supabase MCP execute_sql, project ghwvkxzhsbbltzfnuhhz). Ingen writes.

## Metode

- **Formel (kilde: `backend/lib/economyConstants.js`, dokumenteret `docs/GAME_INVARIANTS.md` linje 26):** `race_results.prize_money = points_earned x PRIZE_PER_POINT`, hvor `PRIZE_PER_POINT = 75` og er UNIFORM på tværs af alle race_class/division. Sænket 1500 -> 75 (÷20) i #1816 (2026-06-23) for at gøre præmie til et supplement (mål: ~30-40% af sponsor), ikke hovedindtægt.
- **Konsekvens af formlen:** point/præmie-forholdet er matematisk identisk (1/75 = 0,01333) for alle fire divisioner, uanset kalender. Enhver forskel i "point vs. præmie pr. division" i praksis kommer IKKE fra selve omregningskursen, men fra hvor mange løb/etape-dage/hold hver division har, og hvilke race_class'er (WorldTour vs. ProSeries vs. Class1/2) der er lagt i kalenderen.
- **S3-kalender (projekteret, ikke kørt endnu):** `races` for `season_id = 00000000-0000-0000-0000-000000000003` (471 løb, division via `races.league_division_id -> league_divisions.tier`). Point pr. løb beregnet fra den SERVEREDE prod-tabel `race_points` (rank x race_class x result_type — inkluderer allerede flatten #1607 og OtherWorldTourC x1,5-balance #3328), summeret pr. løb: engangs-klassifikationer (Klassement/Klassiker + Bjergtroje + Pointtroje + Ungdomstroje + hold) + etapebundne point (Etapeplacering + Forertroje + de tre "Dag"-trøjer) x antal etaper.
- **S2-facit (faktisk, `season_id = 00000000-0000-0000-0000-000000000002`, status `active` — IKKE fuldt completed, se bemærkning nedenfor):** `race_results.points_earned` / `prize_money` for løb med `status = 'completed'`, samt faktisk udbetalt `finance_transactions.type = 'prize'`. Sponsor/løn: `finance_transactions.type IN ('sponsor','sponsor_race_day','sponsor_result_bonus','sponsor_signing_bonus','salary')`.
- **Hold-tal:** `teams.league_division_id -> league_divisions.tier`, aktuelle (live) puljestørrelser: D1=24, D2=48, D3=96, D4=192. **Bemærk:** dette er CURRENT division pr. hold, ikke division på udbetalingstidspunktet i S2 — hold kan være rykket op/ned siden. Brugt som tilnærmelse for "pr. hold"-nøgletal i begge sæsoner.
- **Sponsor-config til reference:** `SPONSOR_INCOME_BY_DIVISION = { 1: 600_000, 2: 400_000, 3: 340_000, 4: 315_000 }` (base pr. hold pr. sæson, `sponsorEngine.computeSponsorForSeason`) + variabel performance-pulje `VARIABLE_SPONSOR_POOL = 150_000` (0-150k oveni). Base alene brugt som denominator nedenfor (konservativt loft-estimat, den faktiske variable pulje kan hæve sponsor yderligere og dermed SÆNKE prize/sponsor-andelen).

## Tabel: S3-kalender (projekteret, 471 løb / 27 dage 25/8-20/9)

| Division | Løb | Etape-dage | Point total | Præmiepulje total | Præmie/etape-dag/hold | Point/etape-dag/hold | Point/præmie-ratio | Præmiepulje/hold (sæson) | vs. sponsor-base |
|---|---|---|---|---|---|---|---|---|---|
| D1 | 33 | 140 | 208.338 | 15.625.350 kr | 4.650 kr | 62,0 | 1/75 | 651.056 kr | **108,5%** af 600.000 |
| D2 | 86 | 224 | 194.872 | 14.615.400 kr | 1.359 kr | 18,1 | 1/75 | 304.488 kr | **76,1%** af 400.000 |
| D3 | 144 | 336 | 237.996 | 17.849.700 kr | 553 kr | 7,4 | 1/75 | 185.935 kr | **54,7%** af 340.000 |
| D4 | 208 | 448 | 86.368 | 6.477.600 kr | 75 kr | 1,0 | 1/75 | 33.738 kr | **10,7%** af 315.000 |

(471 løb total, 140+224+336+448 = 1.148 etape-dage total, stemmer med kalender-uddraget.)

## Tabel: S2-facit (sanity-check, kun completed løb i sæsonen)

| Division | Løb (completed) | Etape-dage | Point total | Præmie (race_results) | Præmie (faktisk udbetalt) | Præmie/etape-dag/hold | Point/etape-dag/hold | Sponsor total (alle typer) | Løn total | Præmie som % af sponsor |
|---|---|---|---|---|---|---|---|---|---|---|
| D1 | 23 | 132 | 178.367 | 13.377.525 kr | 13.377.525 kr | 4.223 kr | 56,3 | **0 kr — se anomali** | **0 kr — se anomali** | N/A |
| D2 | 50 | 204 | 129.654 | 9.724.050 kr | 9.724.050 kr | 993 kr | 13,2 | 24.287.592 kr | 2.694.771 kr | 40,0% |
| D3 | 178 | 318 | 228.608 | 17.145.600 kr | 17.007.000 kr | 562 kr | 7,5 | 39.208.871 kr | 505.784 kr | 43,4% |
| D4 | 184 | 440 | 110.648 | 8.298.600 kr | 7.413.000 kr | 98 kr | 1,3 | 13.832.145 kr | 40.890 kr | 53,6% |

Diff mellem "præmie (race_results)" og "præmie (faktisk udbetalt)" i D3/D4 (138.600 kr / 885.600 kr) er FORVENTET — det er fri/AI-ryttere uden hold (`team_id IS NULL`), som optjener præmie til `market_value` men aldrig udbetales (dokumenteret invariant, `prizePayoutEngine.js`). D1/D2 diff = 0 (ingen fri/AI-præmie i de completed løb der).

**Anomali (D1, sæson 2):** ingen `sponsor`/`sponsor_race_day`/`salary`-transaktioner fundet overhovedet for D1-hold i sæson 2 — 0 rækker, ikke bare 0 kr. Alle 24 nuværende D1-hold har prize-transaktioner men intet sponsor/løn-spor i denne sæson. Enten er D1-holdenes nuværende `league_division_id` ikke den de havde under S2 (opryk siden), eller der er et reelt hul i sponsor/løn-logningen for D1. Ikke undersøgt videre (uden for opgavens scope) — flag til separat issue hvis det bekræftes.

## Konklusion (5 linjer)

1. Point-til-præmie-omregningen er en fast konstant (75 kr/point) på tværs af ALLE divisioner og race_class'er — der er ingen division-specifik skævhed i selve kursen, kun i kalenderens sammensætning.
2. S3-kalenderen giver D1 en præmiepulje pr. hold der overstiger den fulde sponsor-base (108,5%) — stik imod #1816's designmål om at præmie skal være et 30-40%-supplement, ikke en hovedindtægt.
3. D4 er modsat massivt underforsynet: kun 10,7% af sponsor-basen, og 1,0 point/etape-dag/hold — præmie betyder reelt intet for et D4-holds økonomi.
4. S2-facit bekræfter mønsteret i D2-D4 (40,0% / 43,4% / 53,6% af sponsor, stigende ratio jo lavere division) — men D1 mangler helt sponsor/løn-data i denne sæson, så D1-facit-sammenligningen er ikke verificerbar lige nu.
5. Mønsteret D2 < D3 < D4 (stigende præmie/sponsor-andel nedad i pyramiden) i S2-facit, kombineret med S3-kalenderens D1 >> D4-spredning, peger på at kalender-tildelingen (antal WorldTour- vs. ProSeries/Class-løb pr. division) er den primære driver — ikke selve prisformlen.

## Forslag til justering (konkrete config-nøgler, ikke opfundne)

1. **D4-kalenderen mangler WorldTour/ProSeries-vægt.** D4 har kun Class1 (40 løb) + Class2 (168 løb) — ingen ProSeries eller højere. `Class2`-klassens `Klassement`-sum er kun 171 point (top 39) mod `ProSeries`' 1.467 (top 260) i `race_points`. At løfte en del af D4-kalenderen til `ProSeries` (samme mekanisme som allerede bruges i D2/D3) ville hæve D4's point/præmie markant uden at røre `PRIZE_PER_POINT`. Ingen ny konstant nødvendig — ren kalender-omfordeling.
2. **D1's præmieandel er over designmålet.** Overvej at sænke antal `TourFrance`/`GiroVuelta`/`Monuments`-løb i D1-kalenderen (i dag 1+2+5 = 8 af 33 løb, men de tegner sig for uforholdsmæssigt mange point pga. `Klassement`-toppen på 1.300/1.100/800). Alternativt: hvis D1's høje præmieandel er tilsigtet (D1 = "det rigtige cykelsport"-oplevelse), bør `SPONSOR_INCOME_BY_DIVISION[1]` justeres op eller player-facing copy i Hjælp opdateres til at afspejle at D1 reelt har en anden økonomi-balance end D2-D4.
3. **Verificér D1-sponsor/løn-hullet i sæson 2 før det bruges som facit-sammenligning.** Kør en opfølgende (read-only) query mod `finance_transactions` filtreret på hold der historisk har haft `division = 1` (fx via `finance_transactions.metadata` eller en `race_id`-tidsstempel-korrelation) i stedet for holdenes NUVÆRENDE `league_division_id`, før D1's præmie/sponsor-ratio konkluderes endeligt.
