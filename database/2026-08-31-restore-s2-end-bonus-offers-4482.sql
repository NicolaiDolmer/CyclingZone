-- #4482 · Datareparation: genskab de 21 sæson-slut-bonustilbud fra S2.
--
-- KØRES AUTOMATISK af auto-migrate ved merge — det er meningen denne gang.
-- Ejer-beslutning 31/8 (Regel A): et lag 6-tilbud optjent ved SÆSON-SLUT-
-- evalueringen kan indløses i hele den FØLGENDE sæson.
--
-- Baggrund: oprydnings-scriptet 2026-08-31-expire-stale-bonus-offers-4482.sql
-- var markeret som manuel-only men lå i auto-migrate-globben og blev
-- kørt af CI 31/8 kl. 17:43 — det udløb alle 36 gamle tilbud, også de 21 fra
-- S2-slut-evalueringen (skabt 23/8 = S2's sidste dag), som under Regel A
-- retmæssigt hører til i S3. De genskabes her og re-stemples til S3, så de
-- udløber korrekt ved S3's afslutning 27/9.
--
-- De øvrige 15 forbliver udløbet med rette under Regel A:
--   1 mid-S1-tilbud (skabt 26/6)  → skulle være udløbet ved S1-slut
--   10 S1-slut-tilbud (skabt 26/7) → kunne indløses i S2, udløbet ved S2-slut
--   4 mid-S2-tilbud (skabt 9/8)   → skulle være udløbet ved S2-slut
--
-- MÅLT I PROD 31/8 (kontrol FØR skal give 21 — ellers STOP og undersøg):
--   lag 6 · status=expired · resolved_at 31/8 17:43 · skabt 2026-08-23 · stemplet S2 ... 21
--
-- SIKKERHED:
--   · Rører KUN de rækker CI-uheldet udløb (resolved_at i 17:43-minuttet) og
--     KUN dem fra S2-slut-evalueringen (created_at 23/8, stemplet sæson 2).
--   · Re-stempler til sæson 3 (rækken findes; FK holder).
--   · Idempotent: anden kørsel finder 0 rækker (status er ikke længere 'expired').
--   · Unik-aktiv-forudsætning verificeret 31/8: 0 aktive lag 6-rækker i prod,
--     og de 21 hører til 21 forskellige hold.

BEGIN;

-- Kontrol FØR: skal give 21 rækker fordelt på 21 hold.
SELECT count(*) AS genskabes, count(DISTINCT bc.team_id) AS hold
FROM board_consequences bc
JOIN seasons s2 ON s2.id = bc.expires_at_season_id AND s2.number = 2
WHERE bc.layer = 6
  AND bc.status = 'expired'
  AND bc.resolved_at >= '2026-08-31T15:43:00Z' AND bc.resolved_at < '2026-08-31T15:44:00Z'
  AND bc.created_at::date = '2026-08-23';

UPDATE board_consequences bc
SET status = 'active',
    resolved_at = NULL,
    expires_at_season_id = (SELECT id FROM seasons WHERE number = 3)
FROM seasons s2
WHERE s2.id = bc.expires_at_season_id AND s2.number = 2
  AND bc.layer = 6
  AND bc.status = 'expired'
  AND bc.resolved_at >= '2026-08-31T15:43:00Z' AND bc.resolved_at < '2026-08-31T15:44:00Z'
  AND bc.created_at::date = '2026-08-23';

-- Kontrol EFTER: 21 aktive lag 6-tilbud stemplet sæson 3.
SELECT count(*) AS aktive_stemplet_s3
FROM board_consequences bc
JOIN seasons s3 ON s3.id = bc.expires_at_season_id AND s3.number = 3
WHERE bc.layer = 6 AND bc.status = 'active';

-- Kontrol: de 15 øvrige (1 mid-S1 + 10 S1-slut + 4 mid-S2) står stadig 'expired'.
SELECT count(*) AS stadig_udloebet_skal_vaere_15
FROM board_consequences bc
WHERE bc.layer = 6
  AND bc.status = 'expired'
  AND bc.resolved_at >= '2026-08-31T15:43:00Z' AND bc.resolved_at < '2026-08-31T15:44:00Z';

COMMIT;
