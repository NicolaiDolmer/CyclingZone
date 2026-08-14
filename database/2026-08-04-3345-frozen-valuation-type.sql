-- database/proposals/2026-08-04-3345-frozen-valuation-type.sql
-- #3345 — fryser ryttertypen der driver VÆRDISÆTNINGEN (base_value/market_value),
-- adskilt fra den frit reklassificerbare primary_type/secondary_type (#3325/#3343).
--
-- BAGGRUND: #3325/#3343 omklassificerer primary_type mod ability_caps (rytterens
-- POTENTIALE i stedet for nuværende form). Målt mod hele prod-populationen (8.282
-- aktive ryttere, #3345-issue-tråden) flytter det populationens samlede
-- market_value -24,5% under V4 (den LIVE valuation-model, #2594-cutover) med de
-- EKSISTERENDE, u-refittede koefficienter — 239/367 (65%) rigtige hold ville se
-- ≥10% trup-værdi-skift. En gyldig re-fit af V4 kræver en fuld Monte
-- Carlo-sæson-simulering (simulateSeasonProduction.js), en markant større opgave
-- end selve reklassificeringen — ikke udført her.
--
-- EJER-BESLUTNING (4/8, sen aften, kommenteret på #3345): frys værdisætningen på
-- den type ryttere rent faktisk HAR i prod I DAG, så #3325/#3343's typer kan
-- udgives med det samme uden at flytte økonomien. primary_type/secondary_type må
-- herefter reklassificeres frit. Value-stien (predictBaseValue/predictBaseValueV4/
-- currentProductionValue i backend/lib/riderValuation.js + riderCareerNpv.js)
-- læser valuation_type FØRST, med fallback til primary_type for rækker/objekter
-- der aldrig fik feltet sat (fixtures, simulations, en rytter der endnu ikke er
-- insertet).
--
-- NÅR V4 ER RE-FITTET mod den nye klassifikation (opfølgnings-issue #3353): fjern
-- valuation_type-fallback-kæderne i riderValuation.js/riderCareerNpv.js, lad
-- værdien læse primary_type direkte igen, og drop denne kolonne (+ dens indeks) i
-- en efterfølgende migration.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + backfillet rammer kun rækker hvor
-- valuation_type stadig er NULL, så gen-kørsel er en no-op. Rent additivt — ingen
-- eksisterende kolonne eller data røres/slettes.
--
-- RÆKKEFØLGE (kritisk): denne migration SKAL køres FØR #3343's
-- reklassificerings-backfill (backend/scripts/backfillRiderTypes.js) rammer prod,
-- ellers backfilles valuation_type fra den ALLEREDE reklassificerede primary_type
-- (fanger den forkerte tilstand). Se Post-verify #2 nedenfor for hvordan det
-- opdages hvis rækkefølgen alligevel blev byttet om.

-- Server-only felt: valuation_type laeses udelukkende af backend'en
-- (riderValuation.js, riderCareerNpv.js, backfillCores.js,
-- riderProgressionEngine.js) med service_role. Verificeret 14/8 at INGEN
-- frontend-fil refererer kolonnen, og at prod matcher: primary_type,
-- market_value og popularity er grantet paa kolonne-niveau, valuation_type er
-- det ikke. Fail-closed er det oenskede resultat her, ikke en forglemmelse.
-- riders-column-grant-ok: server-only felt, se noten ovenfor (#3345)
ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS valuation_type TEXT;

COMMENT ON COLUMN public.riders.valuation_type IS
  '#3345: FROSSET ryttertype til værdisætning (predictBaseValue/predictBaseValueV4/'
  'currentProductionValue), adskilt fra den frit reklassificerbare primary_type '
  '(#3325/#3343). Sat ÉN GANG ved dette backfill til den type rytteren HAVDE i '
  'prod FØR #3343s reklassificerings-backfill kørte. primary_type/secondary_type '
  'må ændre sig frit herefter uden at flytte market_value/base_value. For NYE '
  'ryttere (oprettet efter dette backfill) sættes valuation_type = primary_type '
  'ÉN GANG ved oprettelse (deriveForRiderIds, backend/lib/backfillCores.js) — der '
  'findes ingen "gammel" prod-værdi at fryse for dem. NULL = falder tilbage til '
  'primary_type i valuation-koden (se riderValuation.js). Fjern dette felt + lad '
  'valuation læse primary_type direkte igen når V4 er re-fittet mod den nye '
  'klassifikation (opfølgnings-issue #3353).';

-- Backfill: kun rækker hvor feltet stadig er NULL (idempotent).
UPDATE public.riders
SET valuation_type = primary_type
WHERE valuation_type IS NULL;

-- Samme indeks-mønster som primary_type/secondary_type (2026-06-06-rider-types.sql)
-- — valuation_type filtreres ikke server-side i UI'et i dag, men indekset holder
-- fremtidige admin-diagnostik-queries (fx "hvor mange ryttere har et valuation_type
-- der afviger fra primary_type") billige på ~9.000+ rækker.
CREATE INDEX IF NOT EXISTS idx_riders_valuation_type ON public.riders (valuation_type);

-- ── Post-verify (kør manuelt, læs kun — INGEN destruktiv handling i denne fil) ──
--
-- 1) Alle rækker med en primary_type skal nu også have en valuation_type:
--   SELECT count(*) FILTER (WHERE primary_type IS NOT NULL AND valuation_type IS NULL) AS missing
--   FROM public.riders;
--   -- Forventet: 0.
--
-- 2) Kør denne FØR #3343s reklassificerings-backfill rammer prod: valuation_type
--    og primary_type skal være IDENTISKE for ALLE rækker (frysningen fangede
--    prod-tilstanden 1:1). Et ikke-nul resultat her betyder at rækkefølgen blev
--    byttet om (se note ovenfor) — STOP og eskalér, backfillet skal køres om fra
--    et PITR-snapshot af riders.primary_type taget FØR #3343s backfill.
--   SELECT count(*) AS mismatched_before_reclass
--   FROM public.riders
--   WHERE valuation_type IS DISTINCT FROM primary_type;
--   -- Forventet: 0 (kun hvis kørt FØR #3343s backfill).
--
-- 3) Kør denne EFTER #3343s reklassificerings-backfill: valuation_type må ALDRIG
--    ændre sig (kun primary_type/secondary_type flytter). Denne migration
--    RØRER ALDRIG valuation_type efter det initielle backfill ovenfor, så en
--    diff mod et før-snapshot (taget ved verify #2) er den endelige bekræftelse:
--   SELECT count(*) AS riders_where_type_diverged_from_valuation
--   FROM public.riders
--   WHERE valuation_type IS DISTINCT FROM primary_type;
--   -- Forventet EFTER #3343s backfill: > 0 (typer ÆNDRER sig frit — det er meningen).
--   -- Det der IKKE må ske: brug backend/scripts/measureValuationImpactAfterRiderTypeReclassification.js
--   -- til at bekræfte at populationens SAMLEDE market_value (V4) er uændret —
--   -- se PR'ens Brugerverifikation-sektion for det faktiske før/efter-tal.
