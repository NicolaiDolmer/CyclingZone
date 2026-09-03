-- KOERES IKKE AUTOMATISK (manual-only): rollback-vaern, koeres kun ved tilbagerulning af #4631.
--
-- #4631 · Punch og climbing skilles i traeningspakkerne (ejer 2/9, "snarligt")
--
-- STATUS: IKKE ANVENDT. Denne fil er leveret sammen med PR'en, ikke koert mod prod.
--
-- ══ HVORFOR DER IKKE ER NOGET AT MIGRERE ═══════════════════════════════════
-- Splittet beholder BEVIDST noeglen `vo2max` til hybriden (den pakke der stadig
-- traener climbing + punch + tempo). De to nye sessioner er `vo2max_climb` og
-- `vo2max_punch`, og de er RENE TILFOEJELSER. Hver eneste gemte raekke i
-- training_plans peger derfor allerede paa hybriden: mapningen "gammel noegle →
-- hybrid" er identiteten, og ingen manager vaagner op til en anden session end
-- i gaar.
--
-- training_plans.focus er TEXT uden CHECK-constraint (2026-06-08-training-l2-teaser.sql:21;
-- "focus/intensity valideres i app-kode"), saa der er heller ingen skema-aendring.
--
-- Maalt i prod 3/9 2026 (dansk tid), aktiv saeson: 2.541 aktive planer, heraf 933
-- paa hybriden. Af de 933 har 73 climbing paa loftet og 22 punch paa loftet; 63
-- har KUN climbing doed og 12 kun punch doed. Det er de raekker splittet er lavet
-- til: i dag mister de en del af hver eneste intervaldag, og efter splittet kan
-- manageren selv laegge hele dagen i den evne der stadig har plads.
--
-- Filen indeholder derfor to ting: en verifikation der kan koeres naar som helst,
-- og et rollback-vaern der KUN skal koeres hvis splittet rulles tilbage.

-- ── 1) VERIFIKATION (ren laesning, ingen writes) ────────────────────────────
-- Fordelingen af aktive planer pr. session. Efter merge skal `vo2max_climb` og
-- `vo2max_punch` dukke op her; foer merge findes de ikke, og det er korrekt.
SELECT tp.focus, tp.intensity, count(*) AS planer
FROM training_plans tp
JOIN seasons s ON s.id = tp.season_id AND s.status = 'active'
GROUP BY 1, 2
ORDER BY planer DESC;

-- Hvor mange hybrid-planer har en af de to evner paa sit loft (dvs. taber en del
-- af dagen i dag)? Samme snit som maalingen ovenfor.
SELECT
  count(*) AS hybrid_planer,
  count(*) FILTER (WHERE coalesce((rda.ability_caps->>'climbing')::numeric, 999) <= rda.climbing) AS climbing_paa_loft,
  count(*) FILTER (WHERE coalesce((rda.ability_caps->>'punch')::numeric, 999) <= rda.punch) AS punch_paa_loft
FROM training_plans tp
JOIN seasons s ON s.id = tp.season_id AND s.status = 'active'
JOIN rider_derived_abilities rda ON rda.rider_id = tp.rider_id
WHERE tp.focus = 'vo2max';

-- ── 2) ROLLBACK-VAERN (idempotent; koer KUN ved en tilbagerulning) ──────────
-- Hvis splittet nogensinde rulles tilbage, bliver `vo2max_climb`/`vo2max_punch`
-- ukendte noegler for koden. normalizeProgram() falder saa tilbage til "endurance"
-- (backend/lib/trainingDayTypes.js), og en rytter der trente intervaller ville
-- stille og roligt begynde at koere lange ture. Reglen fra #3762 er ejer-besluttet
-- og gaelder ogsaa den vej: BEVAR EVNERNE. Hybriden er den eneste session der
-- indeholder begge, saa den er maalet.
--
-- Idempotent: anden koersel rammer nul raekker (WHERE-klausulen er tom bagefter).
-- Intensiteten roeres ikke: alle tre sessioner ligger paa 'hard'.
UPDATE training_plans
SET focus = 'vo2max', updated_at = now()
WHERE focus IN ('vo2max_climb', 'vo2max_punch');

-- Post-verify til rollback-grenen: skal give 0.
SELECT count(*) AS tilbagevaerende_split_noegler
FROM training_plans
WHERE focus IN ('vo2max_climb', 'vo2max_punch');
