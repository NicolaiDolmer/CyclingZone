-- database/2026-08-03-new-account-gates.sql
-- #3134 (fair-play epic #3131, track C) — ung-konto-spærrer: seed app_config-
-- nøglerne for tre server-side gates. Idempotent (INSERT ... ON CONFLICT DO
-- NOTHING). ALLE fem ships DEFAULT OFF/0 — se PR #3134 for dry-run-tal pr. spor.
--
-- 1) Lånespærre: intet manager-initieret lån før holdet har kørt
--    loan_gate_min_race_days ELLER er loan_gate_min_account_age_days dage
--    gammelt (OR — erfarings-gate, ikke ren tidsgate). 0/0 = ingen gate.
--    Håndhæves i backend/lib/loanEngine.js (createLoan).
--
-- 2) Cooldown på store udgående transfers/swaps: en betaling >=
--    transfer_cooldown_amount_czk blokeres de første transfer_cooldown_hours
--    timer efter kontoens oprettelse. 0 på enten nøgle = ingen gate.
--    Håndhæves i backend/lib/transferExecution.js (executeTransferOffer/
--    executeSwapOffer — det ENESTE sted penge rent faktisk flyttes for begge
--    handelstyper, uanset hvilken route der udløste bekræftelsen).
--
-- 3) Auktions-spærre: en konto oprettet EFTER at en auktion er startet kan
--    ikke byde (manuelt eller via autobud/proxy) på netop DEN auktion.
--    Håndhæves i backend/routes/api.js (POST /auctions/:id/bid + PATCH
--    /auctions/:id/proxy).
--
--    VIGTIGT — afviger fra issue-teksten (som foreslog default ON): en
--    read-only dry-run mod prod (ghwvkxzhsbbltzfnuhhz, hele auction_bids-
--    historikken) fandt 422 historiske bud fra 53 distinkte ægte hold der
--    ville være blevet blokeret af denne regel. Stikprøve af de tidligste
--    (mindre end 2 timer gamle konti) viser overvejende helt almindelig
--    onboarding — en helt ny spiller der browser en allerede kørende auktion
--    og byder minutter efter oprettelse, ofte for beskedne beløb (ned til
--    1.000-90.000 CZ$), holdene er stadig aktive i dag. Det er IKKE #2776-
--    mønsteret (en konto der snipe-byder højt og straks funnel'er værdien
--    videre). Ejeren bør se stikprøven før flip — se PR #3134-beskrivelsen.
--
-- Flip til live (eksempel-værdier, juster efter ejer-beslutning):
--   UPDATE app_config SET value='2'::jsonb   WHERE key='loan_gate_min_race_days';
--   UPDATE app_config SET value='2'::jsonb   WHERE key='loan_gate_min_account_age_days';
--   UPDATE app_config SET value='24'::jsonb  WHERE key='transfer_cooldown_hours';
--   UPDATE app_config SET value='100000'::jsonb WHERE key='transfer_cooldown_amount_czk';
--   UPDATE app_config SET value='true'::jsonb WHERE key='auction_entry_gate_enabled';

INSERT INTO public.app_config (key, value, description)
VALUES
  ('loan_gate_min_race_days', '0'::jsonb,
    '#3134 fair-play: minimum antal DISTINKTE completed løbsdage et hold selv har kørt før et manager-initieret lån tillades (OR med loan_gate_min_account_age_days). 0 = ingen race-dage-krav. Håndhæves i loanEngine.createLoan.'),
  ('loan_gate_min_account_age_days', '0'::jsonb,
    '#3134 fair-play: minimum holdalder i dage før et manager-initieret lån tillades (OR med loan_gate_min_race_days). 0 = ingen alders-krav. Begge 0 = lånespærren er helt slået fra. Håndhæves i loanEngine.createLoan.'),
  ('transfer_cooldown_hours', '0'::jsonb,
    '#3134 fair-play: antal timer efter kontooprettelse hvor udgående transfer-/swap-betalinger over transfer_cooldown_amount_czk blokeres. 0 = ingen cooldown. Håndhæves i transferExecution.executeTransferOffer/executeSwapOffer.'),
  ('transfer_cooldown_amount_czk', '0'::jsonb,
    '#3134 fair-play: beløbstærskel (CZ$) for transfer_cooldown_hours-cooldownen. 0 = ingen cooldown (uanset transfer_cooldown_hours). Håndhæves i transferExecution.js.'),
  ('auction_entry_gate_enabled', 'false'::jsonb,
    '#3134 fair-play: blokerer en konto fra at byde (manuelt eller via autobud) på en auktion der startede FØR kontoen blev oprettet — det præcise #2776-angreb. DEFAULT false: dry-run mod prod fandt 422 historiske bud fra 53 ægte hold der ville være blokeret, overvejende almindelig onboarding. Se PR #3134 før flip. Håndhæves i api.js (POST /auctions/:id/bid + PATCH /auctions/:id/proxy).')
ON CONFLICT (key) DO NOTHING;
