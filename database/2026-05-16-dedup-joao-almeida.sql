-- Dedup duplicate "João Luis Almeida" (pcm_id 18428, born 2007-01-18) — Refs #252.
--
-- Reporter: friisisch (Discord, 2026-05-08). Confirmed by bobby2106 that one
-- of the two PT Almeidas is a data-import duplicate.
--
-- Investigation:
--   Row A: pcm_id 6088,  João Almeida,      born 1998-08-05, UCI 2906, popularity 78  ← real (UAE Team Emirates star)
--   Row B: pcm_id 18428, João Luis Almeida, born 2007-01-18, UCI 2906, popularity 0   ← duplicate
--
-- Telltale: identical UCI points (2906) on a U19 with popularity 0 is impossible
-- — points were copied from row A at import. No real young Almeida with that score.
--
-- Reference checks (run 2026-05-16, all green):
--   auctions=0, auction_bids=0, auction_proxy_bids=0, transfer_listings=0,
--   transfer_offers=0, rider_watchlist=0. Only rider_stat_history (3) and
--   rider_uci_history (2) reference it — pure seed data.
--
-- Action: mark is_retired = true so the rider disappears from market listings,
-- watchlist suggestions, and auction targeting (per 2026-05-11-rider-retirement
-- semantics). Keeps the row + history intact for forensics / potential undo.

UPDATE riders
SET is_retired = TRUE,
    updated_at = NOW()
WHERE pcm_id = 18428
  AND lastname = 'Almeida'
  AND firstname = 'João Luis'
  AND birthdate = '2007-01-18'
  AND is_retired = FALSE;
