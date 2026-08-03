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

-- Seed: ejerens egne testkonti (@cyclingzone.dev) er kendt lovlige mod hinanden
-- OG mod ejerens hovedkonto (Dolmer/"Bad At Names") — alle logger ind fra samme
-- udviklingsmaskine (bekræftet: delt eksakt IP 109.59.94.167 i identity_events,
-- 2026-08-03-analysen til #3135). Idempotent (ON CONFLICT DO NOTHING via unique
-- index + WHERE NOT EXISTS-stil er unødvendig her, ON CONFLICT er simplere).
--
-- Team-id'er er miljøspecifikke (prod). Hvis id'erne herunder ikke matcher det
-- miljø migrationen appliceres i (fx en frisk lokal/staging-DB uden disse test-
-- konti), fejler INSERT'et på FK-constraint og springes over uden at fejle hele
-- filen (DO-block, samme defensive mønster som 2026-07-31-3132-identity-events.sql).
DO $$
DECLARE
  v_bad_at_names uuid := '814b9df1-e2b9-4a3c-9ac1-ac33d7439bc4';
  v_test_a       uuid := '7d968e90-ab56-4eb3-832d-2d9d0515a954';
  v_test_b       uuid := 'e3231bb4-6520-4c8d-9d4c-55d252d03f85';
  v_test_seller  uuid := '981b7a82-1747-44c8-a3a9-e0c6a1e68f55';
  v_pair uuid[];
BEGIN
  IF EXISTS (SELECT 1 FROM public.teams WHERE id IN (v_bad_at_names, v_test_a, v_test_b, v_test_seller)) THEN
    FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
      ARRAY[v_bad_at_names, v_test_a],
      ARRAY[v_bad_at_names, v_test_b],
      ARRAY[v_bad_at_names, v_test_seller],
      ARRAY[v_test_a, v_test_b],
      ARRAY[v_test_a, v_test_seller],
      ARRAY[v_test_b, v_test_seller]
    ]
    LOOP
      IF v_pair[1] IS NOT NULL AND v_pair[2] IS NOT NULL THEN
        INSERT INTO public.fairplay_whitelisted_pairs (team_id_lo, team_id_hi, reason, whitelisted_by)
        VALUES (
          LEAST(v_pair[1], v_pair[2]), GREATEST(v_pair[1], v_pair[2]),
          'Ejerens egne testkonti (@cyclingzone.dev) + hovedkonto — delt udviklingsmaskine, ikke spillere.',
          'owner'
        )
        ON CONFLICT (team_id_lo, team_id_hi) DO NOTHING;
      END IF;
    END LOOP;
  ELSE
    RAISE NOTICE 'fairplay_whitelisted_pairs seed sprunget over: test-konti findes ikke i dette miljø';
  END IF;
END $$;
