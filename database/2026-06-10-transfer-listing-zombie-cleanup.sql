-- #776/#822: zombie-transfer-listings backfill.
--
-- Bug: auctionFinalization (vinder-path + guaranteed-sale til banken) og
-- squadEnforcement (auto-salg) flyttede rytteren til nyt hold uden at lukke
-- hans aktive transfer_listings. Resultat: rytteren stod fortsat som "til
-- salg" på transfermarkedet (status 'open'/'negotiating') selvom han var
-- solgt — og kunne i værste fald dobbelt-sælges via det åbne listing.
--
-- Koden lukker nu listings ved alle tre salgs-paths (status 'sold' via
-- closeTransferListingsForRiders i marketUtils.js). Denne backfill rydder de
-- eksisterende zombie-rækker: et aktivt listing hvor rytteren ikke længere
-- står på sælgerens hold er per definition forældet. Vi kan ikke retroaktivt
-- afgøre salgs-kanalen, så status sættes til 'withdrawn' (annulleret) frem
-- for 'sold'. Markedet viser kun status 'open', så begge værdier fjerner
-- rytteren fra "til salg"-listen.

UPDATE transfer_listings tl
SET status = 'withdrawn'
FROM riders r
WHERE tl.rider_id = r.id
  AND tl.status IN ('open', 'negotiating')
  AND (r.team_id IS DISTINCT FROM tl.seller_team_id);
