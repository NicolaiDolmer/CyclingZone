-- #3570 fase 2 — persistér det TRUKNE ungdoms-anlæg på riders.
--
-- ROD-ÅRSAG (fase 2-opgavebeskrivelsen): akademi-generatoren trækker et anlæg
-- (archetypeDraw { primary, secondary, isHybrid } — secondary er null for et
-- rent anlæg, se archetypeDistribution.js, academyGenerator.js)
-- før stats formes efter det — men trækket blev ALDRIG persisteret. Den
-- ENDELIGE type (riders.primary_type/secondary_type) kommer fra
-- deriveForRiderIds' klassifikator, som deriverer rytterens livstidslofter
-- (ability_caps, buildCapsForRider) ud fra et BOOTSTRAP-gæt (klassificeret mod
-- NEUTRAL_BASELINE på flade 1-12-profiler) — MÅLT 9/8: 0/303 gc-trukne
-- ryttere bootstrap-genkendes som gc, og 57,7 % af ALLE bootstrappes som
-- baroudeur. Bootstrap-gættet former lofterne direkte (buildCapsForRider
-- bruger primary/secondary som rolle-faktor), så en trukket klatrer der
-- bootstrap-gættes som fighter får klatre-loft ×0,45 i stedet for ×1,0 — en
-- fejlformet livstidsloft ingen efterfølgende reklassificering kan rette.
--
-- archetype_draw gør det trukne anlæg tilgængeligt for backfillCores.js'
-- deriveForRiderIds, så CAPS kan bygges af DET TRUKNE anlæg i stedet for
-- bootstrap-gættet — bootstrap-stien forbliver uændret fallback for alle
-- ryttere UDEN et draw (alle eksisterende + alle ikke-akademi-stier).
--
-- Skrives af academyIntake.js ved rytter-insert (kandidaterne bærer allerede
-- archetypeDraw fra academyGenerator.js — se dens kommentar for hvorfor feltet
-- historisk ALDRIG blev spredt ind i rider-insert-payloaden). Læses (ikke
-- skrevet) af backfillCores.js.
--
-- NULL for alle eksisterende ryttere + enhver fremtidig rytter der ikke går
-- gennem akademi-intake (voksen-generering, PCM-import) — bagudkompatibelt,
-- ingen backfill af historiske rækker (fase 2-scope: kun NYE trækk fremover;
-- de 2.356 eksisterende unge repareres i en SEPARAT ejer-gated kørsel, se
-- #3570-opgavebeskrivelsens punkt 4).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Ingen håndhævelse/FK — ren
-- diagnostik+afled-input, ingen klient-adgang ud over normal riders-RLS.
--
-- Rollback:
--   ALTER TABLE public.riders DROP COLUMN IF EXISTS archetype_draw;

ALTER TABLE public.riders
  ADD COLUMN IF NOT EXISTS archetype_draw jsonb;

COMMENT ON COLUMN public.riders.archetype_draw IS
  '#3570 fase 2 — det TRUKNE ungdoms-anlæg fra academyGenerator.js ({"primary":"gc","secondary":"climber","isHybrid":false}). Skrevet ved akademi-intake; læst af backfillCores.deriveForRiderIds til at forme ability_caps af det trukne anlæg i stedet for et bootstrap-gæt. NULL for alle ryttere uden et akademi-draw (bagudkompatibel fallback til bootstrap-typen).';
