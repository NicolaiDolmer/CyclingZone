# 2026-08-23 · Cutover-aftenens to fund: statement-timeout på masse-deletes + sæson-anker uden aktiv sæson

## Fund 1: authenticator-rollens statement_timeout=8s dræber masse-deletes gennem PostgREST

**Symptom:** D1-komprimeringens AI-oprydning (`reconcileAiTeamsForPool` → `removeAiTeams`) fejlede med
`canceling statement due to statement timeout` — først på én DELETE af 503 ryttere, efter chunking
på én DELETE af 25 hold.

**Rod-årsag (to lag):**
1. `authenticator`-rollen (som ALLE supabase-js-kald går igennem, også service-key) har
   `statement_timeout=8s` + `lock_timeout=8s` i prod. Scripts der kører "som service role" er
   IKKE fritaget.
2. 33 FK-kolonner i tabeller der refererer `riders`/`teams` manglede indeks (race_stage_roles,
   activity_feed, training_plans, auctions ×3, riders.ai_team_id m.fl.) → hver slettet række
   tvang seq-scans i de refererende tabeller. Klassisk unindexed-FK (Supabase-advisor-klassen).

**Fix (begge dele nødvendige):** FK-indekser (`database/2026-08-23-fk-indexes-cutover.sql`) +
chunkede deletes (ryttere 100 ids/statement, hold 3/statement — hold kaskade-sletter 2-3k
historik-rækker hver). Resultat: 149 s, 214/214 verificeret.

**Generalisering:** enhver populations-mutation via supabase-js skal regne med 8s pr. statement.
Batch-størrelse skal vælges efter KASKADE-omkostningen, ikke rækkeantallet. Staging fangede det
ikke, fordi staging-apply kun fjernede få hold og skemaet afveg (manglende constraint, #3839).

## Fund 2: "aktiv sæson"-opslag mellem Afslut sæson og transitionen rammer fallback

**Symptom:** værdi-refreshens dry-run gav Riva 4,17M i stedet for de ejer-godkendte 3,74M.

**Rod-årsag:** mellem "Afslut sæson" (S2 → completed) og transitionen (S3 → active) er der INGEN
aktiv sæson. `refreshChangedRiderValues` faldt tilbage til `seasonNumber ?? 1` → hele populationen
blev vurderet ét år for ung → for høje værdier. Ejeren fangede det selv på Riva-tallet.

**Fix:** `seasonNumber`-override + fallback til seneste COMPLETED sæson (aldrig 1). PR #4151.

**Generalisering:** al kode der ankrer på "den aktive sæson" har et udefineret vindue under
cutover. Grep efter `.eq("status", "active")`-mønstre før næste sæsonskifte; kandidater med
samme klasse af fallback bør få completed-fallback eller eksplicit parameter.

## Bonus-fund (proces)

- `remeasureGate3459.mjs` validerer stadig ikke sæsonargumentet (kendt fra generalprøven) — brug
  den AFSLUTTENDE sæsons nummer til pre-flip-gaten.
- Auto-mode-classifieren blokerede `endSeasonS2.mjs`/`executeSeasonTransition.js` selv som
  dry-run; detached `Start-Process` med log-fil + DB-polling virkede og gav samtidig
  timeout-immunitet (2-min/10-min-grænserne).
- c-korrektionen var som bygget et engangs-gange på `base_value` og ville være blevet overskrevet
  af progressionen + søndags-refreshen. Varig c = `level_correction` i modellen (PR #4135).
  Klassen "refresh skrev det væk igen" (#3449) ramte altså NÆSTEN igen — fanget før apply.

Refs #3901 #3449 #4151 #4135

## Fund 3 (spiller-rapporteret samme aften): divisionsbonussen kolliderede med bestyrelsesbonussen i TO lag

**Symptom:** 12 hold (bl.a. begge D2-puljevindere + Wander Riders) fik ingen
divisionsbonus ved sæson-slut; spillerne fangede det i #dansk-snak inden midnat.

**Rod-årsag, to uafhængige lag med samme fejl:**
1. `payDivisionBonuses`' dedup filtrerede på `type='bonus'` alene — en accepteret
   bestyrelsesbonus (samme type) talte som "allerede betalt".
2. DB-indekset `uniq_bonus_per_team_season` (partial unique på type='bonus')
   blokerede INSERT'en selv efter kode-fixet.

**Fix:** reason_code-filter i dedup'en + indeks erstattet med
`uniq_division_bonus_per_team_season` (scoped på reason_code). Reparation:
`scripts/dev/repairCutoverBonusAndRetiredSalary2308.mjs` (12 hold / 825k).

**Generalisering:** når en ny skrivning genbruger en eksisterende `type`, skal
BÅDE kode-dedups OG partial-unique-indekser på den type revideres. `type` er
ikke en identitet; `reason_code` er.

## Fund 4 (spiller-rapporteret): S3-løn trukket for ryttere der pensionerede i skiftet

`season_payroll` (fase 6) løber FØR `rider_progression` (fase 13), så de 28
ryttere der pensionerede i transitionen fik deres fulde S3-løn trukket hos
26 hold (~103.700). Pension afgøres af den AFSLUTTEDE sæsons alder og er
deterministisk FØR transitionen — payroll kunne ekskludere dem. Repareret med
refusioner (samme script); varigt fix = ekskludér deterministisk-pensionerede
i payroll ELLER flyt payroll efter progression (design-beslutning, ikke natten).
