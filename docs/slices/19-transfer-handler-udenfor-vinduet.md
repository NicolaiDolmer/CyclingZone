# Slice #19 · Handler udenfor transfervinduet (betal nu, registrér ved åbning)

**Status:** 📋 Planlagt 2026-05-31. Afventer pick-up. Plan godkendt af ejer via AskUserQuestion-session.

**Issue:** [#19](https://github.com/NicolaiDolmer/CyclingZone/issues/19) (parent). Folder ind: [#827](https://github.com/NicolaiDolmer/CyclingZone/issues/827) (garanteret salg flytter rytter mens lukket). [#828](https://github.com/NicolaiDolmer/CyclingZone/issues/828) lukket som duplikat af #19.

## Problem

Discord-feedback (bobby2106, 2026-04-30 + 2026-05-30): managers kan ikke byde på / handle andre holds ryttere når transfervinduet er lukket. Det opleves som en bug. Ønsket adfærd:

> "Det skal være muligt at byde/gennemføre/acceptere handler selvom vinduet er lukket, men selve rytterskiftet skal først ske, når vinduet åbner igen."

## Vigtig opdagelse (runtime-verificeret 2026-05-31)

Deferral-infrastrukturen findes **allerede delvist**:

- **Auktionsbud virker allerede udenfor vinduet.** Bud-ruten tjekker aldrig vindue-status. Finalization betaler ved afslutning (også når lukket) og parkerer rytteren på `pending_team_id`; `team_id` sættes først ved vindue-åbning. Se [auctionFinalization.js:256-313](backend/lib/auctionFinalization.js).
- **Direkte tilbud + swaps har en `window_pending`-status.** Hvis vinduet er lukket *ved bekræftelse*, parkeres handlen og eksekveres ved åbning via `flushWindowPendingOffers`. Se [transferExecution.js:638-650](backend/lib/transferExecution.js) + flush i [api.js:4516](backend/routes/api.js).
- **MEN:** den eksisterende `window_pending`-sti flytter *både penge og rytter* ved flush — ikke realistisk, og skaber "kan ikke betale ved flush"-fejl.
- **5 endpoints blokerer hårdt (403) ved oprettelse** når vinduet er lukket, så en forhandling kan slet ikke *startes*:
  - Direkte tilbud — [api.js:1532](backend/routes/api.js)
  - Listing til salg — [api.js:1445](backend/routes/api.js)
  - Legacy listing-tilbud — [api.js:1879](backend/routes/api.js)
  - Swaps — [api.js:1953](backend/routes/api.js)
  - Loans (accept/buyout) — [api.js:2253](backend/routes/api.js)

## Beslutninger (AskUserQuestion 2026-05-31)

1. **Scope:** Alle 5 handelstyper skal kunne igangsættes udenfor vinduet — auktionsbud, direkte tilbud, swaps, loans, listing til salg. Inkl. sælger-siden (liste/acceptere salg af egne ryttere). *(Sidste antagelse bekræftes ved pick-up — ejer pegede på "Listing til salg" i scope.)*
2. **Betalingsmodel:** "Som i virkeligheden" — **pengene flyttes med det samme ved aftale; kun rytter-registreringen (ejerskiftet) udskydes til vinduet åbner.** Saml alt på auktions-modellen.
3. **Annullering:** Bindende aftale. Når begge har bekræftet, er handlen låst. Kun admin kan annullere (findes allerede, [api.js:3050](backend/routes/api.js)).
4. **UI:** Tydeligt "parkeres til åbning"-banner; knapper aktive.

### Forward-tanke: fremtidige regnskabsfunktioner
Ejer vil senere bygge mere realistiske regnskabsfunktioner (ratebetaling, clausulaer, FFP). Design den parkerede handel som en **gennemført finansiel transaktion nu**, med rytter-registrering som det eneste udestående ikke-finansielle event. Så kan fremtidig betalings-mekanik lægges oven på `finance_transactions` uden at røre registrerings-flowet.

## Invarianter der beskyttes
- Betaling går aldrig til forkert hold (GUARDRAILS_CORE).
- Ingen dobbeltbetaling ved flush (pengene er allerede flyttet ved aftale → flush er rent ikke-finansielt).
- Ingen rytter forsvinder fra et hold mens vinduet er lukket (#827).
- Køber kan ikke binde samme penge i flere parkerede handler (pengene er reelt trukket ved aftale).

## Plan i faser

### Fase 1 — Backend-kerne: "betal nu, registrér senere"
1. Refaktorér `confirmTransferOffer` / `confirmSwapOffer`: ved lukket vindue →
   - bogfør betaling nu (køber −, sælger +) via `incrementBalanceWithAudit` med korrekt `season_id` + `idempotency_key`,
   - sæt `rider.pending_team_id`,
   - status `window_pending`.
   - Flush sætter herefter **kun** `team_id` (ingen pengebevægelse).
2. Fjern de 5 `403`-gates ved oprettelse (behold `assertMarketOpen` — market-pause er en separat, legitim spærring).
3. **Loans:** ny `window_pending`-sti (findes ikke i dag). Lejegebyr betales ved accept som nu ([api.js:2279-2333](backend/routes/api.js)); rytter-aktivering (rytter → lejer) parkeres og flushes ved åbning.
4. Udvid `flushWindowPendingOffers` til at dække loans. Verificér idempotens nu hvor pengene allerede er flyttet (flush må aldrig re-bogføre).

### Fase 2 — Håndhævelse (folder #827 ind)
5. Audit alle steder der sætter `team_id` mens vinduet er lukket — board mid-season "garanteret salg" ([boardMidSeason.js](backend/lib/boardMidSeason.js)), `squadEnforcement`-auto-salg. De skal respektere deferral, ellers forsvinder en rytter mens lukket (#827).
6. Squad-fuldt ved flush: behold soft-cap-buffer; hvis stadig over hard-cap efter åbning → eksisterende `squadEnforcement`-cron sælger ned (konsistent med dagens adfærd).

### Fase 3 — Frontend (banner)
7. "Vinduet er lukket — handlen gennemføres når det åbner [dato]"-banner på Transfers + Auctions. Knapper aktive. Bind til eksisterende `GET /api/transfer-window`.
8. Bekræftelses-dialog gentager udskydelsen. Parkerede handler er bindende (kun admin-cancel).
9. Player-facing copy: EN-først, DA-under. Tone-check mod `docs/TONE_OF_VOICE.md` før ny tekst.

### Fase 4 — Test + dokumentation
10. Backend unit-tests pr. type: opret → accept → confirm mens lukket → `window_pending` + penge flyttet + rytter parkeret; flush ved åbning → `team_id` sat + ingen dobbeltbetaling.
11. Regressionstest #827: garanteret salg mens lukket → rytter bliver på holdet til åbning.
12. PatchNotes (EN/DA) + `FEATURE_STATUS.md` (kontrakt-ændring: `window_pending` udvidet til loans, betalingstidspunkt flyttet).

## Out of scope
- Ratebetaling / clausulaer / FFP (separat fremtidigt arbejde — designes så det kan bygges ovenpå).
- #33 (salg under division-minimum i vinduet) — relateret, men egen issue.
- Ændring af selve auktions-finalization (er allerede den ønskede model).

## Åbne punkter til pick-up
1. Bekræft sælger-side-scope (liste/acceptere salg af egne ryttere mens lukket).
2. Beslut om #19 splittes i sub-issues pr. type, eller køres som ét epic med #19 som parent.

## Risiko og mitigation
- **Risiko:** Refaktor af `confirmTransferOffer` ændrer betalingstidspunkt → kan introducere dobbeltbetaling hvis flush stadig betaler. **Mitigation:** flush gøres rent ikke-finansielt + idempotency_key; unit-test asserter ingen finance_transaction ved flush.
- **Risiko:** Loans har ingen deferral i dag → ny sti kan divergere fra offers/swaps. **Mitigation:** genbrug samme `window_pending` + flush-mønster.
- **Risiko:** #827-håndhævelse rører board-engine (shared). **Mitigation:** `needs-contract`/`shared-refactor` → læs GUARDRAILS_CORE før edit.

## Estimat
2-3 sessioner (Fase 1+2 backend tungest; Fase 3 frontend let; Fase 4 test).
