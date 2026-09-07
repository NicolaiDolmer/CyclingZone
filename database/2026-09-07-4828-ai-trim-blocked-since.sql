-- #4828 (CYCLINGZONE-58): AI-trim persistent-stall-alarmen målte MARKØRENS alder
-- (pending_removal_at), ikke alderen på den blokering der gælder LIGE NU.
--
-- ROD-ÅRSAG: et hold markeret af årsag A (fx døde transfer_offers, #4233) kan stå
-- blokeret i dagevis, få A løst, og derefter blive LOVLIGT blokeret af et helt
-- almindeligt igangværende etapeløb — pending_removal_at-uret nulstilles aldrig når
-- blokerings-årsagen skifter, så backstoppen (aiTeamTrimHealSweep.js,
-- STALE_BACKSTOP_HOURS) fyrer "reelt fastlåst" på et hold der reelt kun har været
-- blokeret af den AKTUELLE årsag i timer. Prod-evidens 5-6/9: 4 hold, markøren
-- 55-179t gammel, gældende blokering var Settimana-finalen (langt yngre) — og alle
-- fire healede selv da finalen kørte færdigt 5/9.
--
-- HVAD DISSE KOLONNER GØR
--   pending_removal_blocked_reason: hvilken blokerings-klasse gjaldt sidst set
--     ("blocking_race" | "unpaid_prizes" | "transfer_offers_fk" | "live_offers").
--   pending_removal_blocked_since: hvornår DENNE klasse først blev set.
--   Sweep'en nulstiller "since" til nu hver gang klassen skifter (eller aldrig er
--   set før) — det er selve fixet: alderen der sammenlignes mod backstoppen er nu
--   blokeringens, ikke markørens.
--
-- Service-role-only (samme mønster som pending_removal_at selv) — ikke player-
-- facing, ingen klient-GRANT nødvendig.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Ingen backfill — NULL betyder "klassen er
-- endnu ikke set af det nye fix", hvilket er korrekt for alle eksisterende
-- markerede hold: sweep'en sætter felterne selv ved næste tick (uret starter
-- forfra i sikker retning — det kan kun UDSKYDE en alarm, aldrig undertrykke en
-- reelt vedvarende blokering, fordi den nye klasse stadig skal overleve
-- STALE_BACKSTOP_HOURS fra dette tidspunkt).
--
-- ROLLBACK:
--   ALTER TABLE public.teams DROP COLUMN IF EXISTS pending_removal_blocked_reason;
--   ALTER TABLE public.teams DROP COLUMN IF EXISTS pending_removal_blocked_since;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS pending_removal_blocked_reason text;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS pending_removal_blocked_since timestamptz;
