# En frontend byggede færdigt for en notifikation backenden aldrig sendte

**Dato:** 2026-07-23 · **Issue:** [#2745](https://github.com/NicolaiDolmer/CyclingZone/issues/2745) · **PR:** (se denne PR)

## Hvad var galt

`select count(*) from notifications where type='season_ended'` = **0 rækker,
nogensinde** i prod — verificeret 23/7 mens sæson 1 nærmer sig sin afslutning
(27/7). Alligevel var typen fuldt bygget i frontend: eget ikon, farve, deep-link
til `/seasons` i `NotificationsPage.jsx`, og oversatte labels i både
`notifications.json` og (delvist) `backendMessages.json`. En spiller uden
division-skifte og uden Discord fik intet signal om at sæsonen sluttede — den
ene in-app-hook der var *designet* til at pege alle spillere mod sæson-
oversigten var død fra dag ét.

## Rodårsag: modstykket blev bygget i den forkerte fil

`backend/lib/seasonTransition.js` har en veldokumenteret
`emitSeasonStartedNotifications` (#1357, Phase 7b) der kører inde i
`transitionToNextSeason`. Den fungerer fint — 17 `season_started`-rækker i
prod beviser det. Men **season-slut sker ikke i `seasonTransition.js`**. Den
sker i `routes/api.js`'s `POST /admin/seasons/:id/end` — et helt separat,
tidligere endpoint der sætter `seasons.status='completed'`, kalder
`processSeasonEnd`, og fyrer `notifySeasonEvent({ type: "season_ended", ... })`
(Discord-only) — men aldrig noget mod `notifications`-tabellen.

Da #1357 byggede season_started-notifikationen, var den naturlige placering
`seasonTransition.js` (fordi season-*start* sker dér). Ingen fulgte tråden
tilbage til hvor season-*slut* faktisk sker for at bygge modstykket samme sted
— fordi de to livscyklus-events, selvom de lyder som et par, bor i to
forskellige filer skrevet på to forskellige tidspunkter. Frontend-arbejdet
(ikon, i18n, deep-link) blev tilsyneladende lavet ud fra en antagelse om at
backend-siden "nok fandtes et sted", uden en kontrakt-test der beviste det.

## Fix

- Ny `emitSeasonEndedNotifications` i `backend/lib/seasonTransition.js` —
  bevidst navngivet og placeret som direkte modstykke til
  `emitSeasonStartedNotifications` (samme kontrakt: `humanTeams`-diskriminator
  `is_ai=false`/`is_frozen=false`, `notify`-injektion til test, dedup via
  `related_id = endedSeason.id`).
- Kaldes fra `POST /admin/seasons/:id/end` i `routes/api.js` — EFTER
  `seasons.status='completed'` er sat, try/catch-isoleret (en notifikations-
  fejl må aldrig vælte selve sæson-afslutningen).
- `notif.seasonEnded.title`/`.message` tilføjet til `backendMessages.json`
  (en+da) — frontend-rendering krævede ingen ændring, den fandtes allerede.
- Regressionstest: `backend/lib/seasonEndedNotifications.test.js` (emit-logik,
  mirror af `seasonStartedNotifications.test.js`) + en source-lock-test i
  `seasonTransitionRoute.test.js` der binder importen OG kalde-rækkefølgen
  (efter `status: "completed"`, inde i en try/catch) til api.js's kildetekst.

## Forhindret-fremover

En kilde-lock-test alene havde ikke fanget dette — testen ville bare have
bekræftet at `emitSeasonStartedNotifications` gjorde sit arbejde korrekt. Det
der manglede var en test der beviste **kontrakten mellem de to livscyklus-
halvdele**: "hvis der findes en `season_started`-emit, findes der en
`season_ended`-emit et sted der rent faktisk kaldes fra season-end-routen."
Den slags par-kontrakter er lette at overse fordi ingen enkelt fil "ejer" hele
livscyklussen.

## Læring

**Et par af events (start/slut, op/ned, åbn/luk) er ikke automatisk symmetrisk
bare fordi det ene er velbygget.** Når du bygger den ene halvdel af et par,
grep efter modstykket FØR du antager det findes — og hvis det ikke findes,
byg det samme sted i koden hvor det modsvarende event faktisk udløses, ikke
hvor det ville være pænest at have det. Her var det oplagte sted
(`seasonTransition.js`, ved siden af `emitSeasonStartedNotifications`)
**forkert**, fordi season-slut aldrig kørte gennem den fil.

**Konkret handling der havde fanget dette tidligere:** `select count(*) from
notifications where type=X group by type` for enhver notifikationstype
frontend har fuld rendering for, kørt periodisk mod prod (eller som en engangs-
audit før store livscyklus-events som sæsonskifte). En type med rendering men
0 rækker er et gratis, mekanisk signal — det kræver ingen domænekendskab at
opdage, kun at nogen stiller spørgsmålet.
