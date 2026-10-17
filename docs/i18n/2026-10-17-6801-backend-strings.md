# Backend-spillerstrenge: opgørelse og første batch (#6801)

> Refs [#6801](https://github.com/NicolaiDolmer/CyclingZone/issues/6801). Kontrakten står i [README.md](README.md#backend-tekst-til-spillere). Status 17/10-2026.

## Hvad der allerede fandtes

- `backend/lib/i18nServer.js`: `translate()` + ICU-delmængde. Strengene kommer fra `backendMessages`-namespacet, bundlet til `backend/lib/locales/backendMessages.generated.json` (der findes ingen `backend/locales/`-mappe; `frontend/public/locales/{en,da}/backendMessages.json` er kilden).
- `buildKeyedNotification()` i `notificationService.js`: fallback-tekst udledt af nøglen, koder i `metadata`.
- Gate `scripts/i18n-check-backend-player-strings.mjs`, men kun *dansk med æ/ø/å* i fem faste filer. Den så hverken dansk uden æ/ø/å ("Auktion annulleret"), engelsk hårdkodet til alle, eller kald uden for de fem filer. Den kørte kun i `npm run check:i18n`/preflight, ikke i et CI-job.

## Opgørelse pr. overflade

| Overflade | Tilstand | Handling |
|---|---|---|
| In-app-notifikationer, kald med `titleCode`/`messageCode` | 71 kald er nøglede. 4 bærer stadig en dansk fallback-streng ved siden af koden (3 i `proxyBidding.js`, 1 i `cron.js`), så dedup-nøgle og e-mail-digest er på dansk for engelske managers | Opfølgning |
| In-app-notifikationer **uden** nøgle | 12 kald i 6 filer: 11 på dansk, 1 på engelsk, alle sendt til alle uanset `users.language` | **Flyttet i denne PR (første batch)** |
| In-app-notifikationer bygget i variabler (fx midtsæson-bestyrelsesbesked) | Titel/besked samles i en hjælpefunktion og sendes som variabler; gaten ser dem ikke | Opfølgning |
| Builder-funktioner i `transferNotifications.js` m.fl. | EN-fallback + koder, i orden | Ingen |
| Push (`pushService.js`) | Renderer via `translate()` (`push.*`-nøgler) | Ingen |
| Discord-DM | Nøgler via `discordDmCopy.js`, rendret i modtagerens sprog | Ingen |
| Discord kanalposter (`discordNotifier.js`) | Hårdkodet EN (offentlig kanal, ét sprog) | Opfølgning, kræver sprogbeslutning |
| E-mailskabeloner (`emailTemplates.js`) | To sprog, men som `COPY`-objekter i selve koden, uden for locale-pipelinen (ingen nøgle-paritet, ingen delta-oversætter). Seks builders | Opfølgning |
| API-fejl (`error: "..."` i `routes/api.js`) | Menneske-tekst på dansk følger med; `errorCode` er kontrakten (gate `i18n-check-error-codes`), og dansk i fejl-/besked-kontekst er baselinet i `i18n-leaks-baseline.json` (18 backend-filer) | Ingen i denne PR |
| Supabase auth-mails og Resend-skabeloner i prod | Ligger uden for repoet | Røres ikke, jf. scope |

## Gate (baseline-ratchet)

`i18n-check-backend-player-strings.mjs` har nu to dele:

1. Som før: ingen dansk prosa i de fem spillervendte filer.
2. Ny: scanner hele `backend/lib`, `backend/routes` og `backend/cron.js` efter kald til en notifikations-afsender (`notifyUser`, `notifyTeamOwner`, `notify` m.fl., liste i `NOTIFY_CALLEES`) hvis argumenter har en hårdkodet prosa-streng og ingen `titleCode`/`messageCode`. Kendte kald står pr. fil i `scripts/i18n-check-backend-player-strings-baseline.json`. Nye kald fejler; færre end baselinen rapporteres som stale (`--update-baseline` strammer). Baselinen er tom efter denne PR, så hvert nyt hårdkodet kald fejler.

CI: nyt job `backend-player-strings` i `.github/workflows/i18n-check.yml` (test, gate, `build-backend-locales --check`). Jobbet er ikke i branch protection endnu; det er en ejer-handling (navn: `backend-player-strings`).

## Første batch (notifikationer, 12 kald)

Alle 12 gik fra hårdkodet tekst til nøgler i `backendMessages` med en+da. DA-teksten er den samme som før (den var hårdkodet dansk til alle); EN er ny og viser nu engelsk for engelske managers. To afvigelser:

- Tankestreger (`—`) i to danske tekster er erstattet af punktum, fordi em-dash-gaten forbyder dem i locale-filer.
- Trup-håndhævelsen (`squad_enforced`) var kun engelsk før; den danske tekst er ny.

| Kilde | Nøgler |
|---|---|
| `auctionCancellation.js` (admin annullerer auktion, køber og sælger) | `notif.auction.cancelledTitle` (fandtes), `notif.auction.adminCancelledBidder`, `notif.auction.adminCancelledSeller` |
| `routes/api.js` (autobud: bud til sælger, overbudt-besked) | Genbruger `notif.transfer.bidReceived.title`, `notif.transfer.auctionOutbid.title`, `notif.autoBidPlaced.message` |
| `proxyBidding.js` (autobud stoppet x2, matchet, overbudt) | `notif.autoBidStopped.*`, `notif.autoBidMatched.message`, `notif.autoBidOutbid.message` |
| `transferExecution.js` (handel/bytte afventer bekræftelse) | `notif.transfer.confirmPending.*`, `notif.transfer.swapConfirmPending.*` |
| `stageRaceTransferDefer.js` + `deferredTransferHealSweep.js` (rytter ankommet) | `notif.riderArrived.*`. `flushParkedRider` tager nu `arrival: { reason, raceName }` i stedet for en dansk sætning |
| `squadEnforcement.js` (trup håndhævet) | `notif.squadEnforced.*` (ICU-plurals pr. linje) |

Dækning: `backend/lib/notificationKeysBatch1.test.js` låser DA-teksten og EN-teksten for hver nøgle. ICU-strengene er desuden kørt gennem frontendens egen parser (`intl-messageformat`) for begge sprog.

## Opfølgning (ikke i denne PR)

1. De 4 nøglede kald med dansk fallback ved siden af (`proxyBidding.js`, `cron.js`): skift til `buildKeyedNotification`.
2. Variabel-byggede notifikationer (midtsæson-bestyrelsesbesked m.fl.) og en gate-udvidelse, der kan se dem.
3. E-mail-`COPY`-objekterne ind i locale-pipelinen (`backendMessages` eller et eget `email`-namespace) med nøgle-paritet og delta-oversætter.
4. Discord kanalposter: afgør sprog (EN alene eller tosproget), derefter nøgler.
