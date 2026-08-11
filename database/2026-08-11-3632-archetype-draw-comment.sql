-- #3632 — kolonne-kommentaren på riders.archetype_draw beskriver et anlæg der
-- ikke længere findes.
--
-- 2026-08-09-3570-archetype-draw.sql satte kommentaren til
-- '{"primary":"gc","secondary":"climber","isHybrid":false}' — altså den form
-- generatoren skrev dengang, hvor `HYBRID_PROBABILITY = 0.15` afgjorde om der
-- overhovedet blev trukket en sekundær. Ejer-beslutning 11/8 (#3632): ALLE
-- ryttere har en sekundær, og `isHybrid` er væk. En kolonne-kommentar der
-- beskriver den gamle form er præcis den slags dokumentation der driver fra
-- koden uden at fejle (jf. .claude/learnings/2026-08-11-guard-premise-decay-
-- archetype-draw.md's "beslægtet, men ikke samme fejl": KOEREBOG.md's
-- DATABASE_URL vs SUPABASE_DB_URL).
--
-- Rører KUN metadata: ingen DDL på data, ingen rækker læst eller skrevet.
-- Idempotent pr. konstruktion (COMMENT ON overskriver).
--
-- Rollback: kør COMMENT-sætningen fra 2026-08-09-3570-archetype-draw.sql igen.

COMMENT ON COLUMN public.riders.archetype_draw IS
  '#3570 fase 2 / #3632 — rytterens TRUKNE anlæg fra academyGenerator.js ({"primary":"gc","secondary":"climber"}). Siden #3632 (11/8) har ALLE nye akademi-ryttere en sekundær forskellig fra primæren; rækker skrevet før den dato kan have secondary null og bærer desuden en nu udgået isHybrid-nøgle. Skrevet ved akademi-intake; læst af backfillCores.deriveForRiderIds, som former ability_caps af det trukne anlæg i stedet for et bootstrap-gæt, og af riderTypes.resolveRiderTypes, som forankrer BÅDE primary_type og secondary_type i det så den natlige genberegning ikke kan flytte dem. NULL for ryttere uden et akademi-draw (bagudkompatibel fallback til bootstrap-typen); voksen-generatoren skriver stadig secondary null, se #3634.';
