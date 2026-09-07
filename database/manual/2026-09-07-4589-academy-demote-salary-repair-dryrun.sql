-- #4589 · Identifikation af ryttere ramt af "løn stiger ved akademi-demote"-
-- bugget FØR koden blev rettet (PR: fix/4589-salary-on-academy-switch).
--
-- KØRES IKKE AUTOMATISK. Ren SELECT (read-only) — INGEN UPDATE i dette script.
-- Ejer-gated: se "Hvorfor ingen automatisk reparation" nedenfor FØR du bruger
-- output til at rette enkelt-ryttere manuelt.
--
-- ─── Baggrund ───────────────────────────────────────────────────────────────
-- demote() (backend/lib/academyTransfer.js) genberegnede TIDLIGERE ubetinget
-- lønnen mod current_production_value × SALARY_RATE_PRODUCTION (0.35), også
-- for ryttere der allerede havde en komplet kontrakt. Efter #3989 (20/8) hævede
-- den sats markant, sprang en spirende ung rytters løn OPAD ved en akademi-
-- flytning i stedet for den ventede uændrede/rabatterede løn. Rapporteret af 3
-- spillere 1/9 (#4589). Koden er rettet i denne PR (resolveDemoteSalary).
--
-- ─── Hvem er ramt (fakta, ikke heuristik) ───────────────────────────────────
-- ENHVER rytter der modtog en 'academy_demoted'-notifikation FØR denne PR blev
-- merget fik sin løn ubetinget genberegnet af den daværende kode — det gælder
-- pr. definition alle rækker fundet nedenfor, IKKE kun dem hvis
-- salary/current_production_value-ratio ligner 0.35 i dag (ratioen drifter væk
-- fra 0.35 over tid, fordi current_production_value fortsætter med at ændre
-- sig efter demote-tidspunktet, mens lønnen forbliver frossen på det
-- genberegnede tal — ratioen i output er derfor kun kontekst, IKKE et filter).
-- Den eneste reelle usikkerhed er om en given rytter reelt manglede en
-- kontrakt PÅ DEMOTE-TIDSPUNKTET (så genberegningen var korrekt selv i den
-- gamle kode) — men GAME_INVARIANTS.md's invariant "ejede ryttere har ALTID en
-- komplet kontrakt" gør den situation usandsynlig for en allerede-ejet
-- U23-senior. Antag derfor at ALLE rækker nedenfor er reelt ramt, medmindre
-- ejeren ved bedre om en konkret rytter.
--
-- ─── Hvorfor ingen automatisk reparation ───────────────────────────────────
-- Der findes INGEN løn-historik-tabel i skemaet (verificeret mod
-- database/schema-snapshot.json 7/9: ingen salary_history/rider_salary_log).
-- demote() SKREV den nye løn direkte over den gamle uden at gemme et før-
-- billede nogen steder (rider_ownership_events logger ejerskabsskifte, ikke
-- løn). Vi kan derfor IKKE algoritmisk genskabe "den løn rytteren ville have
-- haft, hvis fixet havde været aktivt ved demote-tidspunktet" — kun
-- IDENTIFICERE hvilke ryttere der ramte stien, som grundlag for en
-- ejer-beslutning pr. rytter.
--
-- MÅLT 7/9 (skal give omtrentligt samme tal ved kørsel — ellers er noget
-- ændret siden, undersøg før du bruger output):
--   24 academy_demoted-notifikationer siden 28/8 i alt.
--   19 af de ryttere er STADIG is_academy=true i dag (resten er siden
--      promoveret tilbage eller frigivet igen) — dette er review-populationen.
--   4 af de 19 har et forudgående trade/swap-event inden for 2 dage — det
--      konkrete "handlet + akademi-placeret"-mønster spillerne rapporterede,
--      heriblandt rytteren fra selve issuet (22.035 CZ$, række med
--      preceding_ownership_event='swap' og demote_notified_at 2026-09-01).
--
-- ─── Mulige ejer-veje (vælg pr. rytter, IKKE bulk) ─────────────────────────
--   A) Lad lønnen stå (rytteren har måske allerede indrettet sig efter den).
--   B) Sæt lønnen manuelt til et skøn af "hvad den ville have været uændret"
--      — kræver at ejeren selv vurderer/spørger spilleren, da vi ikke har det
--      historiske tal.
--   C) Refunder differencen som engangs-kompensation via finance_transactions
--      i stedet for at ændre selve kontrakten (bevarer nutidens økonomi-
--      invarianter, rører ikke riders.salary).
--
-- Forward-guard: fixet forhindrer at FLERE ryttere rammes fremover. Dette
-- script er kun et engangs-udsnit af den historiske skade siden 28/8 — kan
-- være en undervurdering, da demote-RPC'en har eksisteret siden 25/6 og
-- notifikationer ældre end 28/8 ikke er talt med her.
--
-- ─── CodeRabbit (PR #4973, 🟠 MAJOR) ────────────────────────────────────────
-- Den oprindelige version JOIN'ede direkte mod notifications (én række pr.
-- matchende academy_demoted-notifikation) OG mod rider_ownership_events (én
-- række pr. matchende trade/swap). En rytter med flere demote-notifikationer
-- i vinduet ELLER flere kvalificerende ownership-events i 2-dages-vinduet fik
-- derfor FLERE rækker, og count(*) kunne overvurdere populationen og komme ud
-- af trit med resultatsættet. Fixet: `demoted_riders` afgrænser populationen
-- til ét rider_id pr. række (DISTINCT), og to LATERAL-joins vælger
-- deterministisk NETOP ét notifikations- og ét ownership-event pr. rytter
-- (seneste academy_demoted-notifikation i vinduet; seneste kvalificerende
-- trade/swap før netop den notifikation). Begge queries nedenfor gentager den
-- samme `demoted_riders`-CTE, så hver forbliver selvstændigt kørbar (samme
-- forudsætning som resten af filen — ingen delt transaktion antaget).

-- ── Review-population (ALLE ryttere stadig i akademiet der blev demotet
--    siden 28/8) — kør denne, læs output, tag INGEN handling herfra ─────────
WITH demoted_riders AS (
  SELECT DISTINCT r.id
  FROM riders r
  JOIN notifications n
    ON n.related_id = r.id
   AND n.type = 'academy_demoted'
   AND n.created_at >= '2026-08-28'
  WHERE r.is_academy = true
)
SELECT
  r.id AS rider_id,
  r.firstname,
  r.lastname,
  r.team_id,
  t.name AS team_name,
  r.salary AS current_salary,
  r.current_production_value,
  round(r.salary::numeric / nullif(r.current_production_value, 0), 4) AS salary_to_cpv_ratio_context_only,
  latest_notif.created_at AS demote_notified_at,
  preceding_event.reason AS preceding_ownership_event,
  preceding_event.occurred_at AS preceding_event_at
FROM demoted_riders dr
JOIN riders r ON r.id = dr.id
LEFT JOIN teams t ON t.id = r.team_id
JOIN LATERAL (
  -- Deterministisk: seneste academy_demoted-notifikation i vinduet for denne rytter.
  SELECT n.created_at
  FROM notifications n
  WHERE n.related_id = r.id
    AND n.type = 'academy_demoted'
    AND n.created_at >= '2026-08-28'
  ORDER BY n.created_at DESC
  LIMIT 1
) latest_notif ON true
LEFT JOIN LATERAL (
  -- Deterministisk: seneste kvalificerende trade/swap før netop den notifikation.
  SELECT roe.reason, roe.occurred_at
  FROM rider_ownership_events roe
  WHERE roe.rider_id = r.id
    AND roe.reason IN ('trade', 'swap')
    AND roe.occurred_at <= latest_notif.created_at
    AND roe.occurred_at >= latest_notif.created_at - INTERVAL '2 days'
  ORDER BY roe.occurred_at DESC
  LIMIT 1
) preceding_event ON true
ORDER BY latest_notif.created_at DESC;

-- ── Kontroltal ───────────────────────────────────────────────────────────
WITH demoted_riders AS (
  SELECT DISTINCT r.id
  FROM riders r
  JOIN notifications n
    ON n.related_id = r.id
   AND n.type = 'academy_demoted'
   AND n.created_at >= '2026-08-28'
  WHERE r.is_academy = true
)
SELECT
  count(*) AS review_population_is_academy_true,
  count(*) FILTER (WHERE preceding_event.reason IS NOT NULL) AS with_preceding_trade_or_swap
FROM demoted_riders dr
JOIN riders r ON r.id = dr.id
JOIN LATERAL (
  SELECT n.created_at
  FROM notifications n
  WHERE n.related_id = r.id
    AND n.type = 'academy_demoted'
    AND n.created_at >= '2026-08-28'
  ORDER BY n.created_at DESC
  LIMIT 1
) latest_notif ON true
LEFT JOIN LATERAL (
  SELECT roe.reason
  FROM rider_ownership_events roe
  WHERE roe.rider_id = r.id
    AND roe.reason IN ('trade', 'swap')
    AND roe.occurred_at <= latest_notif.created_at
    AND roe.occurred_at >= latest_notif.created_at - INTERVAL '2 days'
  ORDER BY roe.occurred_at DESC
  LIMIT 1
) preceding_event ON true;
