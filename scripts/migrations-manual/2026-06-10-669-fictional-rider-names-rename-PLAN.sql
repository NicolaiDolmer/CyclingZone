-- ═══════════════════════════════════════════════════════════════════════════
-- #669 — Fiktive rytter-navne: MIGRATIONS-PLAN (omdøb ALLE PCM-ryttere)
--
-- STATUS: PLAN — IKKE GODKENDT TIL KØRSEL. Kræver eksplicit ejer-go.
--
-- Denne fil ligger i scripts/migrations-manual/ NETOP fordi database/*.sql
-- auto-applies mod prod ved merge. INTET i denne fil må køres automatisk.
-- Kørsel: manuelt, trin for trin, i psql/Supabase SQL editor — verificér
-- hvert tjek-resultat før du fortsætter.
--
-- Hvad planen gør:
--   • Omdøber alle ryttere med pcm_id IS NOT NULL (live 2026-06-10: 8.969)
--     til deterministisk genererede fiktive navne. Nationalitet, stats,
--     UUID'er, ejerskab, historik osv. røres IKKE — kun firstname/lastname.
--   • Originale navne bevares i backup-tabellen riders_pcm_name_backup_669
--     (RLS-låst, så PCM-navne ALDRIG eksponeres via API'et).
--   • Fuldt reversibel via ROLLBACK-sektionen nederst.
--
-- Hvorfor: IP-risiko — PCM-navne må ikke være player-facing ved relaunch
-- 20/6 (epic #1105, TDF_2026_LAUNCH_PLAN.md Spor C).
--
-- ⚠️ SEKVENSERING (ejer-beslutning før kørsel):
--   1. PCM-resultat-importen matcher på NAVN (backend/lib/pcmRiderMatcher.js).
--      Efter rename kan rå PCM-resultatfiler ikke længere matches direkte.
--      Kør derfor renamen VED relaunch-cutover (når PCM-import stopper), ELLER
--      udvid pcmRiderMatcher til at slå op i backup-tabellen
--      (gammelt navn → rider_id) som alias-fallback i PCM-fallback-vinduet.
--   2. Rækkefølge ift. #1103-launch-population: begge ordener er sikre, NÅR
--      input-ekstraktionen (TRIN 0) køres mod LIVE DB umiddelbart før apply —
--      så indgår alle eksisterende navne (også fiktive #1135-ryttere) i
--      kollisions-korpus.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIN 0 — Apply-time input + generering (lokalt, ingen DB-writes)
--
-- Dry-run/sample-review brugte den committede PCM-dump (8.699 ryttere).
-- Live-DB har FLERE PCM-ryttere (8.969 pr. 2026-06-10 — senere imports), så
-- det ENDELIGE input SKAL ekstraheres fra live-DB, ellers beholder op til
-- ~270 ryttere deres rigtige PCM-navne (IP-leak). Read-only ekstraktion:
--
--   \copy (SELECT pcm_id, nationality_code, firstname, lastname FROM riders WHERE pcm_id IS NOT NULL ORDER BY pcm_id) TO 'scripts/out/669-live-rider-input.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true)
--   \copy (SELECT firstname || ' ' || lastname FROM riders WHERE pcm_id IS NULL) TO 'scripts/out/669-extra-names.txt' WITH (FORMAT csv)
--
-- Generér derefter mapping + staging-SQL (deterministisk, seed gemmes i output):
--
--   node scripts/generate-fictional-rider-names.mjs \
--     --input scripts/out/669-live-rider-input.tsv \
--     --extra-names scripts/out/669-extra-names.txt \
--     --seed 669 \
--     --emit-sql scripts/out/669-fictional-names-staging.sql
--
-- Generatoren fejler hårdt ved enhver kollision/manglende nationalitet, så et
-- succesfuldt run ER verifikationen af navne-unikhed på JS-siden (foldNameNordic,
-- samme fold som resultat-importen). SQL-tjekkene nedenfor er bælte-og-seler.


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIN 1 — Backup-tabel (originale navne bevares; RLS-låst mod API-eksponering)

BEGIN;

CREATE TABLE IF NOT EXISTS riders_pcm_name_backup_669 (
  rider_id uuid PRIMARY KEY REFERENCES riders(id),
  pcm_id integer NOT NULL,
  original_firstname text NOT NULL,
  original_lastname text NOT NULL,
  nationality_code text,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

-- KRITISK: uden RLS er en ny public-tabel læsbar via PostgREST/anon —
-- og denne tabel indeholder netop de PCM-navne der ikke må eksponeres.
-- RLS uden policies = deny-all for anon/authenticated; service_role bypasser.
ALTER TABLE riders_pcm_name_backup_669 ENABLE ROW LEVEL SECURITY;

-- Tjek 1a: backup skal være tom før første kørsel (genkørsel = undersøg først).
SELECT count(*) AS backup_rows_expect_0 FROM riders_pcm_name_backup_669;


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIN 2 — Staging: kør den genererede fil scripts/out/669-fictional-names-staging.sql
-- (CREATE TABLE fictional_name_staging_669 + TRUNCATE + batched INSERTs).
-- Staging-tabellen indeholder kun NYE navne — ingen PCM-navne.

-- (kør staging-filen her)

ALTER TABLE IF EXISTS fictional_name_staging_669 ENABLE ROW LEVEL SECURITY;

-- Tjek 2a: staging-count == antal PCM-ryttere i live-DB.
SELECT
  (SELECT count(*) FROM fictional_name_staging_669) AS staging_rows,
  (SELECT count(*) FROM riders WHERE pcm_id IS NOT NULL) AS pcm_riders; -- skal være ens


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIN 3 — Pre-flight-verifikation (ALLE tjek skal give 0 rækker / forventet tal,
-- ellers ROLLBACK og undersøg)

-- Tjek 3a: dækning — ingen PCM-rytter uden ny-navn-række. FORVENTET: 0.
SELECT count(*) AS uncovered_pcm_riders_expect_0
FROM riders r
LEFT JOIN fictional_name_staging_669 s ON s.pcm_id = r.pcm_id
WHERE r.pcm_id IS NOT NULL AND s.pcm_id IS NULL;

-- Tjek 3b: forældreløse staging-rækker (rytter slettet siden ekstraktion).
-- FORVENTET: 0. >0 er OK at fortsætte med (de matches bare ikke), men notér det.
SELECT count(*) AS orphan_staging_rows
FROM fictional_name_staging_669 s
LEFT JOIN riders r ON r.pcm_id = s.pcm_id
WHERE r.pcm_id IS NULL;

-- Tjek 3c: ingen nye navne kolliderer (case-insensitivt) med navne på ryttere
-- der IKKE omdøbes (fiktive #1135-ryttere, pcm_id IS NULL). FORVENTET: 0.
-- (Generatoren garanterer dette via --extra-names; dette er bælte-og-seler.
-- JS-folden er strengere end lower() — accenter/ø/æ foldes også.)
SELECT count(*) AS collisions_with_unrenamed_expect_0
FROM fictional_name_staging_669 s
JOIN riders r ON r.pcm_id IS NULL
  AND lower(r.firstname || ' ' || r.lastname) = lower(s.new_firstname || ' ' || s.new_lastname);

-- Tjek 3d: interne duplikater i staging. FORVENTET: 0 rækker.
SELECT lower(new_firstname || ' ' || new_lastname) AS dup, count(*)
FROM fictional_name_staging_669
GROUP BY 1 HAVING count(*) > 1;


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIN 4 — Backup + rename (samme transaktion som trin 1-3)

INSERT INTO riders_pcm_name_backup_669
  (rider_id, pcm_id, original_firstname, original_lastname, nationality_code)
SELECT id, pcm_id, firstname, lastname, nationality_code
FROM riders
WHERE pcm_id IS NOT NULL;

-- Tjek 4a: backup-count == PCM-rytter-count.
SELECT count(*) AS backup_rows FROM riders_pcm_name_backup_669;

UPDATE riders r
SET firstname = s.new_firstname,
    lastname = s.new_lastname,
    updated_at = now()
FROM fictional_name_staging_669 s
WHERE r.pcm_id = s.pcm_id;
-- FORVENTET: UPDATE <pcm_riders fra tjek 2a>


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIN 5 — Post-verifikation (FØR commit)

-- Tjek 5a: ingen omdøbt rytter bærer stadig sit originale navn. FORVENTET: 0.
SELECT count(*) AS riders_still_with_original_name_expect_0
FROM riders r
JOIN riders_pcm_name_backup_669 b ON b.rider_id = r.id
WHERE r.firstname = b.original_firstname AND r.lastname = b.original_lastname;

-- Tjek 5b: globale fulde-navne-duplikater på tværs af HELE riders. FORVENTET: 0 rækker.
SELECT lower(firstname || ' ' || lastname) AS dup, count(*)
FROM riders
GROUP BY 1 HAVING count(*) > 1;

-- Tjek 5c: nationalitet uændret for alle omdøbte. FORVENTET: 0.
SELECT count(*) AS nationality_changed_expect_0
FROM riders r
JOIN riders_pcm_name_backup_669 b ON b.rider_id = r.id
WHERE r.nationality_code IS DISTINCT FROM b.nationality_code;

-- Alle tjek grønne → COMMIT. Ellers → ROLLBACK og undersøg.
COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- TRIN 6 — Oprydning (FØRST efter ejer-bekræftelse af at spillet ser rigtigt ud)

-- Staging kan droppes når som helst efter commit (reproducérbar fra seed+input):
--   DROP TABLE IF EXISTS fictional_name_staging_669;

-- Backup-tabellen BEHOLDES (reversibilitet + mulig alias-kilde for
-- pcmRiderMatcher i PCM-fallback-vinduet). Den er RLS-låst, så den
-- eksponerer intet. Evt. sletning er en separat ejer-beslutning efter TdF.


-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — fuld tilbagerulning (kan køres når som helst efter COMMIT,
-- så længe riders_pcm_name_backup_669 findes)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- BEGIN;
--
-- UPDATE riders r
-- SET firstname = b.original_firstname,
--     lastname = b.original_lastname,
--     updated_at = now()
-- FROM riders_pcm_name_backup_669 b
-- WHERE r.id = b.rider_id;
-- -- FORVENTET: UPDATE <backup_rows fra tjek 4a>
--
-- -- Verifikation: 0 ryttere afviger fra backup.
-- SELECT count(*) AS mismatches_expect_0
-- FROM riders r
-- JOIN riders_pcm_name_backup_669 b ON b.rider_id = r.id
-- WHERE r.firstname <> b.original_firstname OR r.lastname <> b.original_lastname;
--
-- COMMIT;
--
-- Bemærk: rollback genskaber navnene 1:1. Ryttere oprettet/slettet EFTER
-- renamen påvirkes ikke (joinen rammer kun backede-up rider_id'er).
