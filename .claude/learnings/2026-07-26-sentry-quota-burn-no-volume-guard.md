# 2026-07-26 — Sentry-kvote brændt af én issue: ingen SDK-niveau volumen-guard

## Hvad skete der?

Driftsaudit 25/7 (#2900) fandt at `CYCLINGZONE-31` (en per-hold-loop i
`runAiTeamTrimHealSweepCron`) sendte 11.992 events på ét døgn — 97,9 % af
90-dages Sentry-kvoten (verificeret 26/7 via `search_events`: 90d total
12.251, CYCLINGZONE-31 alene 11.992). Sandsynlig udløser af #2892: 26 af 27
cron-monitorer blev disabled, formentlig fordi Sentry stoppede med at tage
imod data da kvoten ramte loftet — og dermed stoppede ALARMERINGEN med at
virke lige når den var mest nødvendig.

## Root cause

`aiTeamTrimHealSweep` capturede ÉN `Error` PR HOLD PR TICK uden fast
fingerprint (65 hold × 5-min-kadence). Sentry grupperede ikke automatisk på
tværs af de varierende hold-id'er i beskeden, så hvert hold blev sin egen
strøm af events. Den specifikke sweep var allerede fixet i #2434/#2435
(løbs-bevidst stale-detektion + aggregeret capture med fast fingerprint,
`backend/cron.js:687-701`) — 7-dages-volumen er nu 29 events totalt. Men der
fandtes intet der forhindrede at MØNSTRET (loop → per-item capture uden
fingerprint) dukkede op et andet sted i koden igen.

Desuden: `find_alert_rules kind=metric` returnerede 0 — der findes ingen
alarm på event-volumen overhovedet, kun issue-regel 559456 (nye
high-priority issues). Ingen ville have opdaget kvote-brændingen FØR den
allerede havde slukket alarmeringen.

## Fix (PR fix/2900-sentry-volume-guard)

`backend/lib/sentry.js`: SDK-niveau volumen-guard i `beforeSend`
(`createVolumeLimiter` + `getEventGroupKey` + `normalizeMessageForGrouping`).
Per-gruppe token-vindue (default 20 events/10 min pr. gruppe); tælleren
starter ved 0 pr. vindue, så FØRSTE forekomst af enhver ny fejl altid
slipper igennem — kun gentagelser ud over loftet droppes. Grupperer på fast
fingerprint hvis sat, ellers exception-type + besked med tal/UUID erstattet
af pladsholdere (fanger "hold `<id>` fejlede"-mønstret uden at call-site'et
behøver huske en fingerprint).

## Forhindret-fremover

- SDK-guarden er et backstop der virker for ALLE fremtidige call-sites, ikke
  kun det ene der allerede blev fixet — næste udvikler der glemmer en
  fingerprint i en loop kan stadig ikke brænde kvoten.
- Metric-alert på event-volumen + Spike Protection kræver Sentry UI-klik
  (ingen create-alert-rule-tool tilgængelig via MCP) — beskrevet med præcis
  sti i PR #2900 til ejeren.

## Læring

- **Aggregeret capture + fast fingerprint (#2434-mønstret) løser ÉT
  call-site. Et SDK-niveau volumen-loft løser KLASSEN af bugs.** Når en
  incident-klasse (her: per-item-loop uden fingerprint) allerede har bidt
  én gang, er den rigtige forhindret-fremover ikke kun at rette
  instansen, men at gøre det UMULIGT for samme mønster at gentage sig et
  andet sted — ligesom #2389's `toSentryError()` centraliserede
  normalisering efter at have fundet spredte ad-hoc-fixes.
- **Kvote-udtømning er en cascading failure:** når Sentry stopper med at
  acceptere events, stopper ALLE alarmer — ikke kun den støjende. Et system
  der kun alarmerer på fejl har ingen forsvarslinje mod at miste
  alarmeringen selv. Volumen-guards og kvote-alarmer er infrastruktur for
  infrastrukturen.
