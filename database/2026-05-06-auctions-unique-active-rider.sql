-- Forhindrer to samtidige auktioner på samme rytter på DB-niveau.
--
-- Bug: POST /api/auctions (backend/routes/api.js) gør SELECT-then-INSERT for at
-- tjekke "no active auction for rider" — TOCTOU-race ved dobbeltklik betyder
-- begge requests består tjekket og INSERT'er hver sin row. Observeret 5. maj
-- 2026 hvor Soudal Quick-Step fik 3 auktioner på Gianni Moscon og 2 hver på
-- Silvan Dillier + Morné van Niekerk inden for sub-sekund vinduer.
--
-- Den unique partial index gør det fysisk umuligt at have mere end én row per
-- rider med status active/extended. Ved race fejler den anden INSERT med
-- 23505 (unique_violation) som backend mapper til 409 ligesom det
-- eksisterende SELECT-tjek.
--
-- Rydning af duplikater er kørt manuelt FØR denne migration (4 rows sat til
-- cancelled), så index-oprettelsen ikke fejler.
--
-- Idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_auctions_one_active_per_rider
  ON auctions(rider_id)
  WHERE status IN ('active', 'extended');
