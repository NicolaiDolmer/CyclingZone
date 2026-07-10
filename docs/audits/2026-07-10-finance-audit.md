# Finance-audit 2026-07-10 (Fable)

Fuldt audit af finance/økonomi-backend + Finance-siden. Alle fund er konverteret til issues; dette dokument er indekset + ejer-beslutningerne.

> **Status 11/7: ALLE 7 issues shippet til prod** (v6.76–v6.80, PR #2312/#2314/#2316/#2319/#2322/#2324/#2325 + reset-FK-fix #2318; begge migrationer applied+verificeret). Opfølgninger: rente/hovedstol-split på repayment-posten (udskudt fra #2304, mangler issue) · balance-over-tid-graf (droppet stretch fra #2306) · `authenticated`-GRANTs på penge-RPC'er bør sikkerhedsreviewes. Læring: `.claude/learnings/2026-07-11-season-fk-must-ship-with-reset-handling.md`.

## Korrekthedsfejl → issues

| Issue | Fund | Prioritet |
|---|---|---|
| [#2300](https://github.com/NicolaiDolmer/CyclingZone/issues/2300) | Rå DB-nøgler i Historik (`academy_drift`, `facility_upkeep`, `staff_salary`) + lånerente uden `reason_code` → "Other" | High — FØR facilities-flip |
| [#2301](https://github.com/NicolaiDolmer/CyclingZone/issues/2301) | Nødlån ikke idempotent ved cron-genkørsel (pengeskabelse) | High |
| [#2302](https://github.com/NicolaiDolmer/CyclingZone/issues/2302) | `repayLoan` ikke-atomisk, uden idempotency-key | High |
| [#2303](https://github.com/NicolaiDolmer/CyclingZone/issues/2303) | Tvangssalg afdrager ikke gælden (fiktivt `runningDebt`-tal) | High |
| [#2304](https://github.com/NicolaiDolmer/CyclingZone/issues/2304) | Lånerente dobbelttælles i sæsonrapport | Med |

## UX-forbedringer → issues

| Issue | Fund |
|---|---|
| [#2305](https://github.com/NicolaiDolmer/CyclingZone/issues/2305) | Præmie-kort: all-time + klient-beregnet → sæson-scoped, server-side (mockup ejer-godkendt) |
| [#2306](https://github.com/NicolaiDolmer/CyclingZone/issues/2306) | Historik: sæson-filter på liste, kategori-filter, pagination; stretch: balance-over-tid-graf |

## Ejer-beslutninger (10/7)

1. **Lånerente:** kontant-effekt bogføres KUN ved betaling; påløbet rente vises synligt overalt (gældskort, lånekort, rapport-linje markeret ikke-kontant).
2. **Tvangssalg:** provenuet afdrager lånene direkte, ældste først.
3. **Nødlån:** maks 1 pr. sæson; gentagne nødlån eskalerer til bestyrelses-konsekvenser i stedet for mere gæld.
4. **Præmie-kort:** indeværende sæson primært, all-time som undertekst.

## Mindre fund (ikke egne issues — tages med hvor relevant)

- `season_id` kan være null på transfer/auktions-poster → usynlige i rapporter; kun DB-trigger `fill_finance_tx_season()` redder det (nævnt i #2302-scope-nabo).
- RPC tjekker ikke `p_delta == payload.amount` (guard foreslået i #2302).
- Admin beta-reset sætter balance uden ledger-post (accepteret drift-kilde, admin-only).
- Buyer/seller-par i transfers/auktioner er to RPC-kald med selvhelende re-finalize — accepteret design.
- Reserved balance beregnes klient-side (`FinancePage.jsx:204-223`) og gater repay — bør flyttes server-side ved lejlighed.
