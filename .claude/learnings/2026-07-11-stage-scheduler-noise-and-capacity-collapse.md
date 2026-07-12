# Postmortem · 2026-07-11 · Stage-scheduler log-støj + stall-watchdog false-alarm (#2251)

## Hvad skete der?
Sentry viste to signaler i prod 3/7-9/7: "No start list for race" (CYCLINGZONE-22/23,
escalating, 36 events) fra `simulateStageByIndex`, og stall-watchdog "stage stall"
(CYCLINGZONE-24, 23 events, løbende). Begge blev tolket som mulig hang i race-motoren.

## Root cause
1. **Ikke datakorruption** — kapacitetskollaps i lav-divisionerne (8-15): 10/7-diagnosen
   (#2276-tråden) fandt at to samtidige 21-etapers grand tours fejlagtigt var
   materialiseret i tier 4 oveni de normale små etapeløb i samme binding-vindue.
   ~12 ryttere/hold kunne ikke dække 18-22 samtidigt bundne pladser → 0-entrant-felter
   → `simulateStageByIndex` throw'ede "No start list" hver scheduler-tick for de samme
   løb. Rettet ved GT-gate (PR #2267) + ejer-kørt oprydning 10/7 (13 GT-instanser
   slettet, tier 4 re-materialiseret).
2. **To separate STØJ-bugs blev IKKE rettet af GT-oprydningen** (denne PR):
   - `stageScheduler.js`s `failRace()` deduplede kun Sentry-capturen — selve
     `console.error`-loggen kørte ustruktureret HVERT tick for samme fastlåste løb.
   - `stallWatchdog.js`s "stage"-check fyrede på et GLOBALT
     "ingen resultater importeret NOGET sted i >2t"-signal i stedet for at bruge den
     allerede-eksisterende per-etape `has_results`-liste — støjede hver nat mellem
     løbsdage (7 events/døgn, 0 ægte hangs), fordi INGEN etape var due de timer.

## Fix
- `backend/lib/stageScheduler.js`: `failRace()` dedup'er nu BÅDE log og Sentry-capture
  via en injicerbar `seenKeys`-Set (mirror stallWatchdog's mønster), logger struktureret
  JSON (`event: "stage_scheduler_race_failed"`). `cron.js` holder en persistent
  `stageSchedulerSeenKeys`-Set på tværs af ticks.
- `backend/lib/stallWatchdog.js`: "stage"-checket er nu PRÆCIST og pr.-løb (fyrer kun
  når en konkret forfalden etape mangler resultater — `dueStages`-listens
  `has_results=false` var allerede tilgængelig, blot ubrugt til selve fire-betingelsen).
  Det gamle globale throughput-signal lever videre som `stage_throughput`,
  `level:"info"` — logges, alarmerer aldrig Discord/Sentry.

## Forhindret-fremover
- 46 nye unit-tests (dedup-adfærd, skip-fortsættelse, præcis-alert-betingelser) i
  `stageScheduler.test.js` + `stallWatchdog.test.js`.
- Prod-diagnose (read-only, 11/7) bekræftede: 0 forfaldne etaper uden resultater lige
  nu, men NYE tier-4-løb (materialiseret 10/7 til 11/7→26/7-vinduet) viser samme
  0-entry-mønster i flere divisioner (fx "Vuelta a los Picos" div 9-11: 0 entries,
  first stage 12/7 10:00 UTC) — kapacitets-gaten i materializeren (owner-plan punkt B1
  i #2251) er IKKE bygget endnu. Uden den vil #2251-mønstret gentage sig ugentligt.

## Læring
Et symptom kan have to lag: en ægte data-hændelse (kapacitetskollaps, rettet af
ejeren 10/7) OG en separat observability-bug (manglende log-dedup + forkert
alert-granularitet) der overlever selv efter data-fixet. Fix begge — ellers ser
watchdoggen "rolig" ud af de forkerte grunde næste gang en løbsklynge kolliderer.
