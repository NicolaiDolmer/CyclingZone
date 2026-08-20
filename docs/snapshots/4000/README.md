# Dateret snapshot — #4000 (type-dæmpning i værdiformlen)

**Formål:** facit-grundlaget for scorecardet i
`docs/audits/2026-08-20-4000-type-daempning-scorecard.md`. Read-only —
scriptet nedenfor rører ALDRIG databasen eller `riderValuationModelV4.json`.

| fil | indhold |
|---|---|
| `population.json.gz` | 8.945 aktive (`is_retired=false`) ryttere: id, navn, fødselsdato, potentiale, `valuation_type`/`primary_type`, `team_id`, `owner_is_ai`, `is_academy`, `base_value`, `market_value`, `prize_earnings_bonus`, alle 15 `VISIBLE_ABILITIES`. Hentet 2026-08-20T10:15:36Z via Supabase MCP `execute_sql` (projekt `ghwvkxzhsbbltzfnuhhz`). |
| `meta.json` | aktiv sæson, population-tællinger pr. type (total + menneskehold), kildequery. |
| `scorecard-results.json` | harnessens maskinlæsbare output — alle 16 scenarier × pr.-type-deltas, top-20-udslag, menneskehold-puncheur/gc-tal, monotoni-sanity. Tallene i scorecard-markdown'en er udtrukket herfra. |

**Alders-konventionen:** `age = ageForSeason(birthdate, 2)` (sæson-alder, samme
konvention som resten af værdi-kæden — se `backend/lib/riderSeasonAge.js`).

## Genskabes med

```bash
# 1) Hent population (read-only SQL via Supabase MCP execute_sql, projekt ghwvkxzhsbbltzfnuhhz):
#    select r.id, r.firstname, r.lastname, r.birthdate, r.potentiale, r.valuation_type,
#      r.primary_type, r.team_id, r.owner_is_ai, r.is_academy, r.base_value, r.market_value,
#      r.prize_earnings_bonus, a.climbing, a.time_trial, a.flat, a.tempo, a.sprint,
#      a.acceleration, a.punch, a.endurance, a.recovery, a.durability, a.descending,
#      a.cobblestone, a.positioning, a.aggression, a.tactics
#    from riders r join rider_derived_abilities a on a.rider_id = r.id
#    where r.is_retired = false order by r.id;
#    → gem som docs/snapshots/4000/population.json.gz (jf. formatet i denne mappe)

cd backend
node scripts/dev/typeDampeningHarness4000.mjs \
  --snapshot=../docs/snapshots/4000/population.json.gz \
  --json=../docs/snapshots/4000/scorecard-results.json
```

Verificeret determinisme: to kørsler mod samme snapshot producerer byte-identisk
JSON (kun `measured_at`-feltet afviger).

## Hvad målingen viste (20/8)

Se `docs/audits/2026-08-20-4000-type-daempning-scorecard.md` for det fulde
scorecard + anbefaling. Kort: 16 scenarier (baseline + 3× offset-regularisering
+ 3× alpha-sænkning + 9× kombination) målt mod hele den aktive population.
Offset-regularisering ALENE (k=100) dæmper puncheur-medianen ‑78 % og
gc-medianen ‑13 % med moderat forstyrrelse (normaliserings-faktor ×1,23,
ingen inversion i noget scenarie). Alpha-håndtaget alene/i kombination flytter
markant MERE (normaliserings-faktor op til ×2,65) og virker MOD hensigten efter
normalisering — anbefalingen er derfor ren offset-regularisering.
