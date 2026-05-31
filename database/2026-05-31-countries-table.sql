-- #844 Slice 1 — Lande-system: kanonisk countries-tabel.
--
-- Gør nationalitet til en førsteklasses-entitet i stedet for en løs ISO2-streng
-- på riders. Driver (i senere slices) fødselsrate + talent-loft for nye fiktive
-- ryttere (#669-generatoren) og et dynamisk lande-omdømme.
--
-- Tre akser (ejer-beslutning #844):
--   • birth_weight    — relativ sandsynlighed for at en ny rytter er fra landet.
--   • talent_ceiling  — skubber tier-/potentiale-fordelingen op (>1) eller ned (<1).
--   • reputation      — dynamisk (opdateres af Slice 3 fra resultater);
--     reputation_seed — baseline/anker (reset + mean-reversion-mål).
--
-- RLS: reference-data uden secrets → læs for authenticated, skriv kun for admin.
--   Samme mønster som app_config (#364). Backend (service-role) bypasser RLS.
--
-- Reference til riders.nationality_code er BLØD i V1 (ingen hård FK endnu) —
-- samme valg som founder_supporter_waitlist.country. Seed dækker alle 138 distinct
-- nationality_code i prod (verificeret 2026-05-31), så ingen rytter er forældreløs.
-- Hård FK kan tilføjes senere når tabellen er bevist komplet (slice-doc åbent punkt).
--
-- Idempotent: CREATE IF NOT EXISTS + DROP/CREATE POLICY + seed ON CONFLICT DO NOTHING.
-- Seed-blokken nedenfor er GENERERET af backend/scripts/generateCountriesSeed.mjs
-- (ren kilde: backend/lib/countriesSeed.js). Regenerér ved tier-/metadata-ændring.

CREATE TABLE IF NOT EXISTS public.countries (
  iso2              TEXT PRIMARY KEY CHECK (iso2 ~ '^[A-Z]{2}$'),
  name_en           TEXT NOT NULL,
  name_da           TEXT,
  ioc_code          TEXT,
  continent         TEXT,
  -- Akse 1 · størrelse/volumen
  birth_weight      NUMERIC NOT NULL DEFAULT 0   CHECK (birth_weight >= 0),
  -- Akse 2 · talent-loft
  talent_ceiling    NUMERIC NOT NULL DEFAULT 1.0 CHECK (talent_ceiling > 0),
  -- Akse 3 · dynamisk omdømme
  reputation        NUMERIC NOT NULL DEFAULT 50  CHECK (reputation BETWEEN 0 AND 100),
  reputation_seed   NUMERIC NOT NULL DEFAULT 50  CHECK (reputation_seed BETWEEN 0 AND 100),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.countries IS
  'Kanonisk lande-reference (#844). 3 akser: birth_weight, talent_ceiling, reputation(+seed). Read=authenticated, write=admin.';

ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "countries_select_authenticated" ON public.countries;
CREATE POLICY "countries_select_authenticated"
  ON public.countries
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "countries_admin_write" ON public.countries;
CREATE POLICY "countries_admin_write"
  ON public.countries
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── SEED (genereret — se header) ─────────────────────────────────────────────
INSERT INTO public.countries
  (iso2, name_en, name_da, ioc_code, continent, birth_weight, talent_ceiling, reputation, reputation_seed)
VALUES
  ('AD', 'Andorra', 'Andorra', 'AND', 'Europe', 5, 0.82, 40, 40),
  ('AE', 'United Arab Emirates', 'De Forenede Arabiske Emirater', 'UAE', 'Asia', 5, 0.82, 40, 40),
  ('AL', 'Albania', 'Albanien', 'ALB', 'Europe', 14, 0.98, 50, 50),
  ('AM', 'Armenia', 'Armenien', 'ARM', 'Europe', 14, 0.98, 50, 50),
  ('AO', 'Angola', 'Angola', 'ANG', 'Africa', 5, 0.82, 40, 40),
  ('AR', 'Argentina', 'Argentina', 'ARG', 'Americas', 14, 0.98, 50, 50),
  ('AT', 'Austria', 'Østrig', 'AUT', 'Europe', 62, 1.25, 76, 76),
  ('AU', 'Australia', 'Australien', 'AUS', 'Oceania', 62, 1.25, 76, 76),
  ('AZ', 'Azerbaijan', 'Aserbajdsjan', 'AZE', 'Europe', 14, 0.98, 50, 50),
  ('BA', 'Bosnia & Herzegovina', 'Bosnien-Hercegovina', 'BIH', 'Europe', 5, 0.82, 40, 40),
  ('BE', 'Belgium', 'Belgien', 'BEL', 'Europe', 100, 1.45, 90, 90),
  ('BF', 'Burkina Faso', 'Burkina Faso', 'BUR', 'Africa', 5, 0.82, 40, 40),
  ('BG', 'Bulgaria', 'Bulgarien', 'BUL', 'Europe', 14, 0.98, 50, 50),
  ('BH', 'Bahrain', 'Bahrain', 'BRN', 'Asia', 5, 0.82, 40, 40),
  ('BJ', 'Benin', 'Benin', 'BEN', 'Africa', 5, 0.82, 40, 40),
  ('BM', 'Bermuda', 'Bermuda', 'BER', 'Americas', 5, 0.82, 40, 40),
  ('BN', 'Brunei', 'Brunei', 'BRU', 'Asia', 5, 0.82, 40, 40),
  ('BO', 'Bolivia', 'Bolivia', 'BOL', 'Americas', 14, 0.98, 50, 50),
  ('BR', 'Brazil', 'Brasilien', 'BRA', 'Americas', 14, 0.98, 50, 50),
  ('BS', 'Bahamas', 'Bahamas', 'BAH', 'Americas', 5, 0.82, 40, 40),
  ('BY', 'Belarus', 'Belarus', 'BLR', 'Europe', 32, 1.1, 62, 62),
  ('BZ', 'Belize', 'Belize', 'BIZ', 'Americas', 5, 0.82, 40, 40),
  ('CA', 'Canada', 'Canada', 'CAN', 'Americas', 32, 1.1, 62, 62),
  ('CD', 'Congo - Kinshasa', 'Congo-Kinshasa', 'COD', 'Africa', 5, 0.82, 40, 40),
  ('CH', 'Switzerland', 'Schweiz', 'SUI', 'Europe', 62, 1.25, 76, 76),
  ('CI', 'Côte d’Ivoire', 'Elfenbenskysten', 'CIV', 'Africa', 5, 0.82, 40, 40),
  ('CL', 'Chile', 'Chile', 'CHI', 'Americas', 14, 0.98, 50, 50),
  ('CM', 'Cameroon', 'Cameroun', 'CMR', 'Africa', 5, 0.82, 40, 40),
  ('CN', 'China', 'Kina', 'CHN', 'Asia', 14, 0.98, 50, 50),
  ('CO', 'Colombia', 'Colombia', 'COL', 'Americas', 62, 1.25, 76, 76),
  ('CR', 'Costa Rica', 'Costa Rica', 'CRC', 'Americas', 14, 0.98, 50, 50),
  ('CU', 'Cuba', 'Cuba', 'CUB', 'Americas', 14, 0.98, 50, 50),
  ('CW', 'Curaçao', 'Curaçao', 'CUW', 'Americas', 5, 0.82, 40, 40),
  ('CY', 'Cyprus', 'Cypern', 'CYP', 'Europe', 14, 0.98, 50, 50),
  ('CZ', 'Czechia', 'Tjekkiet', 'CZE', 'Europe', 32, 1.1, 62, 62),
  ('DE', 'Germany', 'Tyskland', 'GER', 'Europe', 62, 1.25, 76, 76),
  ('DK', 'Denmark', 'Danmark', 'DEN', 'Europe', 62, 1.25, 76, 76),
  ('DO', 'Dominican Republic', 'Den Dominikanske Republik', 'DOM', 'Americas', 5, 0.82, 40, 40),
  ('DZ', 'Algeria', 'Algeriet', 'ALG', 'Africa', 14, 0.98, 50, 50),
  ('EC', 'Ecuador', 'Ecuador', 'ECU', 'Americas', 14, 0.98, 50, 50),
  ('EE', 'Estonia', 'Estland', 'EST', 'Europe', 32, 1.1, 62, 62),
  ('EG', 'Egypt', 'Egypten', 'EGY', 'Africa', 5, 0.82, 40, 40),
  ('ER', 'Eritrea', 'Eritrea', 'ERI', 'Africa', 62, 1.25, 76, 76),
  ('ES', 'Spain', 'Spanien', 'ESP', 'Europe', 100, 1.45, 90, 90),
  ('ET', 'Ethiopia', 'Etiopien', 'ETH', 'Africa', 5, 0.82, 40, 40),
  ('FI', 'Finland', 'Finland', 'FIN', 'Europe', 32, 1.1, 62, 62),
  ('FR', 'France', 'Frankrig', 'FRA', 'Europe', 100, 1.45, 90, 90),
  ('GA', 'Gabon', 'Gabon', 'GAB', 'Africa', 5, 0.82, 40, 40),
  ('GB', 'United Kingdom', 'Storbritannien', 'GBR', 'Europe', 62, 1.25, 76, 76),
  ('GD', 'Grenada', 'Grenada', 'GRN', 'Americas', 5, 0.82, 40, 40),
  ('GE', 'Georgia', 'Georgien', 'GEO', 'Europe', 14, 0.98, 50, 50),
  ('GH', 'Ghana', 'Ghana', 'GHA', 'Africa', 5, 0.82, 40, 40),
  ('GR', 'Greece', 'Grækenland', 'GRE', 'Europe', 14, 0.98, 50, 50),
  ('GT', 'Guatemala', 'Guatemala', 'GUA', 'Americas', 14, 0.98, 50, 50),
  ('GU', 'Guam', 'Guam', 'GUM', 'Oceania', 5, 0.82, 40, 40),
  ('GY', 'Guyana', 'Guyana', 'GUY', 'Americas', 5, 0.82, 40, 40),
  ('HK', 'Hong Kong SAR China', 'SAR Hongkong', 'HKG', 'Asia', 5, 0.82, 40, 40),
  ('HN', 'Honduras', 'Honduras', 'HON', 'Americas', 5, 0.82, 40, 40),
  ('HR', 'Croatia', 'Kroatien', 'CRO', 'Europe', 14, 0.98, 50, 50),
  ('HU', 'Hungary', 'Ungarn', 'HUN', 'Europe', 14, 0.98, 50, 50),
  ('ID', 'Indonesia', 'Indonesien', 'INA', 'Asia', 5, 0.82, 40, 40),
  ('IE', 'Ireland', 'Irland', 'IRL', 'Europe', 32, 1.1, 62, 62),
  ('IL', 'Israel', 'Israel', 'ISR', 'Asia', 14, 0.98, 50, 50),
  ('IN', 'India', 'Indien', 'IND', 'Asia', 5, 0.82, 40, 40),
  ('IQ', 'Iraq', 'Irak', 'IRQ', 'Asia', 5, 0.82, 40, 40),
  ('IR', 'Iran', 'Iran', 'IRI', 'Asia', 14, 0.98, 50, 50),
  ('IS', 'Iceland', 'Island', 'ISL', 'Europe', 14, 0.98, 50, 50),
  ('IT', 'Italy', 'Italien', 'ITA', 'Europe', 100, 1.45, 90, 90),
  ('JM', 'Jamaica', 'Jamaica', 'JAM', 'Americas', 5, 0.82, 40, 40),
  ('JP', 'Japan', 'Japan', 'JPN', 'Asia', 14, 0.98, 50, 50),
  ('KE', 'Kenya', 'Kenya', 'KEN', 'Africa', 5, 0.82, 40, 40),
  ('KG', 'Kyrgyzstan', 'Kirgisistan', 'KGZ', 'Asia', 5, 0.82, 40, 40),
  ('KH', 'Cambodia', 'Cambodja', 'CAM', 'Asia', 5, 0.82, 40, 40),
  ('KR', 'South Korea', 'Sydkorea', 'KOR', 'Asia', 14, 0.98, 50, 50),
  ('KW', 'Kuwait', 'Kuwait', 'KUW', 'Asia', 5, 0.82, 40, 40),
  ('KZ', 'Kazakhstan', 'Kasakhstan', 'KAZ', 'Asia', 32, 1.1, 62, 62),
  ('LA', 'Laos', 'Laos', 'LAO', 'Asia', 5, 0.82, 40, 40),
  ('LI', 'Liechtenstein', 'Liechtenstein', 'LIE', 'Europe', 5, 0.82, 40, 40),
  ('LK', 'Sri Lanka', 'Sri Lanka', 'SRI', 'Asia', 5, 0.82, 40, 40),
  ('LS', 'Lesotho', 'Lesotho', 'LES', 'Africa', 5, 0.82, 40, 40),
  ('LT', 'Lithuania', 'Litauen', 'LTU', 'Europe', 32, 1.1, 62, 62),
  ('LU', 'Luxembourg', 'Luxembourg', 'LUX', 'Europe', 32, 1.1, 62, 62),
  ('LV', 'Latvia', 'Letland', 'LAT', 'Europe', 32, 1.1, 62, 62),
  ('MA', 'Morocco', 'Marokko', 'MAR', 'Africa', 14, 0.98, 50, 50),
  ('MC', 'Monaco', 'Monaco', 'MON', 'Europe', 5, 0.82, 40, 40),
  ('MD', 'Moldova', 'Moldova', 'MDA', 'Europe', 14, 0.98, 50, 50),
  ('ME', 'Montenegro', 'Montenegro', 'MNE', 'Europe', 14, 0.98, 50, 50),
  ('MK', 'North Macedonia', 'Nordmakedonien', 'MKD', 'Europe', 14, 0.98, 50, 50),
  ('ML', 'Mali', 'Mali', 'MLI', 'Africa', 5, 0.82, 40, 40),
  ('MN', 'Mongolia', 'Mongoliet', 'MGL', 'Asia', 5, 0.82, 40, 40),
  ('MT', 'Malta', 'Malta', 'MLT', 'Europe', 5, 0.82, 40, 40),
  ('MU', 'Mauritius', 'Mauritius', 'MRI', 'Africa', 5, 0.82, 40, 40),
  ('MX', 'Mexico', 'Mexico', 'MEX', 'Americas', 14, 0.98, 50, 50),
  ('MY', 'Malaysia', 'Malaysia', 'MAS', 'Asia', 5, 0.82, 40, 40),
  ('NA', 'Namibia', 'Namibia', 'NAM', 'Africa', 5, 0.82, 40, 40),
  ('NG', 'Nigeria', 'Nigeria', 'NGR', 'Africa', 5, 0.82, 40, 40),
  ('NL', 'Netherlands', 'Nederlandene', 'NED', 'Europe', 100, 1.45, 90, 90),
  ('NO', 'Norway', 'Norge', 'NOR', 'Europe', 62, 1.25, 76, 76),
  ('NZ', 'New Zealand', 'New Zealand', 'NZL', 'Oceania', 32, 1.1, 62, 62),
  ('OM', 'Oman', 'Oman', 'OMA', 'Asia', 5, 0.82, 40, 40),
  ('PA', 'Panama', 'Panama', 'PAN', 'Americas', 5, 0.82, 40, 40),
  ('PE', 'Peru', 'Peru', 'PER', 'Americas', 14, 0.98, 50, 50),
  ('PH', 'Philippines', 'Filippinerne', 'PHI', 'Asia', 5, 0.82, 40, 40),
  ('PK', 'Pakistan', 'Pakistan', 'PAK', 'Asia', 5, 0.82, 40, 40),
  ('PL', 'Poland', 'Polen', 'POL', 'Europe', 32, 1.1, 62, 62),
  ('PR', 'Puerto Rico', 'Puerto Rico', 'PUR', 'Americas', 5, 0.82, 40, 40),
  ('PS', 'Palestinian Territories', 'De palæstinensiske områder', 'PLE', 'Asia', 5, 0.82, 40, 40),
  ('PT', 'Portugal', 'Portugal', 'POR', 'Europe', 62, 1.25, 76, 76),
  ('PY', 'Paraguay', 'Paraguay', 'PAR', 'Americas', 5, 0.82, 40, 40),
  ('QA', 'Qatar', 'Qatar', 'QAT', 'Asia', 5, 0.82, 40, 40),
  ('RO', 'Romania', 'Rumænien', 'ROU', 'Europe', 14, 0.98, 50, 50),
  ('RS', 'Serbia', 'Serbien', 'SRB', 'Europe', 14, 0.98, 50, 50),
  ('RU', 'Russia', 'Rusland', 'RUS', 'Europe', 32, 1.1, 62, 62),
  ('RW', 'Rwanda', 'Rwanda', 'RWA', 'Africa', 32, 1.1, 62, 62),
  ('SA', 'Saudi Arabia', 'Saudi-Arabien', 'KSA', 'Asia', 5, 0.82, 40, 40),
  ('SE', 'Sweden', 'Sverige', 'SWE', 'Europe', 32, 1.1, 62, 62),
  ('SG', 'Singapore', 'Singapore', 'SGP', 'Asia', 5, 0.82, 40, 40),
  ('SI', 'Slovenia', 'Slovenien', 'SLO', 'Europe', 100, 1.45, 90, 90),
  ('SK', 'Slovakia', 'Slovakiet', 'SVK', 'Europe', 62, 1.25, 76, 76),
  ('SM', 'San Marino', 'San Marino', 'SMR', 'Europe', 5, 0.82, 40, 40),
  ('SN', 'Senegal', 'Senegal', 'SEN', 'Africa', 5, 0.82, 40, 40),
  ('SY', 'Syria', 'Syrien', 'SYR', 'Asia', 5, 0.82, 40, 40),
  ('TH', 'Thailand', 'Thailand', 'THA', 'Asia', 5, 0.82, 40, 40),
  ('TL', 'Timor-Leste', 'Timor-Leste', 'TLS', 'Asia', 5, 0.82, 40, 40),
  ('TN', 'Tunisia', 'Tunesien', 'TUN', 'Africa', 5, 0.82, 40, 40),
  ('TR', 'Türkiye', 'Tyrkiet', 'TUR', 'Europe', 14, 0.98, 50, 50),
  ('TT', 'Trinidad & Tobago', 'Trinidad og Tobago', 'TTO', 'Americas', 5, 0.82, 40, 40),
  ('TW', 'Taiwan', 'Taiwan', 'TPE', 'Asia', 5, 0.82, 40, 40),
  ('UA', 'Ukraine', 'Ukraine', 'UKR', 'Europe', 32, 1.1, 62, 62),
  ('UG', 'Uganda', 'Uganda', 'UGA', 'Africa', 5, 0.82, 40, 40),
  ('US', 'United States', 'USA', 'USA', 'Americas', 62, 1.25, 76, 76),
  ('UY', 'Uruguay', 'Uruguay', 'URU', 'Americas', 14, 0.98, 50, 50),
  ('UZ', 'Uzbekistan', 'Usbekistan', 'UZB', 'Asia', 5, 0.82, 40, 40),
  ('VE', 'Venezuela', 'Venezuela', 'VEN', 'Americas', 14, 0.98, 50, 50),
  ('VN', 'Vietnam', 'Vietnam', 'VIE', 'Asia', 5, 0.82, 40, 40),
  ('XK', 'Kosovo', 'Kosovo', 'KOS', 'Europe', 5, 0.82, 40, 40),
  ('ZA', 'South Africa', 'Sydafrika', 'RSA', 'Africa', 14, 0.98, 50, 50),
  ('ZW', 'Zimbabwe', 'Zimbabwe', 'ZIM', 'Africa', 5, 0.82, 40, 40)
ON CONFLICT (iso2) DO NOTHING;
