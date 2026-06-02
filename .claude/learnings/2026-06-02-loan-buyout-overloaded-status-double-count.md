# Overloaded status enum → squad-cap double-count + fragile flush derivation (#19 audit)

**Dato:** 2026-06-02
**Fundet af:** pre-launch hærdnings-audit (multi-agent adversarisk review af commits merged sidste 48t).
**Rod-commit:** `a0e3300f` (#19 Del B — loans/buyouts uden for transfervinduet).

## Symptom

Tre koblede bugs i loan-buyout-windowing, alle fra samme commit:

1. **HIGH — squad-cap dobbelttælling.** En lukket-vindue buyout satte både `rider.pending_team_id = borrower` OG efterlod loan'en som `window_pending` med `to_team_id = borrower`. `getTeamMarketState` tæller pending-ryttere (via `pending_team_id`) *og* `window_pending`-loans separat → samme rytter talt to gange i `future_count`. Køber så 1 rytter større ud end virkeligheden og kunne fejlagtigt blokeres fra flere handler op mod division-cap. Self-healede ved vindue-åbning, men blokerede imens.
2. **MED — fragil flush-klassifikation.** `flushWindowPendingLoans` afgjorde buyout vs. loan ved at *aflede* fra `rider.team_id` (muteret i et separat, ikke-transaktionelt kald). Partiel fejl i rytter-flushen → betalt buyout nedgraderet stille til "active" loan; køber betalte, men ejede ikke rytteren.
3. **LOW — manglende clobber-guard.** Buyout overskrev `rider.pending_team_id` uden `.is("pending_team_id", null)`-guarden som transfer/swap-parkering bruger → kunne clobbe en konkurrerende parkeret handel (orphan double-spend).

## Rod-årsag

**Én overloadet status (`window_pending`) brugt til to semantisk forskellige tilstande:** parkeret loan-accept (rytter bliver på udlejer) og parkeret buyout (rytter skifter ejer). Fordi loan-recorden ikke kunne skelne de to, måtte downstream-kode *gætte* — enten via en anden datakilde (`rider.pending_team_id`, → dobbelttælling) eller via muteret state (`rider.team_id`, → fragil afledning).

## Fix

- Ny distinkt status `buyout_pending` (migration + schema CHECK). Parkeret buyout bruger den nu; parkeret accept bliver på `window_pending`.
- `getTeamMarketState`s loan-tæller forbliver `["active","window_pending"]` → `buyout_pending` ekskluderes naturligt (rytteren tælles via `pending_team_id`). Dobbelttælling væk.
- Flush klassificerer nu off `loan.status`, ikke `rider.team_id`. Intent persisteret på recorden → partiel fejl kan ikke nedgradere en buyout.
- Buyout claimer rytteren med atomicitets-guarden (`.eq("team_id", from_team).is("pending_team_id", null)`) FØR penge flyttes; 0-row → 409 uden debet.

## Læring (forward-guard)

- **Aflever ikke to tilstande på én enum-værdi.** Hvis to flows skal håndteres forskelligt downstream, skal forskellen være persisteret på recorden — ikke udledt af en sekundær, muteret datakilde. Samme klasse som write-then-derive-postmortems fra 2026-06-01.
- **Når en count tæller fra to kilder (her: `pending_team_id` + loan-status), tjek for overlap.** En rytter der optræder i begge er en dobbelttælling-fælde.
- Unit-test'en på `marketUtils.test.js` hard-asserter nu loan-filteret = `["active","window_pending"]` med en kommentar om hvorfor `buyout_pending` aldrig må tilføjes.
