-- Løbsdagens intention (#4632) — udvid race_stage_roles.effort fra 3 til 5 trin.
--
-- Ejer-beslutning 5-6/9 (beslutningsoplæg:
-- docs/superpowers/specs/2026-09-03-race-day-intention-decision.md — beslutning
-- 1 = model C, beslutning 2 = A "samme felt"):
--   · Intentionen vælges pr. etape og er en udvidelse af det EKSISTERENDE
--     effort-felt, ikke en ny akse/kolonne/tabel.
--   · De tre gamle værdier beholder BÅDE navn og semantik ('save' og 'protect'
--     omdøbes IKKE til 'conserve'/'committed' som oplæggets §6 punkt 1 foreslog
--     — ejeren valgte den navne-bevarende variant, så eksisterende rækker og al
--     eksisterende kode er upåvirkede).
--   · Skala (letteste → hårdeste): grupetto < save < normal < protect < all_out.
--
-- INGEN DATA-MIGRATION. Ingen eksisterende række ændres: de tre gamle værdier er
-- fortsat gyldige og betyder det samme. Denne fil UDVIDER kun det tilladte sæt.
--
-- API'et accepterer først 'grupetto'/'all_out' når app_config-flaget
-- `race_day_intention_enabled` er 'on' (backend/lib/raceIntentionFlag.js +
-- raceRoles.validEffortsFor). DB-constraint'en er med vilje bredere end API'et:
-- constrainten er det permanente vokabular, flaget er launch-switchen. Så længe
-- flaget er off findes der ingen skrivevej til de to nye værdier, og motoren er
-- bit-identisk med i dag.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + navngivet ADD CONSTRAINT (samme
-- mønster som race_entries_race_role_check i 2026-07-12-race-v3-s1-work-cost.sql,
-- jf. scripts/lint-migration-idempotency.mjs). Re-run = no-op.
--
-- Applies af CI ved merge (.github/workflows/auto-migrate.yml). Ingen agent har
-- kørt SQL mod prod for denne fil.

-- ── 1) effort-CHECK: 3 → 5 værdier ───────────────────────────────────────────
-- Den oprindelige CHECK blev født som en INLINE column-CHECK i
-- 2026-07-12-race-v3-s1-work-cost.sql:40 (CREATE TABLE public.race_stage_roles).
-- Postgres' standard-navngivning for den er '<tabel>_<kolonne>_check' →
-- 'race_stage_roles_effort_check', hvilket er præcis det navn vi genskaber med.
ALTER TABLE public.race_stage_roles
  DROP CONSTRAINT IF EXISTS race_stage_roles_effort_check;

ALTER TABLE public.race_stage_roles
  ADD CONSTRAINT race_stage_roles_effort_check
    CHECK (effort IN ('grupetto', 'save', 'normal', 'protect', 'all_out'));

-- DEFAULT 'normal' er UÆNDRET (sat i S1-migrationen) — "ikke valgt" = rollens
-- standard = normal, jf. ejer-beslutningen 5-6/9.

COMMENT ON COLUMN public.race_stage_roles.effort IS
  '#2034/#4632: løbsdagens intention pr. (løb, etape, rytter). Fem trin, letteste → hårdeste: grupetto < save < normal < protect < all_out. Default normal ("ikke valgt" = rollens standard). De tre midterste er de oprindelige S3-værdier, uændret semantik. grupetto/all_out accepteres først af API''et når app_config.race_day_intention_enabled er on (#4632).';

-- ── Post-verify (KØR MANUELT efter merge; ingen del af migrationen) ──────────
--
-- 1) Constrainten har den nye form (forventet: én række med alle fem værdier):
--
--    SELECT conname, pg_get_constraintdef(oid) AS def
--      FROM pg_constraint
--     WHERE conrelid = 'public.race_stage_roles'::regclass
--       AND conname  = 'race_stage_roles_effort_check';
--
--    Forventet def:
--      CHECK ((effort = ANY (ARRAY['grupetto'::text, 'save'::text,
--             'normal'::text, 'protect'::text, 'all_out'::text])))
--
-- 2) Ingen eksisterende række har flyttet sig (fordelingen skal være IDENTISK
--    før og efter — kun tre værdier kan optræde indtil flaget flippes):
--
--    SELECT effort, count(*) FROM public.race_stage_roles GROUP BY 1 ORDER BY 1;
--
--    Forventet: kun 'protect'/'normal'/'save' i rækkerne, samme tal som før.
--
-- 3) Constrainten tillader faktisk de to nye (rul tilbage — MÅ IKKE COMMITTES):
--
--    BEGIN;
--      INSERT INTO public.race_stage_roles (race_id, stage_number, rider_id, race_role, effort)
--      SELECT race_id, 999, rider_id, 'helper', 'all_out'
--        FROM public.race_stage_roles LIMIT 1;
--    ROLLBACK;
--
--    Forventet: INSERT lykkes (ingen 23514), ROLLBACK efterlader intet.
--
-- 4) Flaget er stadig off (der må IKKE indsættes en row her — ejeren flipper
--    selv efter dry-run-scorecardet, spec §7 punkt 6):
--
--    SELECT key, value FROM public.app_config WHERE key = 'race_day_intention_enabled';
--
--    Forventet: 0 rækker (fravær = off, fail-safe i featureStage.js).
