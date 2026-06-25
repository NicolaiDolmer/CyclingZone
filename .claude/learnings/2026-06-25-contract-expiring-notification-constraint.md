# 2026-06-25 · Auktioner finaliserede aldrig: manglende enum-værdi i CHECK-constraint + u-bevogtet notifikation i ikke-atomisk finalize

**Issue:** [#1872](https://github.com/NicolaiDolmer/CyclingZone/issues/1872) · regression fra [#1836](https://github.com/NicolaiDolmer/CyclingZone/issues/1836) (v6.13)

## Symptom

9 auktioner på ét hold (LEGO-Vestas) stod "Udløbet" i UI men blev aldrig `completed`. Holdet var både sælger og højeste byder på sine egne ryttere (self-trades). Andre hold: 0 fastlåste.

## Rod-årsag

#1836 indførte notifikationstypen `contract_expiring`, men ingen migration udvidede `notifications_type_check`. Ethvert insert fejlede med 23514 — **0 `contract_expiring`-rækker var nogensinde landet i prod.**

`finalizeAuctionRecord` er **ikke atomisk**: den debiterer køber, krediterer sælger, flytter rytteren og sender "Du vandt"-notifikationen via separate RPC-/insert-kald, og kaster derefter på den u-bevogtede kontraktudløb-notifikation (`auctionFinalization.js`, #1836-køb-trigger) — **lige før** `status=completed` sættes. Cron'en (hvert 60. sek.) gen-kørte, ramte samme mur, og loopede.

Self-trade-mønsteret var et rødt sild: det gjorde blot at hver eneste af holdets ryttere havde `contract_end_season = 1` (= aktiv sæson) → triggeren fyrede hver gang. Enhver køber af en udløber-i-år-rytter (også via transfer) ville have ramt samme bombe.

## Hvorfor det ikke blev fanget

1. **#1836's tests injicerede `notify` (mock)** → den ægte CHECK-constraint blev aldrig motioneret.
2. **Sæson-stien fangede fejlen** (`emitContractExpiringNotifications` try/catch, `stats.failed++`) → tavst i prod. Kun de to køb-stier (auktion + transfer) var u-bevogtede.
3. **Cron-finalizerens `onError` lavede kun `console.error`** — ingen Sentry. Incident'en kørte ~25 min uden alarm.

## Fix (#1872)

1. **Migration:** `contract_expiring` tilføjet til constraint'en (rent additivt). Anvendt på prod via MCP → de 9 auktioner helede sig selv inden for 60 sek. Idempotensen i `increment_balance_with_audit` (UNIQUE idempotency_key inde i RPC-transaktionen) gjorde gen-finalisering sikker — verificeret: 2 tx/auktion, netto 0, ingen dobbelt-debitering.
2. **Defense-in-depth:** kontraktudløb-notifikationen wrappet i try/catch i **begge** køb-stier. Princip: en kosmetisk notifikation må aldrig kunne rulle en committet finansiel transaktion tilbage.
3. **Monitorering:** `sentryCapture` på cron-finalizerens `onError`.
4. **Forward-guard-test:** `finalizeAuctionById completes even if the contract-expiring notification throws`.

## Læring (generaliserbart)

- **Ny `type`/enum-værdi i kode ⇒ migration der udvider DB-constraint'en, i SAMME PR.** Grep efter `*_type_check` når du indfører en ny streng-konstant der skrives til DB.
- **Mock'ede tests beviser ikke DB-kontrakten** ([[feedback_test_real_endpoint_not_just_mocked]]). En insert med en ny enum-værdi skal motioneres mod ægte constraint mindst én gang.
- **Ikke-kritiske side-effekter (notifikationer, activity-feed, discord) skal aldrig kunne fælde en finansiel mutation.** Wrap dem, eller flyt dem efter den autoritative state-ændring.
- **Ikke-atomiske finalize-flows skal have idempotente retries** (de havde det for balance — men ikke for "nå frem til closeAuction").
- **Per-item `onError` i en cron skal til Sentry**, ikke kun stdout — ellers er en retry-loop usynlig.
