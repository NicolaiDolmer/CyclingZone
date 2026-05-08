# 2026-05-08 — Reserved-balance ignorerede proxy-forpligtelse (#193)

## Hvad

Proxy-bidding (#10) shippet 2026-05-07 introducerede en ny tabel `auction_proxy_bids` hvor managers kunne sætte et max-loft højere end deres aktuelle bud. Men `reservedBalance`-validering i bid-endpoint og POST `/api/auctions` blev ikke opdateret — den summerede stadig kun `current_price` for auktioner manageren ledte. Konsekvens: manager med 200K proxy på en 50K-auktion havde reelt forpligtet 200K, men systemet regnede 50K → mulig over-commitment hvor bud accepteres som senere fejler i finalization.

Fix: ny pure helper `computeReservedBalance` i [auctionRules.js](backend/lib/auctionRules.js) bruger `MAX(current_price, own_proxy_max)` per leading-auction. Stale proxies (max < current_price) regner med current_price siden de ikke længere kan overbyde manuelt-budt pris.

## Hvad vi lærte

**Nye state-bærende features kræver audit af alle eksisterende validerings-callsites.** Proxy-bidding tilføjede en ny "skygge-forpligtelse" — manageren har lovet at byde op til `max_amount`, ikke bare `current_price`. Den oprindelige feature-implementation rørte ved auktions-flow, notifikationer og UI, men ramte aldrig listen af steder hvor balance bliver valideret. Tjekliste-mønster fremover: når en feature introducerer en ny "implicit forpligtelse" (proxy-loft, pending-aftale, reserved-køb), grep alle steder der bruger `teamBalance`/`balance` til validering og opdater dem som del af samme PR.

**Samme mønster som #192.** Det er anden gang på 2 dage at proxy-bidding-shippet (#10) afsløres at have efterladt asymmetri:
- #192: PATCH `/proxy` manglede owner-check som bid-endpoint havde
- #193: balance-validering ignorerede proxy-forpligtelse

Begge er "ny endpoint/state, men eksisterende guards/validering ikke spejlet". Lære-aggregat: **shippet feature == kodebase-audit, ikke kun ny kode**. Når en stor feature går live, åbn en explicit "audit-PR" der grepper for alle eksisterende patterns der nu kan være ufuldstændige (guards, validering, notifikationer, RLS).

**Pure helper > inline reduce gør tests trivielle.** Den oprindelige inline `activeLeading.reduce((sum, row) => sum + (Number(row.current_price) || 0), 0)` var hverken let at teste eller genbruge. Ekstraktion til `computeReservedBalance({ leadingAuctions, proxiesByAuctionId })` gjorde 6 nye tests til en 5-min øvelse — og samme helper bruges nu fra 2 callsites uden duplikering.

## Mekanik

- 330 → 336 backend-tests grønne (6 nye `computeReservedBalance`-tests dækker 3 issue-scenarier + kombineret total + integration mod `getAuctionBidIssue` + tom-input).
- Backend-only, ingen patch notes (acceptkriterie eksplicit — intern korrekthed-bug, ikke bruger-synlig adfærdsændring før manager rammer scenariet).
- Live verifikation udskudt til managers — kræver 3+ samtidige aktive auktioner med specifik balance/proxy-state, kan ikke verificeres uden multi-manager-koordination eller dedikeret test-konto.
