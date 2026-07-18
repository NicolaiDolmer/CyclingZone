# Board-DM spejlede uden for in-app 24h-dedup → 30-min-re-forsøg (spam + falsk #2571-alarm)

**Dato:** 2026-07-18
**Issue:** [#2619](https://github.com/NicolaiDolmer/CyclingZone/issues/2619) · **PR:** [#2620](https://github.com/NicolaiDolmer/CyclingZone/pull/2620) · **Sentry:** CYCLINGZONE-35
**Fundet af:** daglig Sentry/Railway-triage-rutine

## Symptom
- Sentry CYCLINGZONE-35: "alle 1 forsøgte board_update-DM'er blev skippet (no-recipient) i 3 kørsler i træk".
- Railway-deploy-log: `[discord-dm:no-recipient] { teamId: null, userId: 'ffaf97b7…', type: 'board_update' }` **hver 30. minut** i 8+ timer, altid samme bruger.

## Rod-årsag
`notifyUserWithBoardDM` (cron.js) spejlede `board_update`/`board_critical` til en Discord-DM ved **hvert** cron-tick, uafhængigt af `notifyUser`s returværdi. In-app-notifikationen har 24h-dedup (`notifyUser` → `{ delivered:false, deduped:true }` i vinduet), men DM-kaldet lå uden for gaten:

```js
const result = await notifyUserShared({ supabase, ...args });
if (args.type === "board_update" || args.type === "board_critical") {
  notifyBoardUpdateDM({ ... }).catch(() => {});   // fyrede uanset result.delivered
}
```

Board-crons kører hvert 30. min, så DM'en re-forsøgtes hver halve time så længe et hold havde en pending board-plan.

## To konsekvenser
1. **Latent DM-spam** — en linket bruger med pending "5-year plan" ville få samme DM hver 30. min. Maskeret i dag udelukkende fordi den eneste due modtager var ulinket (`discord_id=null`).
2. **Falsk-positiv #2571-guard** — `discordDmRateGuard` tolker 100%-skip over 3 kørsler som systemisk nedbrud, men i en lille population (1 due modtager, ulinket) er 100%-skip uundgåeligt uden at være systemisk.

## Fix
Gate DM-spejlingen på `result.delivered === true` (nyoprettet, ikke dedup-ramt). Faktoreret til `lib/boardDmMirror.js` (injicerbart seam) + 6 regressionstests. Fejler "closed": kan kun reducere antal DM-sends.

## Læring
- **En "idempotent" cron er kun idempotent for de sidekanaler der respekterer dedup-gaten.** In-app-notifikationen var dedup'et; DM-spejlingen delte intention men ikke gate. Når du tilføjer en ny leverings-sidekanal til en dedup'et notifikation, skal sidekanalen gate på *samme* dedup-resultat — ikke bare på type.
- **En rate-guard kan ikke skelne "lille population, alle legitimt uopnåelige" fra "systemisk nedbrud".** #2571-guarden er korrekt i design (#2569 levede 14 dage netop fordi ingen læste loggen), men i en tynd Discord-linket population giver den falske positiver. Den rigtige fix var at fjerne re-forsøgs-strømmen ved kilden, ikke at sløve guarden.
- **Triage-værdi:** guarden gjorde præcis sit job — den gjorde en tavs, latent spam-adfærd synlig FØR en bruger blev ramt. Det er argumentet for aggregeret alarmering selv når enkelt-hændelsen er "normal".

## Relaterede
- #2569 (board-DM tavst droppet 14 dage — signatur-mismatch) · #2571 (aggregeret no-recipient-guard) · PR #2618 (guardens tælle-rækkefølge — komplementær, ikke overlappende) · #449 (single-DM no-recipient er normal).
