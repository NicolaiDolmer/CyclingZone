# Postmortem: Discord-webhook for autobud sender ingen besked (#155)

**Date:** 2026-05-08
**Shipped as:** v2.67 ([0162817](https://github.com/NicolaiDolmer/CyclingZone/commit/0162817))
**Issue:** [#155](https://github.com/NicolaiDolmer/CyclingZone/issues/155)
**Reporter:** bobby2106 (Discord, 2026-05-07)
**PR:** [#180](https://github.com/NicolaiDolmer/CyclingZone/pull/180)

## Symptom

"Webhooken virker ikke ordentligt sammen med autobud. Der kommer ikke nogen beskeder i kanalen ved brug af autobud." Manager fik in-app-notifikation når et auto-bud overbød dem, men ingen Discord DM — i modsætning til manuelle bud hvor DM altid sendes.

## Rod-årsag

Manuel bid-flow i [`api.js:866-892`](backend/routes/api.js) sendte både `notifyTeamOwner` (in-app via `notifications`-tabellen) **og** `notifyOutbid` (Discord DM via `notifyDiscordDM`). Proxy-bid-flow i [`proxyBidding.js:103-122`](backend/lib/proxyBidding.js) (pre-fix) kaldte kun `notifyTeamOwner`. DM-stien var aldrig blevet skrevet for resolver-loopet.

Yderligere: sælger-notifikation (`bid_received` når rider.team_id === seller_team_id) var også kun i manuel-flow, ikke proxy-flow.

## Hvorfor opdagede vi det først nu

- v2.64 (#10) shipped proxy-bidding 2026-05-07 morgen.
- bobby2106 rapporterede via Discord-feedback samme aften (8-12 timer efter ship).
- Discord-GitHub bridge batch 4 filed issue 2026-05-07 aften (#155).
- Code-audit afdækkede mismatch mellem manuel- og proxy-flow på <15 min.

## Fix

DI-pattern: ny `notifyOutbidDM`-parameter til `resolveProxyBids`, samme injection-mønster som eksisterende `notifyTeamOwner`. Begge call-sites i `api.js` (`POST /bid` + `PATCH /proxy`) sender `notifyOutbidDM: notifyOutbid`.

`notifyOutbid` udvidet med `isAuto` + `exhausted` flags så DM-tekst varierer:
- Normal outbid via proxy: "Du er blevet overbudt på X af et auto-bud!"
- Egen proxy nået max: "Din auto-by på X nåede sit max-loft og er overbudt."

Sælger får nu også `bid_received` ved auto-bud (mirror'er manuel flow's sælger-notif).

## Tests

**Ingen tests tilføjet i denne PR** — proxyBidding.js havde ingen test-fil indtil v2.68 (#171, samme aften). Test-coverage for v2.67-arbejdet (`notifyOutbidDM`-injection, sælger-notif, `bidderName`-fetch) er logged som follow-up i [#184](https://github.com/NicolaiDolmer/CyclingZone/issues/184).

317/317 eksisterende backend-tests + frontend build (6.11s) grønne. Vercel + Railway deploy verificeret via `verify-deploy.ps1`.

## Lærepenge

1. **Mirror-of-manual-flow audit ved nye programmatiske flows.** Når proxy-bidding shipped som programmatisk version af manuel bid-flow, skulle alle notifikations-stier (in-app + DM + sælger-notif) replikeres systematisk. Pre-ship checklist for "ny path der spejler eksisterende user flow": list alle side-effekter i original og verificer 1:1.

2. **Test fra dag 1 (delt med #171).** v2.64 shipped uden test-fil; bug-shape var ikke fanget af eksisterende test-suite (intet rørte resolver-loopet). Hvis pre-commit-hook eller CI-tjek havde krævet `<navn>.test.js` for hver ny `lib/`-fil, ville notifikations-mismatchen være blevet fanget.

3. **Discord-feedback-loopet er hurtig signal.** bobby2106's rapport kom inden for 8-12 timer fra v2.64-ship — hurtigere end nogen automatisk overvågning ville have fanget dette. Værd at investere i Discord-bridge-pipelinens hastighed (batch-cadence < 24h).

4. **DI-pattern over direkte import.** `notifyTeamOwner` blev injiceret som parameter i `resolveProxyBids` fra start (v2.64). At følge samme pattern for `notifyOutbidDM` bevarede testbarhed (proxyBidding.js har ingen hård dep på `discordNotifier.js`, så test-mocks behøver ikke håndtere `SUPABASE_URL`-env-krav i Module-load-tid).

## Forebyggelse

- [ ] [#184](https://github.com/NicolaiDolmer/CyclingZone/issues/184) — luk test-coverage-hullet for v2.67-arbejde
- [ ] Pre-ship checklist for "programmatisk flow der spejler manuel flow": audit alle side-effekter (notifikationer, audit-log, XP, achievements, finance-rows) og krydsmarker.
- [ ] CLAUDE.md / hooks-tjek: krav om `<lib-fil>.test.js` for ny `backend/lib/*.js` (delt forebyggelse med #171).
