-- Forhindrer to samtidige aktive transfer_listings på samme rytter på DB-niveau.
--
-- Bug #247: liam_99520 rapporterede 2026-05-09 at samme rytter kunne sættes til
-- salg flere gange m. forskellige priser. Observeret i prod hvor team
-- 80ee8b58-d59e-45a4-872b-dd58f8da909e havde rider 4392d070 åbent listet som
-- både 75K og 50K samtidigt (oprettet ~30 sek apart).
--
-- POST /api/transfers manglede både SELECT-pre-check og DB-constraint, til
-- forskel fra POST /api/auctions der har begge dele (uniq_auctions_one_active_per_rider).
--
-- Den unique partial index gør det fysisk umuligt at have mere end én row
-- per rider i aktiv status. Ved race fejler den anden INSERT med 23505
-- (unique_violation) som backend mapper til 409 ligesom auction-flowet.
--
-- 'negotiating' inkluderes så manageren ikke kan oprette en parallel listing
-- mens et eksisterende offer er under forhandling — det matcher brugerens
-- intent ("Maks ÉN aktiv 'til salg'-listing pr. rytter").
--
-- Rydning: 0 active dupes pr. 2026-05-10 (verificeret via SELECT GROUP BY
-- HAVING COUNT > 1) efter #270-fix gjorde fjern-knappen funktionel og en
-- bruger ryddede den ene observerede dublet manuelt. Index-oprettelsen
-- løber direkte uden conflict.
--
-- Idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_transfer_listings_one_active_per_rider
  ON transfer_listings(rider_id)
  WHERE status IN ('open', 'negotiating');
