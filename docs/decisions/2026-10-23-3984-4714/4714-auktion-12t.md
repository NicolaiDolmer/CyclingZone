# Valgkort #4714: 12-timers minimum for fri agenter

Mockup: [`mockup-4714-auktion-12t.png`](mockup-4714-auktion-12t.png) (kilde: `mockup-4714-auktion-12t.html`).
Løfte: 8/8, gentaget 5/10 ("beslutning tages denne uge og indføres med det samme").

## Problemet i én sætning

Spillets egne auktioner på ryttere uden hold kører altid mindst 12 timer, men når en manager selv starter auktionen og vælger sluttiden, må den være helt nede på 1 time, så mange ryttere bliver solgt, før andre når at reagere.

## Hvad der allerede er aftalt (genåbnes ikke)

- Reglen gælder kun ryttere uden hold (frigivne, bankens, ungdomsmarkedet, akademi-graduater). Egne ryttere (1 til 48 timer) og Deadline Day-lynauktioner (fast 30 minutter) røres ikke.
- Du har selv sagt at kommunikationen har været uklar: spillerne tror at 12 timer allerede gælder dem (Discord 16/9). Det er bekræftet at en auktion på 1 time og 1 minut kan oprettes live.
- Afstemningen kører på forummet siden 4/10 med ti svarmuligheder (ingen minimum, 15 min, 1, 2, 4, 8, 12 og 24 timer, 2 og 3 dage).
- Fire spillere bakkede uopfordret op om et minimum på 12 til 24 timer (Discord 30/9). En af dem skriver selv at han bruger 1-timersvalget i dag.
- Fair play-vinklen (korte auktioner sent på dagen har lav eksponering) er skrevet op i #5320.

Stemmetallene fra forummet står ikke i repoet og er ikke talt i dette kort. Du har dem; læg dem på issuet, så kortet kan opdateres, hvis vinderen ikke er 12 timer.

## To muligheder

**A. Mindst 12 timer også når manageren vælger sluttiden, men kun for ryttere uden hold.** Vælger man kortere, får man en besked med tidligste tilladte tidspunkt, og knappen er låst, indtil tiden er gyldig. Hjælpeteksten siger "12 til 48 timer frem" for ryttere uden hold og uændret "1 til 48 timer" for egne ryttere.

**B. Behold 1 time.** Reglen ændres ikke. Vi retter kun teksten i spillet og i patch-noten, så ingen tror at 12 timer også gælder spillervalgte sluttider.

## Anbefaling: A

Det er det issuet og patch-noten lovede, det er det de spillere der har ytret sig vil have, og det fjerner det der i dag opleves som en fælde: man mister en rytter fra ønskelisten, før man når at se ham. B er kun rigtigt, hvis afstemningen faktisk lander på 1 time eller derunder.

Hvis afstemningen vinder med et andet tal end 12 (fx 8 eller 24 timer), er byggeriet det samme: tallet bor ét sted. Er vinderen 2 eller 3 dage, er det større, fordi det længste vi tillader at vælge i dag er 48 timer, og så skal det loft også hæves (og markeds-vinduets regler gennemgås).

## Byg-plan A (samme dag)

Ét spor, ingen flag: det er en regel, og den rulles tilbage ved at ændre én ny konstant.

**Samme 12 timer som spillets egne auktioner: aktive markedstimer, ikke vægur-timer.** Spillets egne free-agent-auktioner (`calculateAuctionEnd(now, cfg, { minHours: FREE_AGENT_MIN_DURATION_HOURS })`) tæller kun timer, mens markedet er åbent; natten tæller ikke. En spillervalgt sluttid måles i dag i vægur-timer (`getCustomAuctionEndIssue`). Hvis minimummet blot blev 12 vægur-timer, kunne en auktion oprettet om aftenen slutte næste morgen efter få åbne timer, altså kortere end spillets egne. Derfor er tidligste gyldige sluttid for en rytter uden hold `calculateAuctionEnd(now, cfg, { minHours })`, præcis som gulvet.

1. `backend/lib/auctionEngine.js`: ny konstant `CUSTOM_END_FREE_AGENT_MIN_ACTIVE_HOURS` (sat til `FREE_AGENT_MIN_DURATION_HOURS`) og en ren `earliestCustomEnd(now, cfg, { freeAgent })`, der for ryttere uden hold returnerer `calculateAuctionEnd(now, cfg, { minHours: CUSTOM_END_FREE_AGENT_MIN_ACTIVE_HOURS })` og ellers `now + CUSTOM_END_MIN_HOURS`. Grænsen **rundes op til næste hele minut** (sekunder og millisekunder = 0, +1 min hvis de ikke allerede var 0), fordi `datetime-local` kun gemmer `YYYY-MM-DDTHH:mm`. Ellers ville en grænse som 10:00:37 blive vist og sendt som 10:00 og afvist igen. **Loftet må aldrig ligge før gulvet:** for ryttere uden hold flyttes seneste tilladte sluttid ud, så der altid er et ikke-tomt interval af hele minutter efter gulvet. Det gælder også, når reserve-konfigurationen bruges. Den præcise regel og grænsetilfældet står privat i `balance-internals/2026-10-23-4714-auktion-loft.md`. Egne ryttere og flash beholder 48 timer. `getCustomAuctionEndIssue` får `{ freeAgent }` og afviser en sluttid før `earliestCustomEnd` med `end_too_soon` + `earliestEnd`. Vindueskravet er uændret. 48-timers-loftet er uændret, bortset fra undtagelsen for ryttere uden hold ovenfor. Rollback: sæt kun den nye konstant ned (eller fjern `freeAgent`-grenen); `FREE_AGENT_MIN_DURATION_HOURS` styrer også ungdomsmarkedet, akademi-graduering og standard-auktioner og må ikke røres.
2. `backend/routes/api.js` (opret auktion, omkring valgt `ends_at`): `freeAgent` = rytteren har intet hold. Flash og egne ryttere uændret. `GET /auctions/window` får `earliest_end_free_agent` og `latest_end_free_agent` (begge beregnet af serveren med samme regel som valideringen), så skærmen ikke selv regner vinduet ud.
3. `frontend/src/lib/auctionEndTime.js` og `useAuctionEndTimeSelector.js` (+ test): for ryttere uden hold kommer både tidligste og seneste tilladte tidspunkt fra serveren og erstatter `max_hours: 48` i vælgerens validering. Alt uden for intervallet gråtones. Knappen i `TeamPage.jsx` og `RiderStatsPage.jsx` er låst, indtil tiden er gyldig. **Grænsen flytter sig, mens dialogen står åben** (de 12 timer måles fra oprettelsen): skærmen henter `earliest_end_free_agent` igen lige før "Start auktion" sendes, og serveren afgør altid med sit eget `now`. Afviser serveren med `end_too_soon`, svarer den med det friske `earliestEnd`, og skærmen viser det i fejlbeskeden og flytter valget dertil i stedet for en generisk fejl.
4. Tekster EN + DA i `frontend/public/locales/{da,en}/errors.json` og auktionsteksterne (hjælpetekst "12 til 48 timer", fejl med tidligste tidspunkt).
5. Tests: `backend/lib/auctionEngine.test.js` med injiceret ur: rytter uden hold med sluttid før `earliestCustomEnd` afvises, på/efter accepteres; oprettet om aftenen tæller natten ikke med (aktive timer); reserve-konfigurationens grænsetilfælde (privat, se ovenfor) giver et ikke-tomt interval; et `now` med sekunder (fx 09:58:37) giver en grænse rundet op til helt minut, og præcis den værdi accepteres efter `datetime-local`-runden; forsinket oprettelse (dialogen åbnet 30 min før tryk) afvises med et nyt `earliestEnd`, der ligger mindst lige så sent som det viste; egen rytter 1 time accepteres; flash uændret; `FREE_AGENT_MIN_DURATION_HOURS`-flows uændrede. Frontend-testen dækker gråtoning og låst knap. Den dækker også reserve-tilfældet, hvor serverens `latest_end_free_agent` ligger efter 48 t: en værdi mellem gulv og serverloft accepteres, og knappen låses op.
6. Verifikation: TIER TARGETED (backend `node --test` på auktions-filerne, frontend lint + `node --test` + build) + Playwright-snapshot af sluttidsvælgeren i alle tre projekter. **Ejeren ser på preview (Android):** opret en auktion på en rytter uden hold om aftenen og se at tidligste tid ligger efter 12 åbne markedstimer; en egen rytter kan stadig vælge 1 time.
7. Docs: `docs/TRANSFER_MARKET_RULES.md` §2.3 og §14 punkt 1 opdateres i samme PR. Patch note EN + DA og en linje i `help.json` ved close-out.

Berørte filer: `auctionEngine.js` (+ test), `api.js`, `auctionEndTime.js`, `useAuctionEndTimeSelector.js` (+ test), `TeamPage.jsx`, `RiderStatsPage.jsx`, to `errors.json`, auktions-teksterne, `TRANSFER_MARKET_RULES.md`.

Ikke berørt: kørende auktioner, spillets egne 12-timers-flows, flash.

## Byg-plan B (samme dag)

Ingen logikændring. Hjælpeteksten på sluttids-vælgeren for ryttere uden hold siger at spillets egne auktioner kører mindst 12 timer, mens en spillervalgt kan være kortere (to `errors.json`/auktionstekster EN + DA). `TRANSFER_MARKET_RULES.md` §2.3 og §14 punkt 1 lukkes som "besluttet: behold 1 time". Patch note EN + DA, der retter den tidligere formulering.
