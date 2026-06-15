# Økonomi-korrekthed inden 20/6 — design + plan

> Design-doc · 2026-06-15 · ejer-direktiv: "Hele økonomien skal have et mindre rework og ordnes sådan det er korrekt inden 20/6."
> Søsterspor til UI-fladen ([2026-06-15-finance-flade-rework-design.md](2026-06-15-finance-flade-rework-design.md)). Dette spor = økonomi-LOGIK/balance; UI-fladen = visning.

## 1. Mål

Økonomien skal være **korrekt + spilbar** ved hard relaunch 20/6 (frisk sæson 1, fiktiv population). "Mindre rework" = målrettet korrektheds-pas, ikke redesign. Fire områder (ejer-valgt 15/6): værdi-model, lån/gæld, forecast, balance-følelse.

## 2. Audit-evidens (Fase 0 — read-only, 15/6)

Kørt: `npm run balance:check` (grøn), `npm run economy:baseline` (read-only mod prod), value-scorecard 10/6.

### 2a. Balance/cashflow — HOVEDFEJL
Kompetent hold under **nuværende regler** (sponsor 240k flat):

| Div | Sponsor/hold | Løn/hold | Netto/sæson | Efter én sæson |
|----|--:|--:|--:|--|
| D1 nu | 240.000 | 1.150.000 | **−750.000** | 800k → 50k (insolvent S2) |
| D2 nu | 240.000 | 650.000 | **−340.000** | bløder |

Kandidat `strict_fair_v1` (allerede i `economyBaselineSimulation.js`, simulér-bekræftet):

| Div | Sponsor/hold | Løn-rate | Netto/sæson | Efter én sæson |
|----|--:|--:|--:|--|
| D1 | 600.000 | ×0.67 | −10.500 | 800k → 789k (bæredygtig) |
| D2 | 400.000 | ×0.67 | +34.500 | overskud |
| D3 | 260.000 | ×0.67 | — | bæredygtig |

Gældsloft-kandidat: 1.2M / 900k / 600k (division-skaleret, mod 1.5M flat nu).

### 2b. Værdi-model
Real-population sund (10/6-scorecard: alle sanity-gates grønne, top-20 fornuftig, Pogačar 163M). Fiktiv snapshot-population (seed 2026, 800 ryttere): baroudeur-max 7,8M, pop-max 24M — #1231-hullet (>Pogačar) trigges IKKE i snapshot, men gaten mangler stadig som sikkerhedsskinne før ægte seed (#677 ikke kørt endnu; #676 race-motor CLOSED → #677 unblocked).

### 2c. Lån/gæld
- **#45** (priority:high, OPEN): mange små lån kan tilsammen overstige gældsloftet — TOCTOU-race i `backend/lib/loanEngine.js` (~L125). Fix = DB-constraint (Slice 07b).
- **#97** (OPEN, needs-decision): nødlån cross-season-spiral — hard-enforcement debt-ceiling. **Ejer-beslutning udestår.**

### 2d. Forecast
- **#986**: korrekt sæson-forecast (sponsor + præmie). Skal afspejle de nye konstanter efter 2a.
- **#784**: offentlig præmiepenge-oversigt (ejer-ønsket).
- **Verificér:** GAME_INVARIANTS siger `PRIZE_PER_POINT = 1.500`; sim-kommentar siger 15.000 (10×). Sandsynligvis stale kommentar — bekræft før forecast-tal stoles på.

## 3. Beslutninger truffet (ejer, 15/6)
- Balance-mål = **`strict_fair_v1` som start**, finjustér efter re-simulering.
- Økonomi-korrekthed er launch-scope (ikke post-launch).

## 4. Eksekverings-slices (rod → nedstrøms)

| Slice | Indhold | DB/migration | Verifikation |
|------|---------|:---:|---|
| **E1 · Værdi-gate** (#1231) | Baroudeur-anchors + hard-band i `riderValuationModel`-fit, så ingen type ekstrapolerer > top-anchor. **FØR #677-seed.** | Nej (model-JSON + fit) | `valuationScorecard.js` re-run grøn |
| **E2 · Balance-retune** (#986-konstanter) | `economyConstants.js`: sponsor division-skaleret (600/400/260k), løn-rate ×0.67, gældsloft 1.2M/900k/600k. Skal lande **før relaunch-seed**. | **Ja → ejer-merger** (loan_configs + evt. sponsor-config) | `economy:baseline` re-sim + `balance:check`-baseline-bump + **ejer-verify** |
| **E3 · Lån-bugs** | #45 DB-constraint mod loft-overskridelse. #97: ejer-beslutning → enforcement. | **Ja → ejer-merger** | constraint-test + loan-engine unit-tests |
| **E4 · Forecast** (#986/#784) | Forecast afspejler nye konstanter; præmiepenge-oversigt (#784). Overlapper UI-fladen. | Nej | forecast-enhedstest + ejer-verify mod scorecard |

UI-fladen (faner/primitiver) kører som **parallelt spor** (eget spec) — forecast-KORTETS placering uændret; interne tal rettes i E4.

## 5. MVP-cut for 20/6

**Launch-kritisk (skal):** E1 (gate før seed) + E2 (ellers er holdene insolvente) + E3/#45 (priority:high bug).
**Bør:** E4 forecast-korrekthed + #784-oversigt.
**Ejer-afklaring nødvendig før E3 komplet:** #97-enforcement-niveau.

## 6. Afhængigheder
- **Relaunch-orchestrator** (#1103/#1105): E1+E2 skal lande FØR orchestratoren seeder den fiktive population (#677), ellers seedes forkerte værdier/insolvent økonomi.
- **Løn-frysning #1309:** løn frosset ved signering; relaunch-seed re-signerer alle → løn-rate-skift lander rent på hele populationen.
- **Frontend præmie-kilde:** `frontend/src/lib/expectedPrizeCalculator.js` spejler backend-konstanter — sync ved E2/E4.

## 7. Risici
- Balance-retune er store håndtag (sponsor 2,5×, løn −33%) → re-simulér + ejer-verify FØR ship; ingen blind konstant-ændring (`feedback_simulate_before_ship_balance`).
- Konstant-ændring efter seed = re-seed påkrævet → rækkefølge-disciplin mod orchestratoren.
- DB/migration-PR'er auto-applies ved merge → **ejer merger** (ikke auto-merge).
