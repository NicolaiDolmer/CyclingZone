# #1995 — Udskudt holdskifte i aktivt etapeløb (option c)

**Status:** kerne-logik landet (`stageRaceTransferDefer.js` + 11 tests, commit på `feat/1995-stage-race-deferred-transfer`). Wiring + UI mangler. Bygger på #1996 (PR #2151 — genbruger `pending_team_id`, som #1996 bevarede).

## Beslutninger (ejer)
- **Grænse (2026-07-03):** udskyd KUN når rytterens etapeløb er i gang (`stages_completed>0`, ikke completed = `isRaceLineupFrozen`). Endnu-ikke-startet løb → straks-skifte.
- **Model B:** handel + betaling + fuld notifikation (Discord/logActivity/gennemført-besked) sker ved **bekræftelsen** (confirm-laget har alle deps). KUN den fysiske rytter-flytning parkeres på `pending_team_id`. Race-flushen (i `raceRunner`, begrænsede deps) flytter kun `pending_team_id → team_id` + sender én ankomst-besked. Ingen offer-record-flush ved race-slut (offer er allerede `accepted`).

## Landet (kernen)
`backend/lib/stageRaceTransferDefer.js`:
- `getRidersInActiveStageRace(supabase, riderIds, {excludeRaceId})`
- `shouldDeferTeamChange(supabase, riderIds)` → bool (parkér hvis ≥1 involveret rytter er låst)
- `flushDeferredTransfersForRace(supabase, race, {notifyTeamOwner, now})` → overlap-guard + TOCTOU/idempotens + pagineret

## Resterende wiring (landes ATOMISK — ellers hængende parkeringer, jf. #1996)

### 1. Deferral-beslutning i confirm-laget
- `transferExecution.js` `confirmTransferOffer` (~857): erstat `const windowOpen = await getTransferWindowOpen(...)` + `deferRegistration: !windowOpen` med `deferRegistration: await shouldDeferTeamChange(supabase, [offer.rider_id])`.
- `confirmSwapOffer` (~929): `deferRegistration: await shouldDeferTeamChange(supabase, [swap.offered_rider_id, swap.requested_rider_id])` (parkér begge hvis én er låst).
- Fjern `getTransferWindowOpen`-importen hvis den bliver ubrugt.

### 2. Model B defer-grene (offer→accepted, ikke window_pending)
- `executeTransferOffer` defer-gren (`transferExecution.js:493-503`): fjern `window_pending`-returnen. Lad defer + accepted dele koden (offer=accepted, logActivity, #1836 kontrakt-advarsel, notifyDiscordHistory); variér KUN ejer-beskeden: defer → "…skifter til dit hold når hans igangværende etapeløb er kørt færdigt." `movedRider` sætter allerede `pending_team_id` i defer-stien (397-419), og `clearFutureRaceEntries` skippes allerede i defer (434-436) — behold begge. Return `action: "deferred_stage_race"`.
- `executeSwapOffer` defer-gren (`:759-768`): samme mønster for begge ryttere.

### 3. Auktion
- `auctionFinalization.js` (~443): erstat `const windowOpen = await getTransferWindowOpen(...)` med `const defer = (await getRidersInActiveStageRace(supabase, [auction.rider.id])).length > 0`. Rider-update-grenen (`:495-514`) bruger allerede `windowOpen ? team_id : pending_team_id` — byt til `defer ? pending_team_id : team_id`. Bemærk: `clearFutureRaceEntriesSafe` kaldes p.t. ALTID (`:518`) — flyt den til KUN ikke-defer (i defer bliver rytteren hos sælger til race-slut). Besked-variant ved defer.

### 4. Race-finaliserings-flush
- `raceRunner.js` `simulateStageByIndex` efter `status='completed'` (`:1268-1271`) OG `simulateRace` efter `:786`: kald `flushDeferredTransfersForRace(supabase, race, { notifyTeamOwner })`. Idempotent → sikker efter recovery-genkørsel (kør UDEN `finalizationPending`-guard).
- **Notify-dep:** `raceRunner` får ikke `notifyTeamOwner` i dag. Importér den delte helper (`notifyTeamOwnerShared` fra samme modul api.js bruger) direkte i flushen, ELLER tråd en `notifyTeamOwner`-callback gennem `simulateRace`/`simulateStageByIndex` → `adminSimulateRace` → cron. Foretræk direkte import for at undgå at røre 3 lag.

### 5. Tests
- Opdatér `transferExecution.test.js` + `auctionFinalization.test.js` (defer forventer nu `accepted`/`deferred_stage_race`, ikke `window_pending`).
- Wire-test: rytter i aktivt stage race → confirm parker (pending_team_id sat, team_id uændret, penge flyttet); race-finalisering flusher. Verificér acceptkriterie: "etape 1 krediterer sælger, fremtidige løb krediterer køber."

### 6. UI (kræver preview til ejer FØR merge)
- `pending`-badge (TeamCell.jsx / RidersPage) → tilføj "skifter efter løb"-tekst når `pending_team_id` skyldes et aktivt etapeløb.
- Vis show_widget-mockup ELLER preview-server til ejer før merge (memory: ejer skal kunne teste UI før live).

### 7. Ship
- Sim/verifikation mod ægte data (1.222 ryttere i 9 aktive etapeløb pr. 3/7) — bekræft parkering + flush end-to-end mod prod-kopi/preview før live.
- Patch note (player-facing: "sælger du en rytter midt i et etapeløb, skifter han først efter løbet").
- FEATURE_STATUS (Market-linjen nævner allerede at #1995 lander stage-race deferral).

## Risici
- `raceRunner` = live race-engine → PR-review + ejer-merge, aldrig auto-merge.
- Attribution-følsom → sim-verifikation obligatorisk før ship.
