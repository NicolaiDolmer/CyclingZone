-- 2026-06-18 · board_satisfaction_events (#1451, afløser #1187).
-- Løb-for-løb log af bestyrelses-tilfredshedens bevægelse. VISNINGS-ONLY:
-- mekanikken (boardWeekendFinalization.js) er uændret — dette logger blot det
-- den allerede gør, så frontend kan vise retning + historik + "hvorfor".
-- Serveres KUN server-side via /board/status (service-role) → ingen anon GRANT.
CREATE TABLE IF NOT EXISTS public.board_satisfaction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.board_profiles(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  race_id uuid REFERENCES public.races(id) ON DELETE SET NULL,
  race_name text,
  race_days_completed integer,
  satisfaction_before integer NOT NULL,
  satisfaction_after integer NOT NULL,
  satisfaction_delta integer NOT NULL,
  goals_met integer NOT NULL DEFAULT 0,
  goals_total integer NOT NULL DEFAULT 0,
  reason_category text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS board_satisfaction_events_board_race_uniq
  ON public.board_satisfaction_events (board_id, race_id);
CREATE INDEX IF NOT EXISTS board_satisfaction_events_board_created_idx
  ON public.board_satisfaction_events (board_id, created_at DESC);
