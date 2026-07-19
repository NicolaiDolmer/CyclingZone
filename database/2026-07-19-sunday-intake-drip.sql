-- #2064 S0 — søndags-drip: generation_tag på riders (#2493-forberedelse:
-- stemples i ALLE ungdoms-genereringskanaler, format 's<sæsonnummer>') +
-- claim-tabel for søndags-tickets idempotens (mønster: scout_sweep_runs;
-- claim-FØRST pr. (hold, dato) gør boot-runs/replicas dobbelt-sikre, #2646-lærdommen).
-- Idempotent.

ALTER TABLE riders ADD COLUMN IF NOT EXISTS generation_tag TEXT;

-- riders bruger KOLONNE-niveau SELECT-grants (#2238/#1309/#2241): en ny kolonne
-- er usynlig (silent 403) for anon/authenticated uden eksplicit grant. Taggen er
-- ikke-sensitiv ('s1', 's2', ...) og skal kunne vises i klienten (#2493 årgangs-UI).
GRANT SELECT (generation_tag) ON public.riders TO anon, authenticated;

CREATE TABLE IF NOT EXISTS academy_intake_ticks (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tick_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, tick_date)
);

-- Service-role-only (ingen policies = deny for anon/authenticated; service role bypasser RLS).
ALTER TABLE academy_intake_ticks ENABLE ROW LEVEL SECURITY;
