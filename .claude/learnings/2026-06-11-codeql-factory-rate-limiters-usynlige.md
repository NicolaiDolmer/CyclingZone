# CodeQL kan ikke spore factory-byggede rate limiters → evig alert-strøm

**Dato:** 2026-06-11 · **Alerts:** code-scanning 130-162 (`js/missing-rate-limiting`, High) · **PR:** #1300

## Symptom

CodeQL åbnede løbende "Missing rate limiting"-alerts på admin-ruter i `backend/routes/api.js` — også på ruter der **HAR** `adminWriteLimiter`. Sundhedsauditen 1/6 dismissede 20+ som false positive/won't fix, men hver ny admin-rute genåbnede strømmen (11 nye alerts på 10 dage).

## Rod-årsag

`js/missing-rate-limiting` genkender kun middleware den kan spore til et direkte `rateLimit()`-kald fra `express-rate-limit`. Vores limitere bygges via `buildLimiter()`-factory i `lib/rateLimiters.js` — den indirection (factory-return + modul-eksport) kan CodeQL's type-tracking ikke følge. Beskyttede ruter så derfor ubeskyttede ud.

## Fix (forward-guard)

Én router-level guard i `api.js`, skrevet som **direkte** `rateLimit()`-kald (CodeQL-synlig) og mountet `router.use("/admin", adminApiLimiter)` FØR `requireAdmin`:

- Lukker reglen for alle nuværende + fremtidige admin-ruter (ingen ny dismissal-rutine pr. endpoint).
- Lukker samtidig det reelle (lille) hul: 4 admin-GET-reads uden limiter, og dæmper hammering mod auth-laget (IP-nøglet, da `req.user` ikke findes før `requireAdmin`).
- Per-rute-limitere gælder uændret oveni.

## Læring

1. Ved "umulige" statiske-analyse-alerts (værktøj flagger beskyttet kode): mistænk indirection (factory/wrapper/re-export) før du mistænker koden.
2. Vælg den løsning analyse-værktøjet kan SE, når den også er arkitektonisk forsvarlig — én synlig router-guard slår N usynlige per-rute-guards + manuel dismissal-rutine.
3. Dismissal skalerer ikke som forward-guard: hver ny rute = ny alert = ny manuel handling.

**Verifikation 11/6 ~18:30:** Efter PR #1300 på main: 0 åbne `js/missing-rate-limiting`-alerts — alle lukket som *fixed* af CodeQL selv (inkl. de 6 på ruter med factory-limiter). Strategien bekræftet empirisk.
