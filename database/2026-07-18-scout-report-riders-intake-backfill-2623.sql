-- #2623 — Backfill-kandidat: historiske scout-rapport-ryttere der stadig er
-- usøgbare via et åbent ('offered') akademi-intake-tilbud.
--
-- STATUS: ⚠️ AUTO-APPLIED 2026-07-18 17:32:56Z — UTILSIGTET. Filen var "forberedt
-- til ejer-review, ikke kørt" (jf. #2644/#2623-opgaven), men blev committet som
-- database/2026-*.sql og dermed kørt af auto-migrate.yml ~3 min efter merge af
-- PR #2659. Effekt: 16 rækker → 'expired' UDEN 24h-auktion/#2648-kompensation
-- (heraf 3 tilbud under 7-dages-grænsen, 1-4 dage gamle). Ejerskabs-guarden
-- holdt (kun team-løse ryttere ramt). Postmortem:
-- .claude/learnings/2026-07-19-prepared-sql-auto-applied-footgun.md.
-- Fremadrettet: udkast-SQL hører til i database/proposals/ (uden for globben).
--
-- Kontekst (read-only prod-audit 2026-07-18, execute_sql mod ghwvkxzhsbbltzfnuhhz):
--   Alle 50 ryttere der nogensinde er lagt i en mission-shortlist
--   (scout_assignments.result.shortlist / top_rider_id, kind='mission',
--   status='completed') blev krydset mod riders + academy_intake:
--     - 16/50 er LIGE NU usøgbare via et åbent 'offered'-intake-tilbud
--       (team_id IS NULL, is_academy = false — samme betingelse som
--       is_offered_intake_rider(), database/2026-06-22-hide-intake-riders-
--       from-db.sql).
--     - 0/50 har pending_team_id sat (den anden "skjult"-klasse #2644
--       introducerer for spejder-rapporter — ingen ramte prod i dag).
--   (Tallet var 46 shortlistede/17 skjulte ved forrige audit 17/7 (#2611-PR'en);
--   50/20 tidligere i dag (før #2627 gik live); nu 50/16 efter #2627-udløbet
--   (intake_offer_expiry_enabled) blev tændt igen 18/7 — tallet FALDER naturligt.)
--
-- Aldersfordeling på de 16 (intake_created_at): 13 af dem er ALLEREDE ældre end
-- #2627's 7-dages udløbsgrænse (ældste 2026-06-29, ~19 dage) og bliver derfor
-- fanget af den NÆSTE kørsel af academyIntakeExpirySweep.js's daglige sweep
-- (kl. 22 CET, dagskvote 30/dag — rigeligt til 13 rækker). De resterende 3
-- (2026-07-15/07-17) krydser 7-dages-grænsen naturligt inden ~2026-07-24.
--
-- KONKLUSION: #2644-guarden i denne PR (backend/lib/scoutReportVisibility.js)
-- løser selve SYMPTOMET ("rytteren findes ikke" i en spejder-rapport) allerede —
-- den kører ved HVER visning og skjuler/viser dynamisk efter nutidig tilstand,
-- så en rapport aldrig kan pege på en skjult rytter, uanset om academy_intake-
-- rækken er resolved eller ej. Denne backfill er derfor IKKE nødvendig for at
-- lukke #2644/#2623's bug-symptom — men den ville accelerere at rytterne bliver
-- FULDT søgbare igen ude i resten af spillet (fx RidersPage), i stedet for at
-- vente på den daglige sweep. Ejeren kan vælge at køre den for at fremskynde,
-- eller lade #2627-sweepen resolve dem organisk (anbefalet — ingen manuel
-- prod-mutation nødvendig).
--
-- SIKKERHED (lærdom fra HÆNDELSEN 18/7, se academyIntakeExpirySweep.js's
-- kommentar + .claude/learnings/2026-07-18-intake-expiry-auctioned-owned-riders.md):
-- 'offered'-status ALENE er IKKE bevis for at rytteren er team-løs — der findes
-- FORÆLDEDE 'offered'-rækker hvis rytter siden er blevet ejet ad andre veje.
-- Derfor: UPDATE rammer KUN rækker hvor riders.team_id IS NULL OG
-- riders.pending_team_id IS NULL på udførelses-tidspunktet (samme ejerskabs-tjek
-- som #2648-fixet). Rækker der IKKE opfylder dette afstemmes IKKE af dette script
-- (overlades til academyIntakeReconcile/#1756-flowet, uændret).
--
-- Denne backfill sætter KUN academy_intake.status → 'expired' (frigiver
-- rytteren til søgning/marked) — den kører IKKE youthMarket.listRejectedAsYouthAuction
-- (ungdomsauktion-siden af den fulde sweep). Det er en bevidst indsnævring: formålet
-- er at accelerere SØGBARHED for de historiske scout-rapport-ryttere, ikke at
-- duplikere hele expiry-sweepens auktionsflow uden for kodesporet.
--
-- Idempotent: WHERE status = 'offered' — en gentagen kørsel rammer 0 rows næste
-- gang (allerede 'expired' matcher ikke filteret).

-- Verifikations-query (kør FØR + EFTER for at se effekten):
--   SELECT count(*) FROM academy_intake ai
--   JOIN riders r ON r.id = ai.rider_id
--   WHERE ai.status = 'offered' AND r.team_id IS NULL AND r.is_academy = false
--     AND ai.rider_id IN (
--       SELECT DISTINCT jsonb_array_elements_text(sa.result->'shortlist')::uuid
--       FROM scout_assignments sa
--       WHERE sa.kind = 'mission' AND sa.status = 'completed' AND sa.result ? 'shortlist'
--       UNION
--       SELECT DISTINCT (sa.result->>'top_rider_id')::uuid
--       FROM scout_assignments sa
--       WHERE sa.kind = 'mission' AND sa.status = 'completed'
--         AND sa.result ? 'top_rider_id' AND sa.result->>'top_rider_id' IS NOT NULL
--     );
--   -- Forventet FØR: 16. Forventet EFTER: 0 (eller lavere, hvis #2627-sweepen
--   -- allerede har resolved nogle af dem naturligt inden denne køres).

UPDATE academy_intake ai
SET status = 'expired', resolved_at = now()
FROM riders r
WHERE ai.rider_id = r.id
  AND ai.status = 'offered'
  AND r.team_id IS NULL
  AND r.pending_team_id IS NULL
  AND r.is_academy = false
  AND ai.rider_id IN (
    SELECT DISTINCT jsonb_array_elements_text(sa.result->'shortlist')::uuid
    FROM scout_assignments sa
    WHERE sa.kind = 'mission' AND sa.status = 'completed' AND sa.result ? 'shortlist'
    UNION
    SELECT DISTINCT (sa.result->>'top_rider_id')::uuid
    FROM scout_assignments sa
    WHERE sa.kind = 'mission' AND sa.status = 'completed'
      AND sa.result ? 'top_rider_id' AND sa.result->>'top_rider_id' IS NOT NULL
  );
