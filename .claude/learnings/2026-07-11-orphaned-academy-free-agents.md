# 2026-07-11 — Forældreløse akademi-frie-agenter maskeret som "aldersgrænse på auktioner" (#2264)

## Symptom
Spiller-rapport: "cannot start an auction on riders 20 and under" (17/18/20 blokeret, 22 virkede). Lignede en aldersregel.

## Rod-årsag
Ingen aldersregel findes. Præcis 3 frie agenter (17, 18, 20 år) stod med `is_academy=true` + `team_id=NULL` — efterladt da et snyd-holds ryttere blev frigivet uden at nulstille flaget (admin-frigivelses-stier satte kun `team_id=NULL`). Auktions-gaten (#1824) afviser `is_academy` → fejlen "Academy riders are managed in your academy..." på frie agenter. Alders-mønstret var en artefakt af hvilke ryttere spilleren klikkede.

## Fix
- Datareparation: 3 ryttere `is_academy=false` (ejer-godkendt, kørt 11/7).
- `POST /api/admin/override-rider` + `betaResetService.resetBetaRosters` nulstiller nu `is_academy` ved frigivelse.
- Forward-guard: `verify-invariants.js` check `no_orphaned_academy_free_agents`.
- Bonus: frontend viste stadig auktions-knap på AI-ejede ryttere (backend blokeret siden 30/6) — skjult; `ai_rider_no_auction` i18n-key tilføjet (manglede i errors.json).

## Læring
1. **Spiller-formulerede mønstre ("alder ≤20") er hypoteser, ikke fakta** — verificér mod data før du leder efter en regel i koden. SQL-tværsnittet (alder × is_academy × ejerskab) + det faktiske screenshot fra Discord-tråden afgjorde sagen på minutter.
2. **Enhver sti der sætter `team_id=NULL` skal gennemgå HELE rytterens tilstand** (is_academy, pending_team_id, kontraktfelter) — flag der kun er gyldige i ejet kontekst skal nulstilles ved frigivelse.
3. Fejlbeskeder der antager kontekst ("your academy") forvirrer når invarianten brydes — guards mod ulovlig tilstand er vigtigere end pænere beskeder.
