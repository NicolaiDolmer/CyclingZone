# Postmortem: proxy-bidding stale winner-proxy edge case (#171)

**Date:** 2026-05-08
**Shipped as:** v2.68 ([0a73f1b](https://github.com/NicolaiDolmer/CyclingZone/commit/0a73f1b))
**Issue:** [#171](https://github.com/NicolaiDolmer/CyclingZone/issues/171)
**Reporters:** cybersimon + jeppek (Discord, 2026-05-07)

## Symptom

"Auto-bud følger ikke med op når andre byder markant over." Manager A satte proxy-loft 100K, modstander B bød manuelt 80K, men A's proxy reagerede ikke — selvom A.max var langt over B's bud.

## Rod-årsag

`proxyBidding.js:65-67` (challenger-overtager-grenen) brugte `getMinimumAuctionBid(winnerProxy.max_amount)` som ceiling for autoBidAmount.

Algoritmen antog winnerProxy.max ≥ currentPrice — sandt i ren proxy-vs-proxy ladder. Men når winner manuelt bød over eget proxy-loft (proxy 60K + manuelt 80K), blev winnerProxy stale: max=60K mens currentPrice=80K. Så autoBidAmount = min(challenger.max, 60K+1) = 60.001, hvilket tripper break-conditionen på line 78 (`autoBidAmount <= currentPrice`).

Resultat: A's proxy 100K placede aldrig counter-bid trods B's manuelle bid lå klart inden for A's loft.

## Hvorfor opdagede vi det først nu

- v2.64 (#10) shipped proxy-bidding 2026-05-07 morgen.
- 2 uafhængige reports samme aften (cybersimon + jeppek).
- v2.66 (#179) droppede 10%-rule + 1000-afrunding for at eliminere halvdelen af regression-clusteret som "wontfix-by-design".
- Antog at #171 ville forsvinde med v2.66, men edge casen var orthogonal — manuelt-bid-over-eget-proxy-loft scenariet bestod.
- Code-audit 2026-05-08 morgen afdækkede stale-proxy edge casen.

## Fix

```js
const effectiveWinnerProxy =
  winnerProxy && winnerProxy.max_amount >= currentPrice ? winnerProxy : null;
```

Filtrerer stale proxies som "ingen aktiv proxy". Challenger-overtager-grenen klamper desuden autoBidAmount til `>= minBid` via `Math.max(getMinimumAuctionBid(winnerProxy.max), minBid)`.

## Tests

Ny `backend/lib/proxyBidding.test.js` med 6 cases:
1. Test 1 fra acceptkriterier (A 100K vs B manuelt 80K → A bidet 80.001)
2. Test 2 fra acceptkriterier (A 100K vs B 200K → B leder ved 100.001)
3. Stale rod-årsag (A 100K vs B proxy 60K + manuelt 80K → A bidet 80.001)
4. Ingen challengers under minBid → no-op
5. Ekspireret auktion → no-op
6. Tre proxies pyramide (300K vs 200K vs 100K → top leder ved næsthøjeste + 1)

323/323 backend-tests grønne.

## Lærepenge

1. **Antagelser om invariants holder ikke når input-rummet udvides.** Proxy-bidding-algoritmen var korrekt under "alle bids går gennem proxies"-antagelsen. Manual-bid-over-eget-proxy-loft brød invariantet om at winnerProxy.max ≥ currentPrice. Tests dækkede ren proxy-vs-proxy ladder; ikke proxy + manual blanding.

2. **Tests fra dag 1 ved nye features.** v2.64 shipped uden test-fil for proxyBidding.js (fundet via `Glob: **/*proxyBidding*` returnerede kun source-fil). Test-fil først skrevet 2026-05-08 ved fix. Løsning: tilføj test-fil-tjek til CLAUDE.md eller pre-commit hook.

3. **Cluster-fix ≠ root-cause-fix.** v2.66 droppede 10%-rule troede #171 ville forsvinde. Root cause var en anden (stale proxy) — de delte symptom ("auto-by følger ikke med op") men havde forskellige mekanismer.

4. **Code-audit slår mock-test for kausal forståelse.** Direkte gennemlæsning af `proxyBidding.js:56-67` med pen-and-paper-trace afdækkede bug'en på <30 min. Mock-driven testing ville have krævet kendt scenarie.

## Forebyggelse

- [ ] Tilføj proxyBidding.test.js-pattern til andre lib/-filer der mangler tests (audit 2026-05-08).
- [ ] CLAUDE.md update? Overvej tilføjelse: "Nye `lib/`-filer kræver `<navn>.test.js` i samme PR."
- [ ] Code-audit-skabelon for komplekse algoritmer (resolver-loops, cron-tasks): pen-and-paper trace med edge cases før ship.
