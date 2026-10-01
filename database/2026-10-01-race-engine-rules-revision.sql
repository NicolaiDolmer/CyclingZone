-- [#5955] Immutable taktisk regel-revision pr. løb (#5984 Task 2).
--
-- Ejer-godkendt releaseprincip (release A, 30/9): korrekthedsrettelser må gælde fra
-- næste ikke-kørte etape, men NY taktik/balance gælder kun løb der starter efter
-- aktiveringen. Et igangværende etapeløb færdiggøres med de regler det startede på.
--
-- races.engine_rules_revision (text, nullable):
--   'legacy'       = de taktiske regler fra før #5955
--   'orders_gc_v1' = ordrestyret morgenudbrud + (næste pakke) faktisk GC-reaktion
--   NULL           = intet bundet endnu. På et STARTET løb betyder NULL altid legacy,
--                    aldrig automatisk opt-in (backend/lib/raceEngineRulesRevision.ts).
--
-- Hvem skriver: KUN backend-runneren (service role) ved løbets første etape-claim,
-- med én betinget UPDATE (WHERE engine_rules_revision IS NULL AND stages_completed = 0),
-- jf. raceRunner.bindRaceRulesRevision. Ifølge repoets migrationer har races kun en
-- offentlig SELECT-policy, så ingen klient-rolle kan skrive kolonnen (post-verify
-- nedenfor tjekker policies i prod). Revisionen nye løb bindes til er en konstant i
-- koden (CURRENT_RACE_RULES_REVISION, i dag 'legacy'); skiftet til 'orders_gc_v1' er
-- et særskilt ejer-go efter kalibrering (#5984 Task 6).
--
-- Additiv og idempotent: ingen eksisterende kolonne røres, ingen data flyttes, ingen
-- default på eksisterende rækker. Koden fungerer også FØR denne migration er applied
-- (fravær af kolonnen = legacy, intet skrives).
--
-- Post-verify (read-only):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'races' AND column_name = 'engine_rules_revision';
--   SELECT conname FROM pg_constraint WHERE conname = 'races_engine_rules_revision_check';
--   SELECT engine_rules_revision, count(*) FROM public.races GROUP BY 1;
--   SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'races';

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS engine_rules_revision text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'races_engine_rules_revision_check'
       AND conrelid = 'public.races'::regclass
  ) THEN
    ALTER TABLE public.races
      ADD CONSTRAINT races_engine_rules_revision_check
      CHECK (engine_rules_revision IS NULL OR engine_rules_revision IN ('legacy', 'orders_gc_v1'));
  END IF;
END
$$;

COMMENT ON COLUMN public.races.engine_rules_revision IS
  '#5955: taktisk regel-revision bundet ved løbets første etape-claim (legacy | orders_gc_v1). NULL på et startet løb = legacy. Skrives kun af backend-runneren. Kontrakt: backend/lib/raceEngineRulesRevision.ts';
