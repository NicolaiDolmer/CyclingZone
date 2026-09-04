-- #4753 · AI-hold nedlægges i stedet for at hård-slettes.
--
-- teams.retired_at: sættes af aiTeamRetirement.retireAiTeam() når et AI-hold
-- nedlægges af trim-stien. Nedlæggelsen skriver i ÉN update:
--     retired_at = now(), league_division_id = NULL, pending_removal_at = NULL
-- league_division_id = NULL er selve pulje-exiten (samme "frigiv pladsen"-
-- mekanik som managerParking.parkTeam, #4592, og som #4183's occupancy-tælling
-- allerede respekterer) — puljen falder til 24 i samme øjeblik.
--
-- HVORFOR EN NY KOLONNE og ikke et eksisterende felt:
--   · parked_at (#4592)          = "menneske-manager væk, holdet kan komme tilbage".
--                                  selectTeamsToPark gater paa isHumanTeam — de to
--                                  semantikker maa ikke blandes.
--   · pending_removal_at (#2187) = "burde trimmes, men er udskudt". Heal-sweep'ens
--                                  budget-gate (#2407) hviler paa den betydning.
--                                  Nedlaeggelse RYDDER markoeren, den overtager den ikke.
--
-- Baggrund (#4753/#4233): trimmen hård-slettede teams+riders, saa enhver tabel med
-- en NO ACTION-FK mod dem kunne blokere den (#2074 race_entries, #2389 race_results,
-- #4233 transfer_offers — en ny hver maaned siden juli). 4 af 15 puljer stod paa 25
-- hold 4/9 og 13 AI-hold var permanent utrimbare pga. DOEDE transfer_offers-raekker.
-- Nedlaeggelse fjerner DELETE fra trim-stien helt, saa klassen forsvinder.
--
-- Additiv, nullable, idempotent. INGEN destruktiv klasse. Applies af CI ved merge
-- (auto-migrate.yml). Koden bag den er flag-gated (app_config
-- ai_team_retire_enabled, default OFF) — denne migration aendrer intet i sig selv.
--
-- Post-verify:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'teams' AND column_name = 'retired_at';
--   SELECT count(*) FROM public.teams WHERE retired_at IS NOT NULL;  -- forventet 0

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS retired_at timestamptz;

-- Nedlagte hold slaas op pr. "er dette hold ude af spillet?" (faa raekker, hoej
-- selektivitet) — partielt indeks holder det minimalt.
CREATE INDEX IF NOT EXISTS idx_teams_retired_at
  ON public.teams (retired_at)
  WHERE retired_at IS NOT NULL;
