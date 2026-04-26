-- Tilføjer window_pending status til transfer_offers og swap_offers.
-- Brugt når begge parter bekræfter en handel mens transfervinduet er lukket.
-- Handlene gennemføres automatisk simultant ved transfervinduets åbning.

ALTER TABLE transfer_offers DROP CONSTRAINT transfer_offers_status_check;
ALTER TABLE transfer_offers ADD CONSTRAINT transfer_offers_status_check
  CHECK (status IN ('pending','accepted','rejected','countered','awaiting_confirmation','withdrawn','window_pending'));

ALTER TABLE swap_offers DROP CONSTRAINT swap_offers_status_check;
ALTER TABLE swap_offers ADD CONSTRAINT swap_offers_status_check
  CHECK (status IN ('pending','countered','awaiting_confirmation','accepted','rejected','withdrawn','window_pending'));
