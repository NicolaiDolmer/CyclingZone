-- #5268 — Holdarbejde (teamwork) + Lederskab (leadership) som rigtige evner.
-- ============================================================================
-- Spec:  docs/superpowers/specs/2026-09-15-holdarbejde-og-lederskab-evner-design.md §3.1, §4 trin 1-2
-- Måling: docs/audits/2026-09-15-3668-ability-scale-investigation.md §4.3, §5
-- Issues: #5268 #3668 #1177
--
-- ── HVAD DEN GØR OG HVAD DEN BEVIDST IKKE GØR ───────────────────────────────
-- DENNE FIL ER REN ADDITIV DDL: to kolonner, deres grants, en tom backup-tabel
-- og en skema-reload. Den flytter IKKE ét evne-point.
--
-- Selve POINT-FLYTNINGEN (taktik/aggression sænkes, de tabte point flyttes til
-- de to nye evner) ligger i `backend/scripts/dry-run-5268-mental-abilities.js`,
-- IKKE her. Det er et bevidst valg, ikke en forglemmelse:
--   1. Migrationen køres automatisk af auto-migrate.yml ved merge (#2642). En
--      data-mutation der rører 8.160 ryttere må ikke kunne ske som en bivirkning
--      af en merge — ejeren har låst den bag et eget go-kort med spillerbesked.
--   2. En SQL-migration kan ikke dry-runnes. Node-scriptet kan: `--dry-run` er
--      default og læser kun, og det rapporterer to varianter side om side FØR
--      nogen beslutter hvilken der køres.
--   3. Beregningen skal bruge den SAMME `deriveAbilities()` som backenden. En
--      SQL-kopi af formlen (som udkastet i rapportens §5.3) er en anden kilde
--      til sandhed, og den ville drive fra JS'en ved første kalibrering.
--
-- Rækkefølgen er derfor: denne migration + backend-deploy → ejer-go-kort →
-- Node-scriptet med `--apply --owner-go` → post-verify → spillerbesked.
--
-- ── HVORFOR KOLONNERNE KAN KOMME FØR POINT-FLYTNINGEN ───────────────────────
-- `deriveAbilities()` skriver fra dag ét et `teamwork`/`leadership`-tal for
-- enhver rytter den rører (ny rytter, akademi-optag, re-derive-sweep). Uden
-- kolonnerne ville de skrivninger fejle. Kolonnerne skal derfor eksistere FØR
-- backenden deployer, og de er nullable: de 8.160 eksisterende ryttere står med
-- NULL indtil point-flytningen køres, og en NULL evne tæller hverken i
-- `ratingForRole()` (tæller og nævner springer den over) eller i træningen.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--   ALTER TABLE public.rider_derived_abilities DROP COLUMN IF EXISTS teamwork;
--   ALTER TABLE public.rider_derived_abilities DROP COLUMN IF EXISTS leadership;
--   DROP TABLE IF EXISTS public.rider_derived_abilities_5268_backup;
--   NOTIFY pgrst, 'reload schema';
-- Backenden skal rulles tilbage FØRST — ellers genskaber næste derivation
-- skrivninger mod kolonner der ikke findes.

-- ── 1) De to kolonner ───────────────────────────────────────────────────────
-- smallint som de 15 øvrige evne-kolonner. Nullable med vilje (se ovenfor);
-- ingen DEFAULT, fordi en default ville lyve: 0 er ikke "endnu ikke beregnet".
ALTER TABLE public.rider_derived_abilities
  ADD COLUMN IF NOT EXISTS teamwork smallint,
  ADD COLUMN IF NOT EXISTS leadership smallint;

-- ── 2) Kolonne-grants (riders-column-grant-guard, #2241/#2238) ──────────────
-- `rider_derived_abilities` bruger IKKE tabel-niveau SELECT: #1162 revokede den
-- og gen-grantede kolonne for kolonne for at holde `hidden_potential` ude af
-- scouting-orakler. En ny kolonne arver INTET. Uden denne grant 403'er
-- PostgREST hele forespørgslen (ikke kun kolonnen) og kan blanke en hel side.
-- De to nye evner er lige så offentlige som de 15 andre: `anon` ser dem på
-- rytterprofiler uden login, præcis som `tactics`.
GRANT SELECT (teamwork, leadership)
  ON public.rider_derived_abilities TO anon, authenticated;

COMMENT ON COLUMN public.rider_derived_abilities.teamwork IS
  '#5268: Holdarbejde 1-99 (mental). Hvor meget en hjælper er værd for sin kaptajn. '
  'DATA-ONLY indtil motor-flaget teamwork_in_engine tændes. NULL = endnu ikke beregnet.';
COMMENT ON COLUMN public.rider_derived_abilities.leadership IS
  '#5268: Lederskab 1-99 (mental). Virker kun i truppen (mentorpar), aldrig i løbet. '
  'DATA-ONLY indtil mentor_pairs_enabled tændes. NULL = endnu ikke beregnet.';

-- ── 3) Backup-tabellen til point-flytningen ─────────────────────────────────
-- Skabelonen ligger HER så rollback-stien findes før mutationen gør, og så
-- Node-scriptet ikke behøver DDL-rettigheder for at kunne køre `--apply`.
-- Tabellen er TOM efter denne migration; scriptet fylder den i ét INSERT ...
-- SELECT lige før det skriver, og `variant`/`applied_at` gør det entydigt HVILKEN
-- kørsel en række hører til, hvis der nogensinde køres to.
--
-- Rapportens §5.4: rollback er komplet så længe tabellen står, og den må først
-- droppes når en hel sæson er kørt uden indsigelser.
CREATE TABLE IF NOT EXISTS public.rider_derived_abilities_5268_backup (
  rider_id        uuid PRIMARY KEY,
  old_tactics     smallint,
  old_aggression  smallint,
  old_teamwork    smallint,
  old_leadership  smallint,
  variant         text,
  applied_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rider_derived_abilities_5268_backup IS
  '#5268: før-billede af de fire mentale evner, skrevet af '
  'backend/scripts/dry-run-5268-mental-abilities.js --apply --owner-go. '
  'Rollback: UPDATE rider_derived_abilities FROM denne tabel. Drop først efter en hel sæson uden indsigelser.';

-- Ingen RLS, ingen grants: backup-tabellen er ren service-role-ops-data. En ny
-- tabel får som udgangspunkt SELECT til authenticated via default-privilegier
-- (2026-08-14-2830), og det ville lække et før-billede af hver rytters evner til
-- enhver bruger. Vi lukker den eksplicit i stedet for at stole på at ingen kigger.
ALTER TABLE public.rider_derived_abilities_5268_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rider_derived_abilities_5268_backup FROM anon, authenticated;

-- ── 4) PostgREST skema-cache ────────────────────────────────────────────────
-- Sidst, som altid: uden den ser API'et ikke de nye kolonner før næste genstart,
-- og frontendens select ville 400'e på en kolonne der findes i databasen.
NOTIFY pgrst, 'reload schema';
