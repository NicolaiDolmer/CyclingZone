-- #4860/#4376: keep signing history separate from the division used to price
-- a newly activated contract. Existing active contracts are intentionally untouched.
ALTER TABLE public.sponsor_contracts
  ADD COLUMN IF NOT EXISTS activation_division INTEGER
  CHECK (activation_division BETWEEN 1 AND 4);

COMMENT ON COLUMN public.sponsor_contracts.activation_division IS
  'Division used for S4+ activation pricing and subsequent division adjustments; NULL uses legacy signed_division.';

NOTIFY pgrst, 'reload schema';
