# Økonomi-facilitations-brief (#1607 + #1441)

> **Formål:** strukturere ejerens kommende økonomi-design-session i beslutnings-rækkefølge.
> **Status:** FACILITATION — ingen beslutning truffet her, ingen kode/konstanter ændret.
> Dato: 2026-06-21. Refs #1607 (præmie-niveau), #1441 (epic: langsigtet økonomi), #1611 (harness, MERGED), #97 (gæld).
> Læs sammen med: `docs/superpowers/specs/2026-06-15-okonomi-korrekthed-design.md`, `backend/lib/moneySupplyScorecard.js`, `backend/scripts/prizeDistributionScorecard.js`.

---

## 0. TL;DR

To målte fakta rammer samtidig og peger på det samme: **omkostningssiden er ikke kalibreret mod den faktiske præmie.**

1. **Præmien er 12–25× højere end income-modellens gæt** (målt, #1611) — på tværs af alle divisioner og robust over 4 seeds.
2. **Alligevel er median-holdets net/sæson negativ i ALLE tre divisioner** (D1 −372k · D2 −367k · D3 −323k) — fordi løn-/upkeep-siden er tunet mod en ~316k-indkomst, mens et reelt opbygget hold bærer millioner i løn.

Det er ikke ét tal der er forkert; det er at **sources og sinks aldrig er målt mod hinanden på samme population**. Derfor er den rigtige rækkefølge: kortlæg sources↔sinks-balancen FØR man drejer på en enkelt knap. Denne brief leverer tallene + beslutnings-rækkefølgen, ikke svaret.

---

## 1. De målte tal (#1611 prize-distribution-scorecard)

100% syntetisk, ingen live-DB. Marked = `generateLaunchPopulation` (800 ryttere) gennem den ægte værdi-kæde; 22 manager-hold stratificeret i 3 styrke-lag; hvert løb kørt gennem den ægte `buildRaceResults` + ægte UCI-point-kurve; `prize = points × 1.500`; kun manager-rytternes andel udbetales; sæson-1-kalender (ProSeries-only, ~60 løbsdage).

| Division | Income-modellens gæt | **Målt median-præmie** | Faktor | Net/sæson (p10 / median / p90) |
|---|---|---|---|---|
| D1 | 160.000 | **2.896.500** | **18,1×** | −1.823k / **−372k** / +66k |
| D2 | 70.000 | **1.678.500** | **24,0×** | −1.488k / **−367k** / +443k |
| D3 | 25.000 | **333.000** | **13,3×** | −541k / **−323k** / −199k |

**Læsning:**
- Præmien er den dominerende indtægtskilde for et kompetent hold — ikke sponsor. Gættet (160k/70k/25k) i `moneySupplyScorecard.js:54` er en størrelsesorden for lavt.
- Trods den høje præmie er median-net negativ overalt → **omkostningssiden (løn + upkeep) er for tung relativt til den faktiske income**, ELLER præmie-niveauet skal ned, ELLER begge. Det er præcis den fork sessionen skal afgøre.
- **Konservativ måling:** sæson-2+ med WorldTour-klasser har 10–100× større puljer → divergensen forværres uden indgreb (#1607's "GC-domineret skema = primær langtids-divergens-motor").

**Vigtigste usikkerhed:** roster-styrke er det blødeste input og præmien er meget følsom for det. Stratificeret draft = jævnere hold end virkelige (ujævne) managere. Tallene er retnings-robuste (12–25× over 4 seeds), ikke præcisions-tal.

---

## 2. Beslutnings-rækkefølge (fundamental fork først)

Ejer-princip (#1441): "ikke flere band-aids — en langsigtet, sammenhængende, lav-inflations-økonomi." Det betyder at knapperne skal drejes i afhængigheds-rækkefølge, ikke isoleret.

```
(A) Sources↔sinks-balance   →  (B) Sponsor-model   →  (C) Præmie-niveau+fordeling   →  (D) Gæld #97
    "hvad er mål-net pr.         "base + performance,    "niveau vs. fordeling             "hvad sker når
     division pr. sæson?"         forhandlbar?"           (to separate knapper)"            net er vedvarende −?"
```

Hvorfor netop denne rækkefølge:
- **(A) først** fordi præmie-niveau (C) ikke kan sættes meningsfuldt uden et mål-net. Hvis mål-net for et median-hold er fx [0; +0,3× start], så er −370k for langt under, og man ved IKKE om løsningen er mindre præmie eller mere sink før balancen er defineret.
- **(B) før (C)** fordi sponsor er den anden store source; hvis sponsoren bliver performance-koblet/forhandlbar (#1441 vision), ændrer det hvor meget præmien skal bære.
- **(D) sidst** fordi gæld kun er meningsfuld når den vedvarende net-bane er kendt (gæld er symptom på source/sink-ubalance, ikke årsag).

---

## 3. Knap-katalog (input til sessionen — ikke anbefalinger)

### A. Sources↔sinks-balance (#1441 kerne)
- **Mål-kurve:** definér mål-net pr. division pr. sæson + en samlet pengemængde-kurve over N sæsoner (lav inflation). Uden dette er alt andet gætværk.
- **Eksisterende sinks:** løn (`economyConstants`, frossen 6,7% ved signering efter E2 #1438), upkeep.
- **Ejer-nævnte NYE sinks (#1441):** personale/staff, facilitets-opgraderinger, evt. gebyrer/vedligehold. "Penge skal forlade økonomien fra tid til anden."
- **Måle-værktøj findes:** `moneySupplyScorecard.js` (net = sponsor − upkeep − løn + præmie) + `prizeDistributionScorecard.js` (præmie). En inflations-scorecard (total pengemængde over tid mod mål-kurve) mangler — kandidat til at bygge FØR ship (simulér-før-ship).

### B. Sponsor-model
- **I dag:** sæson-1 division-skaleret (600/400/260k, E2); sæson-2+ flad `VARIABLE_SPONSOR_BASE = 2.500.000` (band-aid 2026-06-08, nu ren inflation efter E2 fjernede rod-årsagen — #1439).
- **Ejer-principper:** ingen auto-eskalering; lav inflation tidligt; rigtige (forhandlbare) sponsorer senere.
- **Interim (afkoblet, ingen migration, spores #1439):** de-inflatér sæson-2-basen så frisk population ikke floder ved S2.

### C. Præmie (to SEPARATE knapper — #1607, ændr ikke begge blindt)
- **NIVEAU:** målt median-præmie (2,9M/1,7M/0,33M) er 12–25× gættet. Hvis mål-net (fra A) kræver det → sænk `PRIZE_PER_POINT` (fx 1.500→1.000 = −33%) ELLER hæv upkeep. Hvis median-net allerede er på mål → rør IKKE (selv-korrigerende, ship godt-nok).
- **FORDELING:** TdF-GC rank 1-60 = 8.735 af ~12.900 pts → top-tungt → primær langtids-divergens-motor. Fladere kurve (komprimér GC rank 1-10, flyt vægt mod etapesejre + holdklassement) dæmper divergens uden at fjerne sejr-belønningen.
- **NB markeds-selv-korrektion:** `base_value`/markedet glider selv mod data (#1101) → over-kalibrér ikke initialt.

### D. Gæld (#97)
- Når median-net er vedvarende negativ (som målt), hvad er konsekvens-modellen? Gældsloft (D1 1,2M efter E2), negativ rente, nødlån — hvordan interagerer de med den nye balance? Designes sidst.

---

## 4. Simulér-før-ship-gate (gælder hele økonomien)

Per [[feedback_simulate_before_ship_balance]]: enhver ændring valideres empirisk mod fiktiv population + mål-scorecard FØR ship.
- Præmie-ændring: `prizeDistributionScorecard` + `prizeDistributionScorecard`'s acceptkriterier (#1607): median 5-sæsons balance-trajektorie i [0,8× ; 1,3×] start; ingen division median-net < −30k.
- Inflation: byg en pengemængde-over-tid-scorecard mod mål-kurven (mangler).
- Selv-korrigerende systemer (base_value-glidning) ship'es plausibelt + glider — ikke perfekt initial-kalibrering ([[feedback_ship_and_let_self_correcting_systems_glide]]).

---

## 5. Hvad denne brief IKKE gør

- Foreslår ikke et præmie-tal, en sponsor-model eller et sink-niveau. Det er ejerens session (#1441 design-session, brainstorm i beslutnings-rækkefølge).
- Rører ingen konstanter. `economyConstants.js`, `PRIZE_PER_POINT`, `VARIABLE_SPONSOR_BASE` er uændrede.
- Erstatter ikke #1607's acceptkriterier eller ejer-godkendelse før ship.

**Næste skridt (ejer):** kør design-sessionen i rækkefølgen A→B→C→D; definér mål-net-kurven (A) først; brug §1-tallene som empirisk grundlag.
