-- database/2026-08-04-transfer-quarantine-config.sql
-- #2557 spor A — KARANTÆNE på nyerhvervede ryttere der er for stærke til deres
-- nye pulje. Seeder de fire app_config-nøgler. Idempotent (INSERT ... ON CONFLICT
-- DO NOTHING). ALT ships DEFAULT OFF: efter denne migration er spillets adfærd
-- bit-for-bit uændret, og backend laver NUL ekstra database-kald.
--
-- BAGGRUND: docs/audits/2026-08-03-team-dominance-2557.md, afsnit 3b + 6.
-- Tre Division 3-puljer sprang fra share4PlusSameTeamTop10 0,000 til 0,500+ i ÉT
-- døgn (30/7), fordi flere nyindkøbte ryttere debuterede samme dag. Motoren er
-- renset (ingen stakke-bonus: hold-komponenten er 1,4 % af terræn-signalet og
-- FALDER med truppens størrelse) — problemet er at puljen skifter karakter fra
-- den ene dag til den anden.
--
-- MEKANIK (backend/lib/transferQuarantine.js):
--   En nyerhvervet rytter må ikke starte de første `transfer_quarantine_race_days`
--   løbsdage i KØBERENS EGEN pulje efter erhvervelsen. Kun erhvervelser i den
--   AKTIVE sæson tæller (ellers ville hver sæsonstart karantæneramme hele feltet).
--   Håndhæves to steder, så manuel udtagelse ikke kan omgå auto-udtagelsen:
--     - backend/lib/raceEntryGenerator.js (proaktiv sweep)
--     - backend/routes/api.js  PUT /races/:raceId/selection  (manuel udtagelse)
--   Sikkerhedsgulv: karantænen frigives automatisk hvis holdet ellers ikke kunne
--   stille sit minimum. Den udskyder en debut, den afmelder aldrig et hold.
--
-- HVORFOR EVNE-MARGIN OG IKKE "SÆLGERENS TIER": to af de seks dokumenterede
-- erhvervelser 27-29/7 havde ingen sælger (fri agent) — heriblandt Lars Wouters
-- (peak 66, 216.381 CZ$), den enkeltrytter der driver både share4Plus og
-- maxRiderWinRate. Et rent sælger-tier-filter ville have ladet ham passere.
--
-- INGEN af værdierne herunder er harness-verificeret. `transfer_quarantine_margin`
-- 10 er sat mellem de målte regimer 3/8 (margin ≤7 ⇒ share4Plus 0,000; margin ≥11
-- ⇒ 0,357-0,571), samme rationale som poolBalance.DEFAULT_RESEED_THRESHOLD.
-- Simulér-før-ship gælder: kør scorecardet mod den valgte politik FØR flip.
--
-- Flip til live (eksempel-værdier — kræver ejer-beslutning, se PR-beskrivelsen):
--   UPDATE app_config SET value='"overqualified"'::jsonb WHERE key='transfer_quarantine_scope';
--   UPDATE app_config SET value='4'::jsonb  WHERE key='transfer_quarantine_race_days';
--   UPDATE app_config SET value='10'::jsonb WHERE key='transfer_quarantine_margin';
--   UPDATE app_config SET value='1'::jsonb  WHERE key='transfer_quarantine_max_debuts_per_race_day';
--
-- Rul tilbage (slå fra igen uden deploy):
--   UPDATE app_config SET value='"off"'::jsonb WHERE key='transfer_quarantine_scope';

INSERT INTO public.app_config (key, value, description)
VALUES
  ('transfer_quarantine_scope', '"off"'::jsonb,
    '#2557 spor A: hvilke erhvervelser der udløser karantæne. "off" (default, ingen karantæne) | "overqualified" (kun ryttere hvis peak er mindst transfer_quarantine_margin point over puljens 10.-bedste rytter uden for køberens hold) | "all" (alle erhvervelser, evne-blind indkøringsperiode). Ukendt værdi behandles som "off". Læses af backend/lib/transferQuarantine.js.'),
  ('transfer_quarantine_race_days', '0'::jsonb,
    '#2557 spor A: antal løbsdage i KØBERENS EGEN pulje som en karantæneramt rytter skal sidde over efter erhvervelsen. 0 = karantænen er slået fra uanset scope. Løbsdage tælles pulje-lokalt på scheduled_at, ikke i et globalt game_day-rum (game_day er pulje-relativt, se #3185).'),
  ('transfer_quarantine_margin', '10'::jsonb,
    '#2557 spor A: hvor mange evne-point over puljens 10.-bedste rival en nyerhvervet rytters peak skal ligge for at tælle som over-kvalificeret (kun scope="overqualified"). Peak = max over flat/climbing/sprint/time_trial/punch/cobblestone. 10 er sat mellem de målte regimer 3/8 og er IKKE harness-verificeret.'),
  ('transfer_quarantine_max_debuts_per_race_day', '0'::jsonb,
    '#2557 spor A: hvor mange karantæneramte ryttere fra SAMME hold der højst må debutere på samme løbsdag. Overskydende skubbes én løbsdag ad gangen (ældste erhvervelse først). 0 = ingen trappe. Retter præcis 30/7-mønsteret, hvor flere nyindkøb debuterede samtidig og tre puljer skiftede karakter samme døgn.')
ON CONFLICT (key) DO NOTHING;

-- Post-verify (read-only): fire rækker, alle i slukket tilstand.
--   SELECT key, value FROM public.app_config
--   WHERE key LIKE 'transfer_quarantine_%' ORDER BY key;
