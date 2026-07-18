# Postmortem · 2026-07-18 · Intake-udløb satte 16 HOLD-EJEDE ryttere på auktion

## Hvad skete der?
Intake-udløbs-featuren (#2627/PR #2638) gik live med flag armeret. Boot-kørslen
udløb de 30 (reelt 2×30 pga. dobbelt boot) ældste 'offered'-intake-rækker og
satte rytterne på 24-timers ungdomsauktioner. **16 af rytterne var EJET af
menneske-hold** (Team Hansen, Bad At Names, Hardly Athletic m.fl.). Ejeren
opdagede det i UI'et. Ingen bud var nået ind; auktionerne blev annulleret uden
penge-/rytter-bevægelser, rækkerne afstemt, flaget slukket.

## Root cause (3 fejl)
1. **Status-felt ≠ virkelighed:** Sweepen stolede på `academy_intake.status='offered'`
   som bevis for at rytteren var fri. Men der FINDES forældede 'offered'-rækker
   hvis rytter siden er blevet ejet ad andre veje — det er PRÆCIS problemet
   `academyIntakeReconcile` (#1756) eksisterer for at reparere. Jeg læste
   reconcile-filen under implementeringen (den er citeret i agentens rapport!)
   men koblede ikke dens eksistensberettigelse til mit eget kandidat-filter.
2. **Ingen defense-in-depth:** `listRejectedAsYouthAuction` tjekkede heller ikke
   ejerskab — den stolede på at kalderen kun sender frie ryttere.
3. **Pr.-boot-kvote:** "30 pr. dagligt tick" var reelt "30 pr. proces-boot" —
   Railway bootede to gange ved deployet → 60 på én dag.

## Fix (PR fix/2627-ownership-guard-daily-cap)
- Sweep: rytter-ejerskab slås op FØR udløb; ejede/parkerede ryttere udløbes
  aldrig — deres forældede rækker AFSTEMMES med #1756-reglen (signed/rejected).
- `listRejectedAsYouthAuction`: kaster hårdt ved `team_id`/`pending_team_id` sat.
- Dagskvote: tæller allerede-udløbne i rullende døgn; boot-runs er budget-neutrale.
- Regressionstests for alle tre lag (10 sweep + 2 guard).

## Data-reparation (udført under hændelsen)
16 auktioner annulleret (0 bud, 0 penge, 0 team_id-ændringer — verificeret);
16+1 forældede intake-rækker afstemt til signed/rejected efter rytterens
faktiske ejerskab.

## Læring
1. **Et status-felt er en PÅSTAND, ikke virkelighed.** Før en mutation der
   flytter/eksponerer et aktiv: krydsvalidér mod den AUTORITATIVE tilstand
   (her: `riders.team_id`), især når der FINDES en reconcile-mekanisme for
   præcis den drift — dens eksistens ER beviset for at feltet kan lyve.
2. **Nye mutations-stier på delte aktiver skal have guard i BUNDEN** (den
   delte funktion), ikke kun i toppen — samme princip som #2617-lektionen
   fra tidligere samme dag, nu bidt fra den anden side.
3. **"Pr. kørsel"-caps skal ankres i data (rullende vindue), ikke i proces-
   livscyklus** — boot-runs, replicas og genstarter multiplicerer ellers kvoten.
4. **Ejerens hurtige opdagelse begrænsede skaden** — men dry-run-first for
   første kørsel af en ny masse-mutations-sweep havde fanget det før UI'et
   gjorde. Fremover: første kørsel af en ny sweep køres som read-only
   kandidat-liste der reviewes, FØR flaget armeres.
