# Postmortem · 2026-09-03 · AI-trim heal-sweep (CYCLINGZONE-49) lukket paa symptomet i 27 dage

## Hvad skete der?
AI-trim heal-sweep (`runAiTeamTrimHealSweep`) fejlede paa 1 hold ved naesten
hver 5-min-tick fra 2026-08-05 til 2026-09-01 — 221 Sentry-events under samme
gruppe CYCLINGZONE-49. #3414 identificerede en roedaarsag (navne-dubletter i
`entrant_key`-fallbacken) og blev lukket 6/8 som dublet af #3416/PR #3417 —
men Sentry-gruppen blev ALDRIG resolvet og fortsatte med at fyre dagen efter.
Ingen laeste den faktiske fejlbesked igen foer #4594 (2/9).

## Root cause
To sammenfaldende problemer:

1. **Telemetri-blindhed:** `cron.js`s `sentryCapture(..., { extra: { errors:
   result.errors } })` sendte `errors` som et array af `{teamId, message}`-
   OBJEKTER. Sentrys normalisering klippede dette til `extra.errors: ["[Object]"]`
   — den faktiske fejlbesked naaede aldrig frem til noget menneske kunne laese,
   hverken i Sentry-UI'et eller via MCP-opslag. Samme moenster gaar igen i
   MINDST 6 andre heal-sweeps i cron.js (selection-warning, training, ai-
   recovery, scout, wage-deduction, graduation, starter-squad, academy) — kun
   ai-trim er rettet i denne PR, resten er en `out_of_scope`-kandidat.
2. **Ingen eskalering for genuine, vedvarende fejl:** sweep'en havde allerede en
   loebs-bevidst backstop (#2434, STALE_BACKSTOP_HOURS=120) for hold der er
   BLOKERET (inflight/praemie/tilbud) i lang tid — den samler dem i ÉN
   fingerprintet stale-alarm i stedet for at spamme. Men et hold der ramte en
   GENUIN exception (throw, ikke bare "blokeret") fik INGEN tilsvarende
   eskalering — det blev ved med at generere et NYT `failed`-alarm-event hver
   eneste tick, for evigt, uden nogensinde at samle sig i én alarm nogen ville
   undersoege naermere.

Selve den oprindelige fejlbesked (hvilket hold, hvilken constraint) kunne IKKE
genskabes — Sentry havde den aldrig gemt laesbart, og live-reproduktion mod
prod 3/9 (read-only, `backend/.tmp-diag-4594.mjs`, aldrig committet) viste
`failed: 0` — hvad end der fejlede er enten selv-helet (rytterne har afsluttet
loebet siden) eller sammenfalder med #3417's entrant_uid-fix (6/8).

## Fix
- `backend/lib/aiTeamTrimHealSweep.js`: en genuin per-hold-exception der er
  aeldre end `STALE_BACKSTOP_HOURS` (120t siden `pending_removal_at`)
  eskaleres nu til `stale[]` med `reason: "error_exceeds_backstop"` og
  `message` (den faktiske fejl) i stedet for at blive ved med at taelle som
  `failed`. Unge fejl (< 120t) forbliver akutte (`failed`, uaendret adfaerd).
- `backend/cron.js` (`runAiTeamTrimHealSweepCron`): (1) den foerste fejlbesked
  staar nu direkte i selve `Error(...)`-teksten der sendes til Sentry — synlig
  i selve issue-titlen uden at aabne `extra`; (2) `errors`/`teams` sendes som
  FLADE STRENGE ("teamId: message") i stedet for indlejrede objekter, saa
  Sentrys normalizeDepth aldrig kan klippe dem til `[Object]` igen, uanset
  hvad den praecise graense er.
- To nye regressionstests i `aiTeamTrimHealSweep.test.js` (#4594): genuin fejl
  under backstop forbliver `failed`; genuin fejl over backstop flyttes til
  `stale` MED den oprindelige fejlbesked bevaret.

## Forhindret-fremover
- Fremtidige "1 hold fejlede hver dag i ugevis"-scenarier for DENNE sweep
  eskalerer nu til den samme fingerprintede stale-alarm som blokerings-
  grenene — ét issue at undersoege, ikke 200+ identiske events ingen aabner.
- Fejlbeskeden er nu ALTID laesbar direkte i Sentry-titlen/extra, saa naeste
  triage ikke kraever arkaeologi for at finde `extra.errors[0].message`.
- **Ikke fikset her (out_of_scope):** de oevrige ~6 sweeps i cron.js med samme
  `extra: { errors: result.errors }`-moenster har samme telemetri-blindhed.
  Boer flages som en samlet issue ("Sentry extra-objekt-klipning paa tvaers af
  heal-sweeps") saa det ikke skal genopdages hold-for-hold.

## Læring
Naar et issue lukkes som "dublet, fixet af PR X", SKAL Sentry-gruppen selv
resolves eksplicit (ikke kun GitHub-issuet) — ellers ser den ud til stadig at
vaere aktiv (eller genopstaar paa et ANDET hold/en anden aarsag under samme
gruppe), og ingen ser den igen foer nogen tilfaeldigvis genopdager den. Og:
`extra`-felter til Sentry med indlejrede objekter i arrays er en telemetri-
faelde — flad dem til strenge FOER capture, ellers er alarmen der findes,
men ingen kan laese den (samme klasse fejl som `console.log(obj)` der bliver
`[object Object]` i et logsystem uden util.inspect).
