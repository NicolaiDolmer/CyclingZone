-- Fix live signup economy drift:
-- - teams created through the auth signup trigger must not receive stale test values.
-- - legacy placeholder teams with no finance activity are normalized to the canonical
--   season-1 economy: 800K starting balance and 240K annual sponsor.

ALTER TABLE public.teams
  ALTER COLUMN balance SET DEFAULT 800000,
  ALTER COLUMN sponsor_income SET DEFAULT 240000;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, username, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    'manager'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

UPDATE public.teams t
SET
  balance = CASE
    WHEN t.balance IS NULL OR t.balance = 500 THEN 800000
    ELSE t.balance
  END,
  sponsor_income = CASE
    WHEN t.sponsor_income IS NULL OR t.sponsor_income IN (100, 500) THEN 240000
    ELSE t.sponsor_income
  END
WHERE COALESCE(t.is_ai, false) = false
  AND COALESCE(t.is_bank, false) = false
  AND COALESCE(t.is_frozen, false) = false
  AND COALESCE(t.is_test_account, false) = false
  AND (
    t.balance IS NULL
    OR t.balance = 500
    OR t.sponsor_income IS NULL
    OR t.sponsor_income IN (100, 500)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.finance_transactions ft
    WHERE ft.team_id = t.id
  );

UPDATE public.board_profiles bp
SET
  plan_start_balance = 800000,
  plan_start_sponsor_income = 240000
FROM public.teams t
WHERE bp.team_id = t.id
  AND COALESCE(t.is_ai, false) = false
  AND COALESCE(t.is_bank, false) = false
  AND COALESCE(t.is_frozen, false) = false
  AND COALESCE(t.is_test_account, false) = false
  AND bp.plan_start_balance = 500
  AND bp.plan_start_sponsor_income IN (100, 500);
