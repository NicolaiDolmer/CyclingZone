-- #4482 · Engangs-oprydning: udløb lag 6-bonustilbud fra AFSLUTTEDE sæsoner.
--
-- KØRES IKKE AUTOMATISK. Ejer-beslutning 31/8 (valg A: ryd op). Kræver at
-- spillerne har fået besked FØR kørslen, ikke efter — 36 hold mister en
-- mulighed de har i dag.
--
-- Fremadrettet lukkes hullet af `board_bonus_offer_expiry` i
-- seasonStartHooks.js, som udløber tilbud ved hvert sæsonskifte. Dette script
-- rydder kun op i det der nåede at hobe sig op, mens mekanikken var uwiret.
--
-- MÅLT I PROD 31/8 (skal give samme tal ved kørsel — ellers STOP og undersøg):
--   lag 6 · status=active · sæson 1 (completed) ....... 11
--   lag 6 · status=active · sæson 2 (completed) ....... 25
--   I ALT .............................................. 36
--   (issue #4482 skrev 37 kl. 00:55; ét tilbud er accepteret eller afvist
--    siden. Afvigelsen er forventet og harmløs — scriptet rammer kun det
--    der stadig er 'active' på kørselstidspunktet.)
--
-- SIKKERHED:
--   · Rører KUN layer = 6. Lag 5 (sponsor-exit) har sin egen udløbs-sti i
--     economyEngine EFTER sponsorudbetalingen; udløbes den her, annulleres en
--     straf i stilhed. Lag 2/3/4 har expires_at_season_id = NULL og rammes
--     ikke af WHERE-klausulen uanset.
--   · Rører KUN sæsoner med status = 'completed'. Den aktive sæsons tilbud
--     skal fortsat kunne indløses.
--   · Idempotent: anden kørsel opdaterer 0 rækker (status er ikke længere
--     'active').
--   · Ingen sletning. Rækkerne bevares med status 'expired' + resolved_at,
--     så historikken og et evt. rul-tilbage er intakt.

BEGIN;

-- Kontrol FØR: se præcis hvad der rammes. Læs outputtet før du fortsætter.
SELECT s.number AS saeson, count(*) AS rammes
FROM board_consequences bc
JOIN seasons s ON s.id = bc.expires_at_season_id
WHERE bc.layer = 6
  AND bc.status = 'active'
  AND s.status = 'completed'
GROUP BY s.number
ORDER BY s.number;

UPDATE board_consequences bc
SET status = 'expired',
    resolved_at = now()
FROM seasons s
WHERE s.id = bc.expires_at_season_id
  AND bc.layer = 6
  AND bc.status = 'active'
  AND s.status = 'completed';

-- Kontrol EFTER: skal give 0 rækker.
SELECT count(*) AS tilbage_aktive_paa_afsluttet_saeson
FROM board_consequences bc
JOIN seasons s ON s.id = bc.expires_at_season_id
WHERE bc.layer = 6
  AND bc.status = 'active'
  AND s.status = 'completed';

-- Kontrol: den AKTIVE sæsons tilbud skal være urørte.
SELECT count(*) AS aktive_paa_aktiv_saeson_skal_vaere_uroert
FROM board_consequences bc
JOIN seasons s ON s.id = bc.expires_at_season_id
WHERE bc.layer = 6
  AND bc.status = 'active'
  AND s.status = 'active';

-- Kontrol: ingen lag 5 er rørt.
SELECT count(*) AS aktive_lag5_skal_vaere_uaendret
FROM board_consequences
WHERE layer = 5 AND status = 'active';

COMMIT;
