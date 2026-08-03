-- #3135 (fair-play epic #3131, lag 3 — detektion: identitets-korrelation).
-- Whitelist-mekanisme for KENDTE LOVLIGE kontopar (husstande, kollegaer på samme
-- netværk, ejerens egne testkonti @cyclingzone.dev). Ejer-beslutning 30/7 (#3131):
-- "Flere konti pr. husstand er TILLADT. Det forbudte er værdioverførsel mellem
-- forbundne konti, ikke delt IP i sig selv." Whitelisting af kendte lovlige par
-- er et acceptkriterium, ikke en nice-to-have.
--
-- Denne tabel er ren allow-list — den ændrer IKKE spillets adfærd. Korrelations-
-- queries i scripts/fairplay/3135-*.sql skal LEFT JOIN denne tabel og udelukke
-- par der findes her fra output (uanset identitetssignal eller værdistrøm).
--
-- Normaliseret parnøgle: team_id_lo altid < team_id_hi (håndhævet af CHECK), så
-- (A,B) og (B,A) aldrig kan indsættes som to forskellige rækker. Indsæt altid
-- via least()/greatest():
--   insert into public.fairplay_whitelisted_pairs (team_id_lo, team_id_hi, reason)
--   values (least('<team-a>'::uuid,'<team-b>'::uuid), greatest('<team-a>'::uuid,'<team-b>'::uuid), '...');
--
-- IKKE APPLIERET AF #3135-workeren (kun idempotent DDL-fil, jf. opgavens hårde
-- regler). Ejer/en senere session applierer.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.fairplay_whitelisted_pairs;

CREATE TABLE IF NOT EXISTS public.fairplay_whitelisted_pairs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id_lo   uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  team_id_hi   uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  reason       text NOT NULL,
  whitelisted_by text NOT NULL DEFAULT 'owner',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fairplay_whitelisted_pairs_distinct_teams CHECK (team_id_lo <> team_id_hi),
  CONSTRAINT fairplay_whitelisted_pairs_canonical_order CHECK (team_id_lo < team_id_hi)
);

COMMENT ON TABLE public.fairplay_whitelisted_pairs IS
  '#3135 — kendte lovlige kontopar (husstande, ejerens testkonti) undtaget fra identitets-korrelations-flagging. service_role-only. Indsæt via least()/greatest() på team_id.';
COMMENT ON COLUMN public.fairplay_whitelisted_pairs.reason IS
  'Fritekst-begrundelse, fx "husstand/samme adresse (bekræftet af ejer 2026-08-03)" eller "ejerens egne testkonti (@cyclingzone.dev)".';

CREATE UNIQUE INDEX IF NOT EXISTS fairplay_whitelisted_pairs_unique_pair
  ON public.fairplay_whitelisted_pairs (team_id_lo, team_id_hi);

-- RLS: ingen klient-adgang overhovedet — samme mønster som identity_events
-- (database/2026-07-31-3132-identity-events.sql). service_role (backend/ops-
-- scripts) bypasser RLS uændret; aldrig eksponeret via anon/authenticated.
ALTER TABLE public.fairplay_whitelisted_pairs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fairplay_whitelisted_pairs_no_client_access" ON public.fairplay_whitelisted_pairs;
CREATE POLICY "fairplay_whitelisted_pairs_no_client_access" ON public.fairplay_whitelisted_pairs
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- INTET SEED. Ejer-beslutning 3/8 (nat-batch): "det er mig der bestemmer hvad
-- der skal whitelistes" — tabellen shippes TOM, og hvert par indsættes manuelt
-- først når ejeren har godkendt netop det par (gælder også ejerens egne
-- testkonti). Kandidat-par med evidens: se docs/audits/2026-08-03-identity-
-- correlation-3135.md. Indsæt-skabelon står i header-kommentaren øverst.
