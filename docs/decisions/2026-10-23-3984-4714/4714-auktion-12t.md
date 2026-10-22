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

Ét spor, ingen flag: det er en regel, og den rulles tilbage ved at ændre én konstant.

1. `backend/lib/auctionEngine.js`: `getCustomAuctionEndIssue` får en valgfri `minHours` (standard er `CUSTOM_END_MIN_HOURS`). Ryttere uden hold sender `FREE_AGENT_MIN_DURATION_HOURS`. Svaret `end_too_soon` bærer `minHours`.
2. `backend/routes/api.js` (opret auktion, omkring valgt `ends_at`): vælg minimum efter `rider.team_id` er tom eller ej. Flash og egne ryttere uændret. `GET /auctions/window` får `min_hours_free_agent`, så skærmen ikke hardkoder tallet.
3. `frontend/src/lib/auctionEndTime.js` og `useAuctionEndTimeSelector.js` (+ test): minimum pr. rytter, og tidligste tilladte tidspunkt beregnes i markedets åbne vindue. Knappen i `TeamPage.jsx` og `RiderStatsPage.jsx` er låst, indtil tiden er gyldig.
4. Tekster EN + DA i `frontend/public/locales/{da,en}/errors.json` og auktionsteksterne (hjælpetekst "12 til 48 timer", fejl med tidligste tidspunkt).
5. Tests: `backend/lib/auctionEngine.test.js` (rytter uden hold under 12 timer afvises, over accepteres; egen rytter 1 time accepteres; flash uændret) og frontend-testen.
6. Docs: `docs/TRANSFER_MARKET_RULES.md` §2.3 og §14 punkt 1 opdateres i samme PR. Patch note EN + DA og en linje i `help.json` ved close-out.

Berørte filer: `auctionEngine.js` (+ test), `api.js`, `auctionEndTime.js`, `useAuctionEndTimeSelector.js` (+ test), `TeamPage.jsx`, `RiderStatsPage.jsx`, to `errors.json`, auktions-teksterne, `TRANSFER_MARKET_RULES.md`.

Ikke berørt: kørende auktioner, spillets egne 12-timers-flows, flash.

## Byg-plan B (samme dag)

Ingen logikændring. Hjælpeteksten på sluttids-vælgeren for ryttere uden hold siger at spillets egne auktioner kører mindst 12 timer, mens en spillervalgt kan være kortere (to `errors.json`/auktionstekster EN + DA). `TRANSFER_MARKET_RULES.md` §2.3 og §14 punkt 1 lukkes som "besluttet: behold 1 time". Patch note EN + DA, der retter den tidligere formulering.
