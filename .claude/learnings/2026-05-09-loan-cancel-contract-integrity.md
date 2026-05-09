# Postmortem: lejeaftale kunne annulleres ensidigt (#156)

**Date:** 2026-05-09
**Shipped as:** v2.85 ([46cbf55](https://github.com/NicolaiDolmer/CyclingZone/commit/46cbf55))
**Issue:** [#156](https://github.com/NicolaiDolmer/CyclingZone/issues/156)
**Reporter:** jeppek (Discord, 2026-05-07)

## Symptom

"Man kan annullere en lejeaftale, uden modparten giver accept til dette." En `loan_agreement` med status `active` (begge parter har accepteret + lejegebyr betalt) kunne annulleres ensidigt af enten lender eller borrower via `Annuller lejeaftale`-knappen på TransfersPage.

## Rod-årsag

`backend/routes/api.js:2054-2062` (cancel-grenen i `PATCH /api/loans/:id`):

```js
if (action === "cancel" && ["pending","active"].includes(loan.status)) {
  await supabase.from("loan_agreements").update({ status: "cancelled" }).eq("id", loan.id);
  ...
}
```

`active` blev behandlet som om det var ækvivalent med `pending` (én-sidet status). Men `active` betyder "begge parter har accepteret kontrakten" — det er en bindende aftale.

Pattern-divergens mod transfer/swap: #13 introducerede separate admin-cancel endpoints for `window_pending` transfer/swap deals, og manager-cancel blev blokeret når begge parter havde confirmed. Loan-flow havde aldrig fået samme hærdning, fordi det er en simpler 2-state state-machine (pending → active) uden mellemstation som `awaiting_confirmation`.

## Hvorfor opdagede vi det først nu

- Loan-feature shipped tidligt i beta og havde lavere brugsvolume end transfers/auktioner.
- Discord-feedback (jeppek) trigger'ede issue 2026-05-07; #13 (transfer/swap-pendant) lukket samme dag — vi adresserede ikke loan-pendant samtidig pga scope-disciplin.
- Open beta launch 2026-05-08 → real-world brug af loans steg → bug ramte synlighed.

## Fix

**Backend:**
1. `getLoanCancelIssue()` helper i `backend/lib/transferExecution.js` — parallel til `getSwapCancelIssue` / `getTransferCancelIssue`. Returnerer `{ code: "loan_already_active" }` hvis status=active.
2. `PATCH /api/loans/:id` cancel-grenen splittet:
   - `pending` → tillad (uændret notify-flow)
   - `active` → returner 400 "Lejeaftalen er aktiv og kan ikke annulleres ensidigt — kontakt en admin."
3. Nyt `POST /api/admin/loans/:id/cancel` (requireAdmin):
   - Refunderer betalt `loan_fee` automatisk (balance-update + finance_transactions begge veje).
   - Sætter status=cancelled, notificerer begge parter.
   - Logger til `admin_log` med `action_type=loan_agreement_admin_cancel` + meta `{loan_id, prior_status, refunded_fee, reason}`.

**Frontend:** `TransfersPage.jsx:725-738` — fjernede "Annuller lejeaftale"-knap på active loans, erstattet med italic note "Aktive lejeaftaler er bindende og kan kun annulleres af en admin."

## Tests

`getLoanCancelIssue` unit-test i `transferExecution.test.js`:
- active → blokerer (`code: "loan_already_active"`)
- pending → tillader
- rejected → tillader (no-op)
- null input → tillader

372/372 backend-tests grønne.

## Lærepenge

1. **Pattern-symmetri tjek på domæne-grupper.** Da #13 hærdede transfer/swap-cancel for `window_pending`, burde loan-cancel være tjekket samtidig — de tilhører samme handel-domæne. Loan har simpler state-machine, men kontrakt-invariantet er det samme: én-sidet cancel kun før mutual agreement.

2. **Scope-discipline har omkostning når domæne-pendants overses.** En "én issue ad gangen"-tilgang er optimal i 90% af tilfælde, men når en bug-fix etablerer ny invariant (mutual-agreement-respect), skal pendant-domæner audites samtidig — ikke bare flagges som follow-up.

3. **Frontend-knapper skal matche backend-validering eller blive helt skjult.** "Annuller lejeaftale"-knappen blev efterladt synlig "fordi den ville fejle med 400 alligevel"-tankegangen er forkert UX: bruger skal ikke se en knap der ALDRIG virker. Skjul knap eller gør det til admin-kontakt-link.

## Forebyggelse

- [ ] Fremtidige cancel/withdraw bug-fixes: tjek alle handels-domæner (transfer/swap/loan) i samme PR for samme invariant.
- [ ] Code-audit for "symmetri" når nye admin-override endpoints introduceres — alle relaterede manager-flows bør også blokeres parallelt.
