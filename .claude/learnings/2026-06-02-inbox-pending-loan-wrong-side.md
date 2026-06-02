# Inbox "Skal handles" viste pending lån til den forkerte part (#271 Slice A)

**Dato:** 2026-06-02
**Område:** backend/lib/inboxPending.js · loan_agreements action-authority

## Symptom
Tre flader viste de samme pending tilbud, men hver beregnede "kræver handling"
forskelligt, så badges divergerede. Specifikt for lån: Indbakke "Skal handles"
viste pending leje-anmodninger til det **anmodende** hold (borroweren), mens Min
Aktivitet og Transfers viste dem til **udlåneren**.

## Root cause
`inboxPending.js` hentede lån med `.eq("to_team_id", teamId)` (borroweren).
Men i lån-flowet (api.js):
- Borroweren (to_team) POSTer anmodningen → `loan_agreements` oprettes `pending`.
- Kun **udlåneren** (from_team, rytterens ejer) kan acceptere/afvise:
  `PATCH /loans/:id` kræver `isLender` for `accept`/`reject`.
- Borroweren har kun en *valgfri* cancel — ingen påkrævet beslutning.

Så inboxen viste lånet til den der bare ventede, og skjulte det for den der
skulle handle. ActivityPage/Transfers brugte allerede `lendingLoans` (from_team)
og var korrekte — derfor den tavse uenighed.

## Fix
- `inboxPending.js`: hent lån via `from_team_id=teamId`, role `lender_decide`,
  counterparty = `to_team` (anmoderen).
- Ny `useActionSummary()`-hook gør `/api/inbox/pending` til **én** kilde for alle
  action-badges, så fremtidige flader ikke gen-implementerer definitionen.
- Tests (inboxPending + riderHistory #105-guard) vendt til lender-side. #105's
  privacy-hensigt (lån synligt i inbox for den handlende part, skjult fra public
  historik) er bevaret — guarden valgte bare tilfældigt borroweren som part.

## Læring
Når en aggregering ("kræver handling", counts, badges) skal matche hvem der
**faktisk kan handle**, så aflæs sandheden fra **state-maskinen** (her: hvilken
rolle authorization-checket på mutationen kræver — `isLender`), ikke fra hvilket
team-id der intuitivt "ejer" rækken. Hører til klyngen
[[feedback_match_ui_filter_for_capacity_logic]]: tælle-/findes-logik skal bruge
samme diskriminator som den autoritative handling.

Forward-guard: enhver fremtidig action-badge skal læse fra `useActionSummary`
(frontend) / `getPendingInboxItems` (backend) — ikke gen-beregne pending-sider.
