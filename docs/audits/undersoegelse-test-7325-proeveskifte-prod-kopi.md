# Undersøgelse #7325: prøveskifte S5 til S6 på lokal prod-kopi (kørsel 1, 26/11)

Spor: undersøgelse (kind: investigate, #5220). Kode: main på `079e9e9dd`. Ingen kode ændret, intet skrevet mod prod.
Tal om spillere, hold og saldi står kun i den private handoff, ikke her.

## Hvad jeg gjorde

1. Lagde dumpen ind i en ny lokal PG17-klynge (127.0.0.1, egen port, scratch-mappe med 7325 i navnet).
   Supabase-roller og et tomt `auth`-skema blev stubbet. Indlæsning tog cirka 6,5 min (data 5,4 min, indeks 36 s).
   Kun fremmednøgler til `auth.users` fejlede (33 stk.). Det er forventet, for `auth` er ikke med i dumpen.
2. Den syntetiske psql-transport fra PR #8692 starter en ny proces for hver forespørgsel og kan ikke de fleste
   indlejrede select'er. Den er for langsom og for snæver til hele skemaet. I stedet skrev jeg en lille
   PostgREST-kompatibel klient oven på `pg` (kun i scratch). Den slår fremmednøgler op i kataloget, kan
   indlejringer, `or()`, upsert og rpc, og skriver med `jsonb_populate_recordset` ligesom PostgREST.
3. Al netværkstrafik blev blokeret undtagen den lokale port. Det gælder fetch, http/https, dns og sockets.
   Der var 0 forsøg på at nå prod, Resend eller Discord.
4. Uret i Node blev sat til lørdag 28/11 kl. 19:30 dansk tid. Databasens egen `now()` fulgte stadig det rigtige ur (26/11).
5. Jeg kørte `transitionToNextSeason` først som dry-run og derefter for alvor. Bagefter blev databasen droppet og klyngen stoppet.

## Resultater

| Trin | Resultat |
|---|---|
| Dry-run (plan + carry-over-preview) | OK på 0,2 s. Planen viste S5 til S6, og carry-over-tallene så rimelige ud |
| Ægte kørsel med uret kl. 20:00 | Blokeret af træningsgaten, fordi 28/11 ikke er afregnet. Det er korrekt, for kopien er fra 26/11 |
| Ægte kørsel kl. 19:30 (udskudt afregning, #6924) | Startede. S5 blev markeret færdig, S6 aktiv, rangering rullet over, sponsorer behandlet. Stoppede så på en fejl i min klient ved `sponsor_contracts.update` |
| Genoptag uden at angive sæson | Skiftet tog S6 som kilde og ville skifte S6 til S7. Gaten stoppede det ("ingen gyldig planlagt etape") |
| Genoptag med S5 angivet | Kørte i 4 min 48 s og cirka 28.500 forespørgsler. Stoppede ved oprykning af ungdomshold (`promote_season_squads_7323`), igen på grund af min klient: et JS-array blev sendt som array-literal til et `jsonb`-argument |

Målt i genoptagelsen (tid fra start):
- 0 til 15 s: sponsorkontrakter, pengeposter, lån, bestyrelser.
- 15 til 263 s: cirka 4 min med kun læsninger, før rytterudvikling begynder. Det er det langsomste sted.
- 263 til 286 s: rytterudvikling, cirka 14.000 rpc-kald, et pr. rytter.
- 288 s: oprykning junior til U23 til senior. Her stoppede kørslen.

Økonomi: ved genoptagelsen ramte alle gentagne pengeposter den unikke idempotens-nøgle (`uniq_finance_idempotency_key`).
Der blev ikke lavet dobbeltposter. Før skiftet var der ingen dubletter og ingen hold, hvor saldoen ikke passede med den seneste post.

Ikke målt i denne kørsel, fordi den stoppede før: oprykning (#7323), trupgrænser 30/30/30 maks 60 (#8034),
nulstilling af skader (#5865), division op/ned, kontraktloft efter skiftet (#7138) og S6-kalender.
Tilstanden før skiftet: et menneskehold havde allerede over 30 i én trup. Ingen hold var over 60 i alt.

## Fund

| # | Fund | Alvor |
|---|---|---|
| 1 | Genoptag efter et halvt skifte uden at angive sæson vælger den nye aktive sæson (S6) som kilde. Gaten stopper det i dag, men det bliver kun opdaget ved et uheld. Genoptag skal altid angive S5 | Skal rettes før lørdag (runbook-linje, eller lad `resolveTransitionSourceSeason` foretrække en sæson med halvt skifte) |
| 2 | Cirka 4 min med kun læsninger før rytterudvikling, og cirka 14.000 enkelte rpc-kald. Lokalt uden netværk tog det i alt cirka 5 min. På prod gennem PostgREST kan det tage meget længere | Skal rettes før lørdag: mål det på prod-lignende latens, eller kør skiftet som et job uden en timeout på requesten |
| 3 | Uden en gyldig afregning skal skiftet køres før kl. 20 (udskudt afregning), ellers blokerer gaten. Det er korrekt adfærd, men tidspunktet skal planlægges | Kan vente (planlægning) |
| 4 | Fra 20:00 på dagen kræver gaten afregnet træning for alle hold. Kører aftenjobbet ikke, stopper skiftet | Kan vente (planlægning) |
| 5 | Den syntetiske transport i PR #8692 kan ikke køre skiftet på det rigtige skema. Klienten over `pg` virker langt hen ad vejen, men mangler `jsonb`-array-argumenter til rpc | Skal rettes før fredagens kørsel 2 |
| 6 | Den lokale klynges datamappe (cirka 7 GB WAL-rester) kunne ikke slettes. Hook #7837 blokerer rekursiv sletning under worktrees. Databasen er droppet og klyngen stoppet | Skal ryddes af hovedsessionen eller ejeren |

## Fix-plan

1. Klienten (scratch, eller som `scripts/` i PR #8692): send arrays og objekter som JSON til `jsonb`-parametre.
   Slå argumenttyper op i `pg_proc.proargtypes`. Kør derefter hele skiftet igen fra en frisk restore. Risiko: lav, kun lokalt.
2. Mål og vurdér de 4 min med kun læsninger og de cirka 14.000 rpc-kald, før lørdag. Det bør være én samlet rpc eller færre opslag.
   Risiko: middel, rører motoren bag skiftet og skal derfor gennem Fable-dommeren.
3. Runbook: genoptag altid med eksplicit `fromSeasonId` for den gamle sæson. Alternativt kan
   `resolveTransitionSourceSeason` foretrække en `completed` sæson, hvis den nye aktive sæson mangler slut-markøren i admin_log.
   Risiko: lav.
4. Kørsel 2 fredag: brug samme opskrift (6,5 min restore). Mål derefter #7323, #8034, #5865, divisioner, #7138 og S6-kalenderen
   med before/after-SQL. Tallene kommer i den private handoff.

Dom: bekraeftet + fix-plan
