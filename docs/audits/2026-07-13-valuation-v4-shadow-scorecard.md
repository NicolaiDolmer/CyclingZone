# Værdimodel v4 — shadow-scorecard + fund (#2428)

- **Dato:** 2026-07-13 (opdateret 14/7 — elite-præmie-retning)
- **Status:** SHADOW live (admin-preview). Ejer-review + tuning FØR cutover (slice 2). Ingen økonomi-ændring, ingen migration.
- **Spec:** [superpowers/specs/2026-07-13-rider-valuation-v4-production-value-design.md](../superpowers/specs/2026-07-13-rider-valuation-v4-production-value-design.md)
- **Regenerér:** `cd backend && node scripts/simulateSeasonProduction.js --k=30 --free-agents && node scripts/fitRiderValuationV4.js && node scripts/valuationV4Scorecard.js --out=<sti>` (READ-ONLY).
- **Model:** `backend/lib/riderValuationModelV4.json` · K=30 · discount=0,80 · alpha=1,0 · **elite-præmie** (afløser soft-loftet).

## Retning (ejer 14/7): eliten skal være UKØBELIG, ikke billig

Første iteration (soft-loft) klemte de store stjerner NED (v3 42-54M → v4 1-2M) — stik imod visionen. Ejer-retning: de enormt gode ryttere skal være uoverkommeligt dyre (ukøbelige i 3-4 sæsoner). Løsning: **elite-præmie** — en stejl konveks præmie over en overall-tærskel + et **gulv** for overall ≥ 58 (garanteret ukøbelig), kalibreret mod den ægte hold-økonomi.

**Hold-økonomi (verificeret):** rigeste hold 1,23M · sponsor 240k/sæson. Råd-loft over 4 sæsoner ≈ 4,1M. Elite-gulv = 2× loftet = 8,2M. Top-stjerne-mål = 20× loftet ≈ 82M.

## Resultat — de store stjerner er ukøbelige igen

| Rytter | Overall | v3 | v4 (nu) | Status |
|---|--:|--:|--:|:--|
| Carlos Lozano | 72 | 42,1M | 82,2M | ✓ ukøbelig |
| Marcos Ramírez | 71 | 53,8M | 68,4M | ✓ ukøbelig |
| Ayoub Bouazza | 70 | 45,0M | 42,2M | ✓ ukøbelig |
| Aitor Iglesias | 71 | 51,5M | 35,0M | ✓ ukøbelig |

Alle 21 ryttere med overall≥58 ligger ≥ 8,2M (langt over råd-loftet). Samlet rytterværdi: **+25%** (var −66% med soft-loftet). Medianen urørt (bulk = produktions-grundet).

## Gates (6/7 grønne)

| # | Gate | Status | Note |
|--:|---|:--:|---|
| 1 | Type-økonomi | ✅ rapport | puncheur/gc tjener mest, sprinter/tt mindst |
| 2 | Skala-kontinuitet | ✅ hård | median-drift +6,3% (≤±15%) |
| 3 | **Udvikl-og-sælg P&L** | ❌ hård | **ROI 172%** — se afvejning nedenfor (ejer-beslutning A/B/C) |
| 4 | Symmetri | ✅ rapport | 3 arketyper |
| 5 | **Elite ukøbelig** | ✅ hård | alle overall≥58 > råd-loft (billigste 8,2M, dyreste 86,5M) |
| 6 | Anker-sanity | ✅ rapport | ingen afvigelse |
| 7 | Determinisme | ✅ hård | reproducerbart |

## Åbne beslutninger til NÆSTE session

1. **Udvikl-og-sælg-afvejning (A/B/C):** ukøbelig elite ⟹ det er meget lukrativt (ROI 172%) at UDVIKLE et top-talent til elite (den eneste vej dertil). A) omfavn (hæv gate-loftet), B) dæmp, C) mål en typisk billig prospect i stedet. Ejer-anbefaling afventer.
2. **Løn-decoupling (NYT fund, ejer 14/7):** løn = market_value × 0,067 i dag. v4's fremtids-vægtede værdier ville hæve unge talenters løn (fx v4-værdi 5,56M → løn 373k/sæson > sponsor 240k). Løsning: løn baseres på **nuværende produktion/resultater** (ikke fremtids-NPV-værdien). Værdi = køb/salg-pris (fremtid); løn = ugeløn for nuværende levering. **Selvstændig økonomi-kritisk slice — egen sim/scorecard — skal shippe SAMMEN MED cutover.** Design + tal næste session.
3. **Q1-Q3 + elite-tuning** (gulv-mult, top-mult, overall-tærskler) — tunes ved cutover-review.
4. **Cutover (slice 2):** når 1-3 er afklaret → `predictBaseValue`→v4 + løns-model + migration (ejer merger).

Interaktiv v3-vs-v4-udforskning: **Admin → Økonomi → "Rytter-værdi v4"** (admin-login).
