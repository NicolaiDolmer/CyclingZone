# Plan B pre-flip engine-slice (#1441 Fase 3) — training-effekt LIVE + harness-bevis

> 2026-07-06 · **merge-gate for FACILITIES_ENABLED-flippet** (flip = separat ejer-beslutning).
> Harness: `backend/scripts/facilityInvestmentScorecard.js` (nu **6** gate-familier) + `inflationScorecard.js` + fresh/Gini-non-regression.
> Spec: `docs/superpowers/specs/2026-07-05-economy-fase3-empire-design.md` §2.1/§2.2/§5 + `2026-07-05-staff-richness-design.md` §2.
> Bygger på A2-kalibreringen (`2026-07-05-facility-investment-calibration.md`) + A4-rekalibreringen (`2026-07-05-staff-richness-a4-calibration.md`) — **INGEN kalibrerede konstanter ændret** i denne slice.

## Ejer-scope (design-runde 5/7) — status

| Q | Beslutning | Status i denne slice |
|---|---|---|
| **Q1 udvid util-modellen** (staff-løn skal bide) | Løst i A4 (#2216, merged): tier-skalaren erstattet af ability-drevet `staffEffectFactor(overall)` (0,5→1,0) + rating-drevet `staffSalaryFor(overall)`-lønkurve, harness-kalibreret (±15%-gate, ejer-valg). | ✅ Verificeret intakt — gates genkørt grønne her; intet at bygge. |
| **Q2 kommerciel = rent sink** | Payback ∞ i alle kombinationer (bevidst; Fase-4-merchandise er payoff-krogen). UI mærker det ("Pure sink · Phase 4 payoff"). | ✅ Genbekræftet (payback-gate grøn). `effectLive.commercial` forbliver `false` + advarsel skrevet ind i konstant-kommentaren: aldrig live uden Fase-4-motor + ny harness. |
| **Q3 wire training-effekten FØR flip** | **Bygget i denne slice** (var det manglende stykke — A4 leverede kun den rene hook-funktion, motoren kaldte den aldrig). | ✅ LIVE — se nedenfor. |

## Hvad blev bygget (Q3)

1. **Facilitets-magnitude:** `facilityTrainingMultiplier({facilityTier, staff}) = 1 + effectiveBonus("training", tier, staff)` (`staffTrainingBonus.js`) — PRÆCIS det tal Klub-UI'et viser som "Effect X% training". Ganges ind i `dailyAbilityDelta` sammen med den eksisterende per-rytter specialiserings-bonus (`staffTrainingBonus`, dimension×niveau).
2. **Motor-wiring:** `runTeamTrainingDay` loader nu holdets trænings-facilitet + aktive chef én gang pr. træningsdag via ny `lib/trainingStaffContext.js` (team_facilities/team_staff/staff_derived_abilities; self-heal-derivation hvis ability-rækken mangler; **best-effort** — en club-load-fejl kan aldrig vælte en træningsdag) og sender `{staff, facilityTier, riderLevel}` ind i hvert tick. `riderLevel` = `riderLevelBand({is_academy, age})` (youth/junior/senior → chefens niveau-affinitet).
3. **`EFFECT_LIVE_BY_TRACK.training = true`** (backend + preview-mock) → Klub-UI'ets effekt-kolonne skifter fra "target" til "live" for training. Øvrige spor forbliver ærligt "target".
4. **Ny harness-gate (6): training-live-wiring-paritet** i `facilityInvestmentScorecard` — kører den ÆGTE prod-kæde (`dailyAbilityDelta`) og beviser: uden club-kontekst = ratio PRÆCIS 1,0 (nul regression); facilitet uden chef = `1+effectiveBonus` ordret (t1 1,0150 … t5 1,0825); facilitet+chef = magnitude×specialisering (t5 m. o76-chef 1,2838); absolut loft 1,398 ≤ 1,165×1,4. Kører altid mod prod-konstanterne (uafhængig af `--config`) — det er wiring-bevis, ikke balance.

**Invarianter bevaret (bevist i tests):** caps udvides ALDRIG (cap-loopet klipper stadig; KRITISK-testen kører med max-bonus); hold uden faciliteter er bit-identiske med før (delta === baseline, engine-test tier-0 == baseline-score); træning straffer aldrig (multiplikator ≥ 1,0).

**Data-drevet, ikke flag-gated:** motoren læser blot team_facilities/team_staff — rækker findes kun for hold der har købt (kun muligt via flag ELLER A4b-admin-testgaten). Konsekvens: ejeren kan som admin verificere trænings-effekten på prod FØR flip. Ingen spiller kan have faciliteter før flip.

## Gate-resultater (faktiske kørsler, 2026-07-06, prod-konstanter)

| Gate-familie | Resultat |
|---|---|
| (1) Anti-optimal-path (±15%, ejer-valg) | ✅ 3/5 konkurrencedygtige i alle divisioner × alle leverage-scenarier (uændret fra A4: binding celle D3/×0,5 = 87,1%) |
| (2) Kommerciel payback ≥ 4 sæsoner | ✅ payback ∞ overalt (rent sink, Q2) |
| (3) Tid-som-valuta (§2.4) | ✅ 0,48 / 1,26 / 2,67 (uændret) |
| (4) Form-gates (§2.1-intent) | ✅ alle (uændret) |
| (5) Specialiserings-balance | ✅ specialist +14,0% (0,877 ∈ [0,85, 1,15]); symmetri 1,000; mismatch 0,930 (uændret) |
| (6) **NY: training-live-wiring-paritet** | ✅ alle 13 checks (se ovenfor) |
| Inflations-gate (coherence §6) | ✅ baseline 1,02–1,09× · 60%-adoption-floor 0,52 ≥ 0,5 (uændret) |
| Fresh-gate (`moneySupplyScorecard --synthetic-only`) | ✅ D1 +3.557 / D2 +13.557 / D3 +8.557 (uændret — wiring rører ikke økonomi-flows) |
| Gini (`prizeDistributionScorecard`, seed 2026) | ✅ exit 0 — D1 0,357 · D2 0,377 · D3 0,387 (identisk med A2/A4) |

**HEADLINE: facility-gates ✅ PASS — A2/A4/Plan-B-merge-gate opfyldt** (alle 6 familier).

**Fuld lokal verifikation (`scripts/verify-local.ps1`):** exit 0 — backend **2822/2822** pass · frontend **993/993** pass · frontend-build grøn. `npm run lint` (frontend): 0 errors (3 pre-eksisterende warnings i urørte filer). Test-diff: kun tilføjede tests + to A4-tests opdateret til at forvente facilitets-magnituden i kæden (ingen assertions fjernet/svækket); effectLive-testen strammet til "KUN training live".

## Størrelsesorden (spiller-oplevelse)

Trænings-multiplikator = `(1 + base[tier] × staffEffectFactor) × specialiserings-match`:
- T1 uden chef: +1,5% · T5 uden chef: +8,25%.
- T5 + tier-5-chef (o~81): ~+15% flad + op til ×1,199 ekstra på chefens matchede dimension×niveau (spec-cap 1,4 på matchen; teoretisk max-kombination +39,8%).
- Effekten forbedrer KUN udnyttelse under caps (#2082/#1938-akademi-caps + ability_caps respekteres — bevist i test).

## Ejer-flags (ingen blockers)

1. **Admin-holdet får trænings-effekten på prod fra merge** (data-drevet wiring + A4b-testgate). Det er den tilsigtede test-sti før flip — men vær opmærksom hvis admin-holdet konkurrerer i en division.
2. **A2/A4-flags står stadig** (staff-løn absolut små; t5-chef maks faktor 0,909; kommerciel rent minus-spor til Fase 4) — uændrede af denne slice.
3. Scouting/medical/academy-sporene er stadig "target" — deres motorer er egne slices (spec §2.1).

## Anbefaling

Plan B-gaten er opfyldt: alle 6 gate-familier + inflation + fresh + Gini grønne, og live-kæden beviser ordret det UI'et lover. **Flip-tjekliste (ejer):** (1) test som admin på prod (køb træningscenter → kør træningsdag → se løftet i rapporten), (2) `UPDATE app_config SET value='true'::jsonb WHERE key='facilities_enabled'`, (3) indsæt staged patch-note/help (`docs/superpowers/drafts/2026-07-05-facilities-flip-announce.md`).
