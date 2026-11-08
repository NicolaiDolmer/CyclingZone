-- #6110 Udvikling 2.0, byggetrin 2 (spec 2026-10-23-6110-potentiale-et-tal-samlet-design.md §4, §3.3, §11).
--
-- ADDITIV + IDEMPOTENT. Ingen eksisterende data aendres, intet laeses af spillet endnu:
-- ingen kode skriver eller laeser de nye felter foer byggetrin 4/5/12, og visningen
-- bag dem er slukket. Spilleren ser intet.
--
-- 1) riders.base_talent    - det faste, skjulte grundtalent i ratingens skala (retning C).
--    riders.talent_ceiling - det reelle loft (levende talent) i ratingens skala, som
--                            motor, skoen og harness skal laese samme tal fra (§4).
--    Begge er NULL, indtil omregningen 1-6 -> 1-99 (byggetrin 12) koeres med dry-run og
--    ejer-go. Denne migration fylder dem IKKE.
--
-- 2) Kolonne-privilegier (#1162-modellen): riders er fail-closed for SELECT (ingen
--    tabel-SELECT til anon/authenticated, kun eksplicitte kolonner). De to nye kolonner
--    grantes bevidst IKKE. For en sikkerheds skyld revokes de eksplicit, og blokken
--    nederst fejler hele migrationen, hvis en klient-rolle alligevel kan laese dem
--    (fx fordi nogen har givet tabel-SELECT). Skrivning fra klienten afvises af RLS
--    (riders har kun en SELECT-policy), samme beskyttelse som riders.potentiale.
--    OBS: backend koerer service_role og ser kolonnerne. Ruter der selecter `*` paa
--    riders (fx GET /riders/:id, akademi-rosteret) skal strippe dem, foer de fyldes
--    (byggetrin 12) - se HIDDEN_RIDER_TALENT_COLUMNS i backend/lib/potentialEstimate.js.
--
-- 3) public.rider_potential_estimates - det gemte skoen pr. (rytter, hold) (§3.3):
--    skrives kun ved nyt kig / bedre scout, ved soendagskoerslen og ved holdskifte;
--    ellers staar tallet stille. Tabellen er KUN for serveren: RLS uden policies og
--    ingen privilegier til anon/authenticated. Klienten faar kun tal + ord via API'et,
--    aldrig usikkerhed, vidensniveau eller det loft skoennet blev skrevet med (gate H4).

BEGIN;

-- #6342: riders laeses konstant af spillerne; vent hellere kort og fejl (auto-migrate
-- kan koeres igen) end at holde en laase-koe foran spillernes laesninger.
SET LOCAL lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1) Skjult grundtalent + reelt loft paa riders
-- ---------------------------------------------------------------------------
-- riders-column-grant-ok: skjult med vilje (#6110 spec §1/S20: grundtalentet vises kun som skøn + ord, aldrig som råt tal til klienten)
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS base_talent smallint;
-- riders-column-grant-ok: skjult med vilje (#6110 spec §1/S20: grundtalentet vises kun som skøn + ord, aldrig som råt tal til klienten)
ALTER TABLE public.riders ADD COLUMN IF NOT EXISTS talent_ceiling smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.riders'::regclass AND conname = 'riders_base_talent_range'
  ) THEN
    ALTER TABLE public.riders
      ADD CONSTRAINT riders_base_talent_range CHECK (base_talent IS NULL OR base_talent BETWEEN 1 AND 99);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.riders'::regclass AND conname = 'riders_talent_ceiling_range'
  ) THEN
    ALTER TABLE public.riders
      ADD CONSTRAINT riders_talent_ceiling_range CHECK (talent_ceiling IS NULL OR talent_ceiling BETWEEN 1 AND 99);
  END IF;
END $$;

COMMENT ON COLUMN public.riders.base_talent IS
  '#6110: hidden base talent on the rating scale (1-99). Server-only (column privileges, #1162 model). NULL until the owner-gated 1-6 -> 1-99 conversion runs.';
COMMENT ON COLUMN public.riders.talent_ceiling IS
  '#6110: hidden real ceiling (living talent) on the rating scale (1-99), read by engine, estimate and harness. Server-only. NULL until populated.';

-- ---------------------------------------------------------------------------
-- 2) Kolonne-privilegier: aldrig laesbare for klient-roller
-- ---------------------------------------------------------------------------
REVOKE SELECT (base_talent, talent_ceiling) ON public.riders FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Gemte skoen pr. (rytter, hold)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rider_potential_estimates (
  rider_id           uuid        NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  team_id            uuid        NOT NULL REFERENCES public.teams(id)  ON DELETE CASCADE,
  -- Det spilleren ser: tal + ord.
  value              smallint    NOT NULL CHECK (value BETWEEN 1 AND 99),
  certainty          text        NOT NULL CHECK (certainty IN ('unsure', 'fair', 'sure')),
  -- Kun serveren: usikkerheden og vidensniveauet bag tallet (monotoni-vaernet laeser dem).
  uncertainty        numeric     NOT NULL CHECK (uncertainty > 0),
  knowledge_key      text        NOT NULL,
  -- Kun serveren: det loft skoennet blev skrevet med. Soendagskoerslen sammenligner
  -- med riders.talent_ceiling for at se, om det levende talent har flyttet sig.
  ceiling_at_write   smallint    NOT NULL CHECK (ceiling_at_write BETWEEN 1 AND 99),
  -- Kalibreringens version (selve tallene er private, hard rule 17).
  params_version     text        NOT NULL,
  write_reason       text        NOT NULL CHECK (write_reason IN ('new_knowledge', 'sunday', 'team_change', 'backfill')),
  -- "Aendret siden sidst" (S3: soendagsbesked + profil-linje).
  previous_value     smallint    CHECK (previous_value IS NULL OR previous_value BETWEEN 1 AND 99),
  previous_certainty text        CHECK (previous_certainty IS NULL OR previous_certainty IN ('unsure', 'fair', 'sure')),
  changed_at         timestamptz,
  computed_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rider_id, team_id)
);

CREATE INDEX IF NOT EXISTS rider_potential_estimates_team_idx
  ON public.rider_potential_estimates (team_id);

COMMENT ON TABLE public.rider_potential_estimates IS
  '#6110: stored potential estimate per (rider, team). Written only on new knowledge, the Sunday run or a team change. Server-only: RLS without policies, no client privileges.';

-- data-api-access: {"table":"public.rider_potential_estimates","roles":{"anon":[],"authenticated":[],"service_role":["SELECT","INSERT","UPDATE","DELETE"]},"reason":"Hidden per-team potential estimates (#6110); only the backend reads and writes them, clients get number + word through the API"}
ALTER TABLE public.rider_potential_estimates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rider_potential_estimates FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_potential_estimates TO service_role;

-- ---------------------------------------------------------------------------
-- Post-verify i samme transaktion (BEGIN/COMMIT): fejl hellere end at laekke.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r text;
  c text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH c IN ARRAY ARRAY['base_talent', 'talent_ceiling'] LOOP
      IF has_column_privilege(r, 'public.riders', c, 'SELECT') THEN
        RAISE EXCEPTION '#6110: role % can SELECT riders.% - refusing to leave hidden talent readable', r, c;
      END IF;
    END LOOP;
    IF has_table_privilege(r, 'public.rider_potential_estimates', 'SELECT')
       OR has_table_privilege(r, 'public.rider_potential_estimates', 'INSERT')
       OR has_table_privilege(r, 'public.rider_potential_estimates', 'UPDATE')
       OR has_table_privilege(r, 'public.rider_potential_estimates', 'DELETE') THEN
      RAISE EXCEPTION '#6110: role % has privileges on rider_potential_estimates - must be server-only', r;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
