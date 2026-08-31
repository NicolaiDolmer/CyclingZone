-- 2026-08-29 — #4213 forward-guard (DB-lag): en rytter der er lovet væk i et
-- LEVENDE akademitilbud må ikke overtages af et andet hold.
--
-- ROD-ÅRSAG (verificeret mod prod 29/8, read-only)
--   Akademi-intake-kandidater fødes som frie agenter — academyGenerator.js:152
--   sætter `team_id: null` OG `is_academy: false`. De bliver først akademiryttere
--   når manageren siger ja. Konsekvensen er at rytter-rækken ALENE ikke kan
--   skelne en lovet-væk kandidat fra en almindelig fri agent; den eneste markør
--   er en `academy_intake`-række med status 'offered'.
--
--   24/8 12:15:16-12:18:04 UTC kørte #4172's free-agent-fill og fordelte 2.532
--   frie ryttere på 127 nyoprettede AI-hold. 1.543 af dem havde en
--   academy_intake-række. Bevis committet: docs/snapshots/4172/
--   d4-freeagent-fill-2026-08-24T12-15-16-587Z.json (144 hold, squadSize 20,
--   valueCeiling 100.000). Rest 29/8: 274 levende tilbud til 162 menneskehold
--   på ryttere der nu ejes af et AI-hold.
--
-- HVORFOR DB-LAGET OG IKKE KUN KODE
--   Scriptet der forvoldte skaden blev ALDRIG committet til repoet — det var et
--   ad-hoc-kørsels-script i #4172-sessionen. Et filter i squadEnforcement.js
--   (som denne PR også tilføjer) beskytter derfor kun de kendte kodestier, ikke
--   den klasse skrivevej der faktisk gjorde skaden. Triggeren her dækker ENHVER
--   skrivevej: cron, route, manuel SQL via MCP, fremtidige engangs-scripts.
--
-- HVAD DEN TILLADER (bevidst smal)
--   Blokerer KUN når en rytter får `team_id` sat til et hold der IKKE er holdet
--   tilbuddet gik til, mens et 'offered'-tilbud står åbent. Dermed:
--     • signeringen (team_id := det tilbydende hold) passerer uændret,
--     • at frigive rytteren (team_id := NULL) passerer,
--     • enhver rytter uden levende tilbud passerer,
--     • når tilbuddet er 'signed'/'rejected'/udløbet er rytteren fri vildt igen.
--
-- ⚠️ IKKE-DESTRUKTIV: ingen DELETE, ingen UPDATE af eksisterende rækker. Denne
--    migration reparerer IKKE de 274 nuværende brud — det er et separat,
--    ejer-godkendt skridt. Den forhindrer kun NYE.
--
-- IDEMPOTENT: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.

BEGIN;

CREATE OR REPLACE FUNCTION guard_academy_offer_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  offered_to UUID;
BEGIN
  -- Kun relevant når rytteren FÅR et hold. Frigivelse (NULL) og uændret ejerskab
  -- passerer uden opslag, så triggeren ikke koster en query pr. rytter-UPDATE.
  IF NEW.team_id IS NULL OR NEW.team_id IS NOT DISTINCT FROM OLD.team_id THEN
    RETURN NEW;
  END IF;

  SELECT ai.team_id INTO offered_to
  FROM academy_intake ai
  WHERE ai.rider_id = NEW.id
    AND ai.status = 'offered'
  LIMIT 1;

  IF offered_to IS NOT NULL AND offered_to IS DISTINCT FROM NEW.team_id THEN
    RAISE EXCEPTION
      'akademitilbud-vagt (#4213): rytter % er lovet til hold % i et levende akademitilbud og kan ikke overtages af hold %. Afvis eller luk intake-raekken foerst.',
      NEW.id, offered_to, NEW.team_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_academy_offer_ownership ON riders;
CREATE TRIGGER trg_guard_academy_offer_ownership
  BEFORE UPDATE OF team_id ON riders
  FOR EACH ROW
  EXECUTE FUNCTION guard_academy_offer_ownership();

COMMIT;

-- POST-VERIFY (kør efter apply; forventet resultat i kommentaren)
--
--   -- 1) Triggeren findes og er aktiv (forventet: 1 raekke, tgenabled = 'O')
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'riders'::regclass AND tgname = 'trg_guard_academy_offer_ownership';
--
--   -- 2) Ingen NYE brud kan opstaa. Tallet her er de EKSISTERENDE 274, som
--   --    triggeren bevidst ikke rydder op i (forventet uaendret: 274)
--   SELECT count(*) FROM academy_intake ai JOIN riders r ON r.id = ai.rider_id
--    WHERE ai.status = 'offered' AND r.team_id IS NOT NULL AND r.team_id <> ai.team_id;
