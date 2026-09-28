-- #5844 — "Tak fra bestyrelsen": ét engangs-kuld på 10 akademi-TILBUD til hvert
-- aktivt menneskehold (ejer-design 28/9). Genbruger den eksisterende tilbuds-
-- mekanik (academy_intake.status 'offered' → signAcademyCandidate), men kuldet
-- skal kunne skelnes fra det normale optag:
--
--   1. academy_intake.source — hvor tilbuddet kom fra. 'intake' er ALT der
--      findes i dag (DEFAULT, så eksisterende skrive-stier er uændrede og ingen
--      række skal backfilles). 'board_gift' bærer tre særregler i koden:
--        • signing-fee = 0 (academyIntake.signAcademyCandidate)
--        • tilbuddet udløber efter 14 dage i stedet for 7
--          (academyIntakeExpirySweep + GET /api/academy/me's expiresAt)
--        • akademi-siden viser kuldet under sit eget mærke
--   2. academy_gift_claims — idempotens-claim pr. (hold, batch). Claim-først,
--      samme mønster som academy_intake_ticks: PK-kollision = holdet har
--      allerede fået kuldet, uanset om det siden har signet/afvist/udløbet det.
--      Service-role-only (RLS on, ingen policies).
--
-- Idempotent: kan køres igen uden effekt. Ikke destruktiv.

ALTER TABLE public.academy_intake
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'intake';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academy_intake_source_check'
  ) THEN
    ALTER TABLE public.academy_intake
      ADD CONSTRAINT academy_intake_source_check CHECK (source IN ('intake', 'board_gift'));
  END IF;
END $$;

-- Delvist indeks: kun de få ikke-standard-rækker (udløbs-sweep'en filtrerer på dem).
CREATE INDEX IF NOT EXISTS academy_intake_source_offered_idx
  ON public.academy_intake (source, created_at)
  WHERE status = 'offered' AND source <> 'intake';

CREATE TABLE IF NOT EXISTS public.academy_gift_claims (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  batch text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, batch)
);

ALTER TABLE public.academy_gift_claims ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.academy_intake.source IS
  '#5844: intake (normalt optag) | board_gift (bestyrelsens engangs-kuld: fee 0, 14 dages frist)';
COMMENT ON TABLE public.academy_gift_claims IS
  '#5844: idempotens-claim for engangs-kuld pr. (hold, batch). Service-role-only.';
