# 2026-05-26 — AuctionsPage mobile smoke-flake (#646)

## Symptom
`mobile-chromium` kunne fejle på `/auctions` i `core-smoke.spec.js` med en stor snapshot-diff. Baseline-repro var 1/20 fail og matchede issue-observationen med 103.128 forskellige pixels.

## Rod-årsag
Smoke-testen ventede kun på route heading og `main`, men AuctionsPage havde stadig en specifik async sluttilstand: loader væk, `Aktive (1)` data loaded, default-filter `Min situation (0)`, og tom-state tekst synlig. Uden den route-specifikke readiness gate kunne screenshot-baselinen lande på en timing-afhængig mellemfase i stedet for den deterministiske mock-sluttilstand.

## Læring
For E2E-snapshots af data-drevne sider er generisk heading/main-readiness ikke nok. Testen bør vente på den samme brugerobserverbare sluttilstand som fixture-data forventer, og snapshot-baselines bør først opdateres efter readiness er gjort deterministisk.
