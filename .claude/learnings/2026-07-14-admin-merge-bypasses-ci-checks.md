# admin-merge omgår IKKE-viste CI-checks — verificér ALLE grønne først

**Dato:** 2026-07-14 · **Kontekst:** #2428 værdimodel v4 slice 1.

## Hvad skete
`gh pr merge --admin` (brugt til at omgå branch-protection's review-krav for solo-dev-PR) omgik OGSÅ 3 fejlende required-checks jeg ikke havde set på merge-tidspunktet: `leak-check` (2 danske fejl-strenge i riderValuationFitV4.js), `ui-anti-drift` (2 emoji i ValuationV4PreviewSection.jsx), `perf-gate` (bundle 0,2 KB over loft pga. den nye admin-flade). De landede på main og dukkede først op i NÆSTE PR's CI.

## Rod-årsag
Da jeg tjekkede CI før merge, kiggede jeg kun på de checks der tilfældigvis var synlige/hurtige. `--admin` merger uanset check-status — den venter ikke og fejler ikke på røde required-checks.

## Læring / forward-guard
- FØR `gh pr merge --admin`: bekræft `gh pr checks <N>` viser **0 fail OG 0 pending** (ikke bare "de jeg så"). Vent på fuld grønt (baggrunds-poll: `until [ pending=0 ]; do sleep 20; done`).
- `--admin` er kun til at omgå review-KRAVET (solo-dev egen PR) — ALDRIG til at omgå fejlende checks.
- Efter et admin-merge der viste sig at omgå checks: kør checkene mod main-tilstanden og ryd op i samme session (jeg fixede alle 3 i opfølger-PR'en #2432).
- Relateret: [[feedback_vercel_fail_pull_errorcode]] (forklar rød check før merge), [[feedback_no_block_polling_ci]] (verificér lokalt, men CI-status ≠ lokal — required-checks skal stadig være grønne før merge).
