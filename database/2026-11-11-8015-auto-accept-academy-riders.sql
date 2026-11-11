-- #8015 (ejer 11/11): auto-pris og auto-accept-auktion for ALLE egne ryttere,
-- også akademiryttere (U23/junior). Samme regel som #3650 (ejer 17/8): egne
-- akademiryttere må auktioneres og sælges direkte; rytteren graduerer atomisk
-- ved salget (auctionFinalization riderGraduatesOnSale / executeTransferOffer).
--
-- De tre auto-accept-RPC'er havde en forældet akademi-blokering. Migrationen
-- henter hver funktions NUVÆRENDE definition og fjerner kun den ene blok, så
-- den verificerede A7-/beta-logik (#7981, #7985) er uændret. Idempotent: en
-- funktion uden blokken springes over. Fejler hårdt, hvis blokken findes, men
-- ikke kan fjernes præcist.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE
  f record;
  def text;
  new_def text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('set_listing_auto_accept_price', 'start_auto_accept_auction', 'start_auto_accept_auction_bid')
  LOOP
    def := pg_get_functiondef(f.oid);
    IF position('rider_is_academy' IN def) = 0 THEN
      CONTINUE;
    END IF;
    new_def := regexp_replace(
      def,
      E'\\n[ ]*(--[^\\n]*akademirytter[^\\n]*\\n[ ]*)?IF coalesce\\((v_academy|r\\.is_academy), false\\) THEN\\n[ ]*RETURN jsonb_build_object\\(''status'', ''rider_is_academy''\\);\\n[ ]*END IF;',
      '',
      'g'
    );
    IF position('rider_is_academy' IN new_def) > 0 THEN
      RAISE EXCEPTION '#8015: akademi-blokeringen kunne ikke fjernes præcist fra %', f.proname;
    END IF;
    EXECUTE new_def;
  END LOOP;
END
$migration$;

COMMIT;
