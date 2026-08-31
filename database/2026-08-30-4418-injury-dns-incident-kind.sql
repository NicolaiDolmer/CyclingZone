-- =============================================================================
-- 2026-08-30 · #4418 - race_incidents.kind faar vaerdien 'injury'
-- =============================================================================
-- PROBLEM (maalt i prod 30/8, daglig Sentry/Railway-triage):
-- En rytter der bliver skadet MENS et etapeloeb koerer, fjernes helt korrekt fra
-- feltet af skadefilteret (#3896) — ejer-beslutning 30/8: "hvis man er skadet skal
-- man ikke kunne koere loeb, det er fint at rytterne tages ud af loebet".
--
-- Men udtagelsen efterlader INTET spor. En aegte udgaaelse skrives som en
-- race_incidents-raekke med outcome='abandon'; det er den raekke loadAbandonedRiderIds
-- laeser og som resultatvisningen kan vise. Skadefilteret skriver ingen raekke, saa:
--
--   * spilleren faar ingen forklaring — rytteren holder bare op med at optraede
--   * freezeEntrantsToStartField ser ham som "forsvundet" og logger en advarsel paa
--     hver eneste resterende etape (stoej, ikke signal, naar udtagelsen er tilsigtet)
--
-- Maalt 30/8: 5 ryttere forsvundet uden incident i 3 igangvaerende S3-etapeloeb,
-- alle paa menneskehold. 7 ryttere baerer lige nu en levende training_overload-skade
-- OG en binding i et koerende S3-etapeloeb.
--
-- LOESNING: motoren skriver en udgaaelses-raekke naar skadefilteret tager en rytter
-- ud af et loeb der allerede er startet. Det kraever en ny `kind`, saa vi ikke lyver
-- og kalder en traeningsskade for et styrt.
--
-- SCOPE: udelukkende en udvidelse af en CHECK-constraint. Ingen data muteres, ingen
-- kolonner tilfoejes eller fjernes, ingen eksisterende raekke bliver ugyldig
-- ('crash' og 'mechanical' er uroerte).
--
-- IDEMPOTENT: DROP CONSTRAINT IF EXISTS + ADD. Kan koeres igen uden effekt.
--
-- ROLLBACK (kun muligt hvis ingen 'injury'-raekker er skrevet endnu):
--   ALTER TABLE public.race_incidents DROP CONSTRAINT IF EXISTS race_incidents_kind_check;
--   ALTER TABLE public.race_incidents ADD CONSTRAINT race_incidents_kind_check
--     CHECK (kind IN ('crash','mechanical'));
--
-- Refs #4418, #3896, #1844, #1176
-- =============================================================================

ALTER TABLE public.race_incidents
  DROP CONSTRAINT IF EXISTS race_incidents_kind_check;

ALTER TABLE public.race_incidents
  ADD CONSTRAINT race_incidents_kind_check
  CHECK (kind = ANY (ARRAY['crash'::text, 'mechanical'::text, 'injury'::text]));

COMMENT ON COLUMN public.race_incidents.kind IS
  'Haendelsens art. crash/mechanical opstaar UNDER etapen (race engine v3, #1176). '
  'injury (#4418) er ikke en haendelse i loebet: rytteren blev skadet uden for loebet '
  '(fx training_overload) og kunne derfor ikke stille til start paa denne etape. '
  'Skrives altid med outcome=abandon og uden time_loss_seconds/injury_days — '
  'skaden ejes af rider_condition, ikke af loebet, saa injury_cause overskrives IKKE.';
