-- 2026-08-23 · uniq_bonus_per_team_season → uniq_division_bonus_per_team_season
-- APPLIED TIL PROD 23/8 ~22:15 (ejer-GO 10b) — filen er skema-paritet, idempotent.
--
-- Baggrund (cutover-natten, spiller-rapporteret): det gamle indeks tillod kun ÉN
-- type='bonus'-række pr. hold pr. sæson. Efter #2948-familien deler
-- bestyrelses-/sponsorbonusser samme type, så ethvert hold der accepterede en
-- bestyrelsesbonus i sæsonen kunne ALDRIG få sin divisionsbonus ved sæson-slut
-- (12 hold / 825.000 CZ$ i S2→S3; payDivisionBonuses' kode-dedup havde samme
-- fejl og er rettet i economyEngine.js i samme PR).
--
-- Det nye indeks håndhæver den TILSIGTEDE invariant: præcis én DIVISIONS-bonus
-- (reason_code='season_end_division_bonus') pr. hold pr. sæson. Bestyrelses-
-- bonusser beskyttes af accept-tilstandsmaskinen + idempotency_key
-- (uniq_finance_idempotency_key).

create unique index if not exists uniq_division_bonus_per_team_season
  on public.finance_transactions (team_id, season_id)
  where type = 'bonus' and reason_code = 'season_end_division_bonus' and season_id is not null;

drop index if exists public.uniq_bonus_per_team_season;
