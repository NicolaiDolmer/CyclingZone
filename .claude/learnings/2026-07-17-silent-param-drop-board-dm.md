# Tavst droppet parameter: bestyrelses-DM'er døde i 2 uger uden en eneste fejl

**Dato:** 2026-07-17 · **Issue:** [#2569](https://github.com/NicolaiDolmer/CyclingZone/issues/2569) · **Fundet af:** daglig Sentry/Railway-triage

## Hvad skete der

`notifyBoardUpdateDM` tog kun `teamId` i sin destrukturering. `cron.js` kaldte den med `userId`. JS kaster ikke ved ukendte objekt-nøgler, så `userId` forsvandt tavst, `teamId` blev `undefined`, og `resolveDmRecipient` havde intet at slå op på. Hver eneste bestyrelses-DM siden #2157 (4/7) endte i et `return` efter `console.info("[discord-dm:no-recipient]")`. Cirka 2 uger, 0 leverede DM'er, 0 alarmer.

## Hvorfor ingen fangede det

1. **Fejlen var designet som ikke-en-fejl.** `[discord-dm:no-recipient]` er `console.info` med kommentaren "#449: ikke en fejl (user kan have valgt opt-out eller mangler discord_id)". Den antagelse er rigtig for ÉN bruger og forkert for ALLE brugere. Selve koden forudså det ("log som info så vi kan se hvis ALLE DMs skippes pga. data-issue") — men ingen kiggede, fordi intet kaldte på opmærksomhed.
2. **Ingen Sentry-capture.** Et `console.info` i Railway-loggen er kun synligt hvis nogen læser loggen. Det gjorde denne triage-rutine.
3. **In-app-notifikationen virkede.** `notifyUserShared` fik det rigtige `userId` ad en anden vej, så symptomet var usynligt i UI'et. Kun Discord-spejlingen var død.
4. **Ingen test rørte wrapperen.** `discordNotifier.test.js` testede bevidst udenom modulet (`discordDmTarget.js` i stedet), fordi modulet laver en `createClient` ved import. CI sætter faktisk dummy-Supabase-env (`SUPABASE_URL: https://example.supabase.co`), så modulet ER importerbart i tests — det var bare aldrig blevet prøvet.

## Rod-årsag

Parameter-navne-mismatch mellem caller og callee i et destruktureret objekt-argument. Bug-klassen er tavs pr. konstruktion: ingen linter, ingen type-checker (repoet er plain JS), ingen runtime-fejl.

## Fix

`userId` tilføjet til signaturen og ført videre til `notifyDiscordDM`. `resolveDmRecipient` foretrækker i forvejen `userId` og falder tilbage til `teamId`-opslaget, så begge call-styles virker nu.

## Backwards-check (gennemført)

Alle øvrige DM-wrappers i `discordNotifier.js` blev tjekket mod deres call-sites: `notifyOutbid`, `notifyAuctionWon` (inkl. den opake `discordNotify(args)`-videresendelse fra `auctionFinalization.js`), `notifyTransferOffer`, `notifyTransferResponse`, `notifyWatchlistRiderAuction`. Alle matcher. Kun `notifyBoardUpdateDM` var ramt.

## Forward-guard

Regressionstest via DI (`notifyFn`) — repoets etablerede mønster (`notifyUserFn`, `deliverFn`, `sleepFn`, ...). Verificeret at testen **fejler** mod den gamle signatur, ikke kun passer mod den nye.

## Læring der rækker videre end denne bug

**"Ikke en fejl for én bruger" er ofte "totalt nedbrud for alle" i forklædning.** Når en skip-sti loggen begrunder med et per-bruger-scenarie (opt-out, manglende data), så er den sti også den sti et systemisk brud falder ned ad — og så er `info` det forkerte niveau. Kandidat til opfølgning: aggregér `no-recipient`-raten pr. cron-kørsel og capture til Sentry når den er 100% over flere kørsler i træk. Så havde denne bug meldt sig selv 4/7 i stedet for at blive fundet 17/7.
