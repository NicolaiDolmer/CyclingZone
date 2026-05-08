# 2026-05-08 — Auktions-safety-pakke bundling (#192)

## Hvad

3 relaterede fixes på auktionssystemet shipped i ét PR (#199):
1. Owner-check på `PATCH /api/auctions/:id/proxy` — manager kunne sætte auto-bud på egen rytter via direkte API-kald (bid-endpoint havde guard, proxy-endpoint manglede den).
2. Logging på 5 silent error-paths — `try/catch` + `.catch(() => {})`-handlers swallowede fejl uden trace, hvilket gjorde proxy-resolver-bugs umulige at diagnosticere fra Railway-logs.
3. Discord DM-only-exhausted — mid-cascade DMs spammede managers hvis proxy step'ede op men stadig ledte. Vision-beslutning 2026-05-08: kun DM når bydende manager er endeligt overbudt.

## Hvad vi lærte

**Symmetriske endpoints kræver symmetriske guards.** Bid-endpoint og proxy-endpoint repræsenterer samme logiske handling (manager investerer i auktion på rytter), men proxy-endpoint blev tilføjet senere (v2.64) uden at spejle bid-endpoint's owner-check. Pattern at lære fra: når et nyt endpoint deler intent med et eksisterende, gennemgå guards systematisk i stedet for at skrive fra scratch.

**`.catch(() => {})` er en bug-magnet.** Mønstret findes flere steder i kodebasen som "fire-and-forget"-fejlhåndtering. Det gemmer reelle fejl bag en facade af succes. Default-mønstret bør være `.catch((e) => console.error("[ctx]", { meta, e }))` — fire-and-forget på _logging_, ikke på _stilhed_.

**Bundling efter fælles kontekst, ikke fælles fil.** De 3 fixes rørte 3 forskellige steder (route, lib, test) men delte alle proxy-bidding-domænet og var DX-trivielle enkeltvis. Ét PR gav lavere review-overhead end 3 separate. Tjek-listen for bundling: (a) deler de samme tests/setup? (b) ville delte PRs introducere merge-rebases? (c) er review-konteksten den samme?

## Mekanik

- 330 → 330 backend-tests grønne (3 DM-tests opdateret til nyt only-exhausted-mønster, ingen nye tests).
- Live verifikation udskudt til efter merge per Chrome MCP-scenarier i issue body — backend-only fix kan ikke testes uden 2 manager-konti samtidigt.
- Backend-only, ingen patch notes (acceptkriterie eksplicit).
