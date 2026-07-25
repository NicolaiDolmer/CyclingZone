-- #2881 — Data-reparation: academy-promote() overskrev ubetinget en EKSISTERENDE
-- kontrakt (3 resterende sæsoner → 2 + ny løn), i strid med #1309-invarianten
-- ("eksisterende kontrakt arves uændret — regenerér ALDRIG"). Kode-fix i samme
-- PR (backend/lib/academyTransfer.js promote(): genbruger nu
-- contractOnAcquirePatch, samme gate som auktion/transfer/swap).
--
-- STATUS: IKKE KØRT — forberedt til ejer-review (jf. database/proposals/README.md
-- + .claude/learnings/2026-07-19-prepared-sql-auto-applied-footgun.md). Denne fil
-- ligger BEVIDST i database/proposals/, IKKE på database/2026-*.sql-topniveauet,
-- så auto-migrate.yml (som kun matcher `database/2026-*.sql` via `find -maxdepth 1`)
-- IKKE plukker den op ved merge. Flyt til database/-topniveau i en SEPARAT PR
-- FØRST når ejeren har godkendt reparationsreglen nedenfor.
--
-- ─── Kvantificering (read-only mod prod 25/7, se PR-beskrivelse for fuld SQL) ───
--
-- Eneste audit-spor: notifications (type='academy_promoted', related_id=rider_id).
-- academy_graduation.status='promoted' gav 0 rækker (promote() har typisk ingen
-- pending grad-row at resolve — matcher kodekommentaren) og er derfor IKKE et
-- selvstændigt signal her. RESIDUAL RISIKO: hvis notifyTeamOwner() nogensinde
-- fejlede EFTER riders-update'en committede (fire-and-forget, ingen transaktion
-- på tværs af Supabase-kald), ville den promotion mangle en notifikation og
-- IKKE tælles her — ingen uafhængigt sekundært logspor findes til at udelukke
-- dette. Ingen tegn på det er fundet (0 forældreløse academy_graduation-rækker).
--
--   97 distinct ryttere har mindst én 'academy_promoted'-notifikation siden
--      launch (tidligste 2026-06-26, seneste 2026-07-25 — hele vinduet er
--      sæson 1, som har været aktiv uafbrudt siden 2026-06-22; seasonNumber
--      var altså ALTID 1 ved hver promote()-kørsel).
--   ├─  48 → is_academy=false, team-ejet, contract_length=2 OG
--   │       contract_end_season=2 (den utvetydige bug-signatur: en akademi-
--   │       kontrakt er ALTID 3 sæsoner ved indtræden — ACADEMY.CONTRACT_LENGTH,
--   │       hardcoded i både demote_rider_to_academy-RPC'en og
--   │       finalize_academy_acquisition-RPC'en — kontraktforlængelse (#1720)
--   │       kan kun ØGE længden, aldrig give 2 tilbage. 2/2 kan derfor KUN
--   │       stamme fra den nu-rettede promote()-bug). Alle 48 er ægte
--   │       menneskehold (0 AI/bank/frosne/test-konti). ← DENNE migration.
--   ├─  24 → nu contract_length=3/contract_end_season=3: selv-korrigeret via
--   │       PRÆCIS ét efterfølgende #1720-forlængelses-klik (2→3/2→3), som
--   │       tilfældigvis lander på samme tal som den oprindelige akademi-
--   │       kontrakt ville have givet. INGEN kontrakt-defekt tilbage i dag —
--   │       IKKE rørt. (Løn kan stadig afvige fra hvad en aldrig-bugget
--   │       forlængelse ville have givet, men det er ikke rekonstruerbart,
--   │       se lønafsnittet nedenfor.)
--   ├─   5 → contract_length=3 (loft), contract_end_season 14-19: langt forbi
--   │       bug-vinduet (mange efterfølgende forlængelser) — IKKE rørt.
--   ├─  17 → is_academy=true igen i dag (demote_rider_to_academy har SIDEN
--   │       overskrevet kontrakten uafhængigt af promote-bugget) — IKKE rørt.
--   └─   3 → team_id IS NULL i dag (frigivet/solgt siden) — IKKE rørt.
--
-- ─── Løn: IKKE rekonstruerbar, IKKE rørt ────────────────────────────────────────
--
-- Den gamle buggede kode gen-beregnede OGSÅ salary (computeFrozenSalary ud fra
-- current_production_value PÅ PROMOTE-TIDSPUNKTET). Den korrekte adfærd
-- (contractOnAcquirePatch-gaten) ville have bevaret akademi-lønnen som den var
-- LIGE FØR promote() — men den værdi blev overskrevet i samme UPDATE og findes
-- IKKE i noget logspor (ingen kolonne-historik på riders.salary; notifications
-- .metadata gemmer kun rytter-navn, ikke beløb). At "gætte" en løn ud fra
-- current_production_value I DAG ville bruge ugyldig senere progression og
-- risikere at gøre det VÆRRE end at lade den stå. Discord-rapporten (thelamba)
-- klagede specifikt over sæson-tallet, ikke lønnen. Beslutning: salary røres
-- IKKE af denne reparation — ejeren kan vælge at leve med den, hvis ejeren vil
-- undersøge enkeltsager separat.
--
-- ─── Reparationsregel (deterministisk, kun de 48) ──────────────────────────────
--
--   contract_length      → 3   (ACADEMY.CONTRACT_LENGTH, konstant, ingen seed-varians)
--   contract_end_season  → 3   (computeContractEndSeason(1, 3) — sæson var ALTID 1
--                                ved hver af disse 48 promote()-kald, jf. seasons-
--                                tabellen: sæson 1 aktiv uafbrudt 2026-06-22 → nu)
--
-- IDEMPOTENT: WHERE-prædikatet (contract_length=2 AND contract_end_season=2 AND
-- promo-notifikation findes) rammer 0 rækker efter første succesfulde kørsel.
--
-- Rollback: backup_academy_promotion_contract_fix_20260725 (oprettet af denne
-- fil, FØR UPDATE) har før-værdierne for salary/contract_length/
-- contract_end_season pr. rytter-id — brug den til at reversere om nødvendigt.
--
-- #2744-kollision (rytterkontrakt-udløb → fri-agent ved sæsonskifte, endnu IKKE
-- bygget): disse 48 riders har i dag contract_end_season=2, IKKE 1 — de ville
-- IKKE blive fejlagtigt frigivet ved S1→S2-cutover søndag 26/7 (frigivelse
-- trigger'er kun på end_season <= afsluttet sæson). Risikoen materialiserer sig
-- FØRST ved S2→S3-skiftet, når #2744 er bygget og disse rytteres kontrakt
-- fejlagtigt udløber 1 sæson for tidligt, medmindre denne reparation er kørt
-- inden da.

-- ─── Backup (før-værdier, til evt. rollback) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS backup_academy_promotion_contract_fix_20260725 (
  rider_id UUID PRIMARY KEY,
  team_id UUID,
  salary INTEGER,
  contract_length INTEGER,
  contract_end_season INTEGER,
  backed_up_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO backup_academy_promotion_contract_fix_20260725
  (rider_id, team_id, salary, contract_length, contract_end_season)
SELECT r.id, r.team_id, r.salary, r.contract_length, r.contract_end_season
FROM riders r
WHERE r.is_academy = false
  AND r.team_id IS NOT NULL
  AND r.contract_length = 2
  AND r.contract_end_season = 2
  AND EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.type = 'academy_promoted' AND n.related_id = r.id
  )
ON CONFLICT (rider_id) DO NOTHING;

BEGIN;

UPDATE riders r
SET contract_length = 3,
    contract_end_season = 3
WHERE r.is_academy = false
  AND r.team_id IS NOT NULL
  AND r.contract_length = 2
  AND r.contract_end_season = 2
  AND EXISTS (
    SELECT 1 FROM notifications n
    WHERE n.type = 'academy_promoted' AND n.related_id = r.id
  );

COMMIT;

-- =============================================================================
-- Post-verify (kør manuelt før og efter — forventede tal ovenfor)
-- =============================================================================
--
-- 1) 0 tilbage med bug-signaturen (den kontraktuelle invariant, #1309/#2881):
--    SELECT count(*) FROM riders r
--    WHERE r.is_academy = false AND r.team_id IS NOT NULL
--      AND r.contract_length = 2 AND r.contract_end_season = 2
--      AND EXISTS (SELECT 1 FROM notifications n
--                  WHERE n.type = 'academy_promoted' AND n.related_id = r.id);
--    → forventet: 0
--
-- 2) Backup-tabellen har præcis 48 rækker (matcher kvantificeringen ovenfor):
--    SELECT count(*) FROM backup_academy_promotion_contract_fix_20260725;
--    → forventet: 48
--
-- 3) Ingen util­sigtet sideeffekt på de 24/5/17/3 EKSKLUDEREDE grupper (salary
--    OG kontraktfelter uændret — kør igen efter migration, sammenlign mod
--    kvantificeringen ovenfor):
--    SELECT r.contract_length, r.contract_end_season, count(*)
--    FROM (SELECT DISTINCT related_id AS rider_id FROM notifications
--          WHERE type = 'academy_promoted') pe
--    JOIN riders r ON r.id = pe.rider_id
--    WHERE r.is_academy = false AND r.team_id IS NOT NULL
--    GROUP BY r.contract_length, r.contract_end_season
--    ORDER BY 1, 2;
--    → forventet: samme fordeling som før, MINUS 2/2-rækken (nu 0), PLUS 48
--      flere i 3/3-rækken (24 + 48 = 72).
