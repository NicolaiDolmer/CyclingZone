-- #4515 · Resultat-bonusloftet er et SÆSON-loft, ikke et kontrakt-loft.
--
-- sponsor_contracts.results_bonus_paid akkumulerede hver gang en sejrs-/podie-
-- bonus blev udbetalt (backend/lib/sponsorRaceDayIncome.js) og blev ALDRIG
-- nulstillet. 'results'-varianten er toårig (backend/lib/sponsorOffers.js), så
-- et hold der brugte loftet op i sit første år kørte hele det andet år uden en
-- eneste resultat-bonus — mens den garanterede base og løbsdagsraten blev
-- fornyet per sæson som normalt. Kun dette ene loft havde kumulativ semantik;
-- season_objective-klausulen udbetales fx hver sæson kontrakten er aktiv.
--
-- Kode-fixet (samme PR) nulstiller forbruget i expireAndRenewContracts, dér hvor
-- en flersæsons-kontrakt krydser en sæsongrænse. Denne migration rydder op efter
-- de kontrakter der ALLEREDE har krydset en grænse uden nulstilling.
--
-- Målt i prod 31/8 (S3 aktiv, 4 løbsdage kørt):
--   Team WolkerWessels (Vesna Robotics) · loft 238.000 · brugt 238.000 (100 %)
--     → 238.000 udbetalt i S2, 0 i S3 trods etapesejre.
--   BPTrain (Bjarke Design) · loft 166.950 · brugt 163.170 (98 %)
--     → 158.760 i S2, 4.410 i S3; reelt tomt efter én podieplacering.
--
-- Forbruget sættes til det FAKTISK udbetalte i den aktive sæson — ikke til 0.
-- Et fladt nul ville forære BPTrain de 4.410 det allerede har fået i S3 en gang
-- til. Summen læses af finance_transactions, som er kilden til hvad der er
-- udbetalt (idempotency_key 'sponsor_results:<race>:<team>').
--
-- ⚠️ LIVSCYKLUS, LÆS FØR MERGE: filer i database/2026-*.sql KØRER AUTOMATISK
--    mod prod ved merge til main (.github/workflows/auto-migrate.yml, AGENTS.md
--    hard rule 9). Merge ER applikationen.
--    Migrationen er ikke-destruktiv: den rører én kolonne på aktive kontrakter
--    der er fortsat fra en tidligere sæson, og kan ikke kreditere penge af sig
--    selv — den åbner kun loftet, så den normale sweep kan udbetale bonusser
--    holdet har KØRT sig til. Idempotent: gentagne kørsler giver samme værdi.
--
-- Rollback (gendan kumulativt forbrug over kontraktens levetid):
--   UPDATE public.sponsor_contracts c SET results_bonus_paid = COALESCE((
--     SELECT SUM(f.amount) FROM public.finance_transactions f
--     WHERE f.team_id = c.team_id AND f.type = 'sponsor_result_bonus'), 0)
--   WHERE c.status = 'active';

UPDATE public.sponsor_contracts c
SET results_bonus_paid = COALESCE((
  SELECT SUM(f.amount)
  FROM public.finance_transactions f
  WHERE f.team_id = c.team_id
    AND f.type = 'sponsor_result_bonus'
    AND f.season_id = (SELECT id FROM public.seasons WHERE status = 'active' LIMIT 1)
), 0)
WHERE c.status = 'active'
  -- Kun kontrakter der reelt har krydset en sæsongrænse. En kontrakt der
  -- startede i den aktive sæson har per definition kun forbrug fra den sæson,
  -- og skal ikke røres.
  AND c.start_season < (SELECT number FROM public.seasons WHERE status = 'active' LIMIT 1)
  AND c.results_bonus_paid > 0;

-- Post-verify: ingen aktiv kontrakt må bære forbrug fra en tidligere sæson.
-- Kaster hvis oprydningen ikke er komplet, så en halv-anvendt migration ikke
-- rapporteres som grøn.
DO $$
DECLARE
  drifted INTEGER;
BEGIN
  SELECT COUNT(*) INTO drifted
  FROM public.sponsor_contracts c
  WHERE c.status = 'active'
    AND c.start_season < (SELECT number FROM public.seasons WHERE status = 'active' LIMIT 1)
    AND c.results_bonus_paid <> COALESCE((
      SELECT SUM(f.amount)
      FROM public.finance_transactions f
      WHERE f.team_id = c.team_id
        AND f.type = 'sponsor_result_bonus'
        AND f.season_id = (SELECT id FROM public.seasons WHERE status = 'active' LIMIT 1)
    ), 0);

  IF drifted > 0 THEN
    RAISE EXCEPTION '#4515: % aktive kontrakter bærer stadig forbrug fra en tidligere sæson', drifted;
  END IF;
END $$;
