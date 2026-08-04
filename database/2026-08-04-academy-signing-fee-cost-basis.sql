-- database/2026-08-04-academy-signing-fee-cost-basis.sql
-- #2793 — akademi-signing havde ingen persisteret kostbasis pr. rytter, så en
-- senere sale af en akademi-udviklet rytter kunne hverken vises som salg/profit
-- på akademisiden eller matches til en købspris i transfer-profit-panelet.
-- Fundet i docs/audits/2026-08-03-economy-audit-3198.md (fund #4).
--
-- Denne migration tilføjer KUN kolonnen + et best-effort backfill af eksisterende
-- rækker. Selve write-path-rettelsen (signAcademyCandidate persisterer nu
-- signing_fee direkte ved signing) og læse-side-rettelserne (academyPnl.js,
-- teamTransferHistory.js, transferProfit.js) er ren applikationskode, ikke i
-- denne fil.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + backfillet rammer kun rækker hvor
-- signing_fee stadig er NULL, så gen-kørsel er en no-op.

ALTER TABLE public.academy_intake
  ADD COLUMN IF NOT EXISTS signing_fee BIGINT;

COMMENT ON COLUMN public.academy_intake.signing_fee IS
  '#2793: kostbasis (CZ$) betalt for at signe rytteren til akademiet, sat af '
  'signAcademyCandidate (backend/lib/academyIntake.js) ved signing. NULL = '
  'enten stadig "offered"/afvist/udløbet (rytteren er aldrig signet), eller en '
  'signet række fra FØR #2793 hvor kostbasen ikke blev persisteret og ikke '
  'kunne udledes entydigt ved backfillet nedenfor. Bruges af academyPnl.js '
  '(kostbasis pr. rytter) og teamTransferHistory.js/transferProfit.js '
  '(køb→salg-parring i transfer-profit-panelet).';

-- Best-effort backfill for eksisterende signede rækker: finance_transactions
-- (type='academy_signing', related_entity_type IS NULL — dvs. skrevet af den
-- gamle signAcademyCandidate-sti, IKKE youth-auktions-stien som allerede
-- linker related_entity_type='auction') matches POSITIONELT mod academy_intake
-- (status='signed', signing_fee IS NULL) inden for samme team_id, ordnet
-- kronologisk (resolved_at vs. created_at) — begge skrives synkront i samme
-- signAcademyCandidate-kald, så rækkefølgen er stabil INDEN FOR ét hold.
--
-- Matches KUN når antallet af kandidat-rækker er IDENTISK pr. hold på begge
-- sider (verificeret i prod 2026-08-04: 78 af 95 hold med signed-rækker
-- kvalificerer, 300 af 359 rækker). De resterende hold har et mismatch (fx
-- fordi en beta-reset har slettet academy_intake-rækker uden at slette den
-- tilhørende finance_transactions-historik) — for dem forbliver signing_fee
-- bevidst NULL frem for et gæt; UI'et viser "kostbasis ukendt" i det tilfælde
-- (se frontend/src/components/TeamTransferHistoryTab.jsx).
WITH intake_ranked AS (
  SELECT
    id,
    team_id,
    row_number() OVER (PARTITION BY team_id ORDER BY resolved_at, created_at, id) AS rn,
    count(*) OVER (PARTITION BY team_id) AS n
  FROM public.academy_intake
  WHERE status = 'signed' AND signing_fee IS NULL
),
tx_ranked AS (
  SELECT
    id,
    team_id,
    amount,
    row_number() OVER (PARTITION BY team_id ORDER BY created_at, id) AS rn,
    count(*) OVER (PARTITION BY team_id) AS n
  FROM public.finance_transactions
  WHERE type = 'academy_signing' AND related_entity_type IS NULL
),
matched AS (
  SELECT i.id AS intake_id, abs(t.amount) AS fee
  FROM intake_ranked i
  JOIN tx_ranked t
    ON t.team_id = i.team_id AND t.rn = i.rn AND t.n = i.n
)
UPDATE public.academy_intake ai
SET signing_fee = m.fee
FROM matched m
WHERE ai.id = m.intake_id;

-- Post-verify (kør manuelt efter apply — INGEN destruktiv handling herover, så
-- ingen rollback nødvendig ud over selve backfillets betingede UPDATE):
--   SELECT count(*) FILTER (WHERE signing_fee IS NOT NULL) AS backfilled,
--          count(*) FILTER (WHERE signing_fee IS NULL) AS still_unknown
--   FROM public.academy_intake WHERE status = 'signed';
--   -- Forventet: backfilled ~300, still_unknown ~59 (2026-08-04-tal, prod vokser løbende).
