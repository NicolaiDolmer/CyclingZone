# Op-/nedrykning — gennemregnet design (#1152, #1745/#1760)

> **Status:** model EJER-BESLUTTET 23/6 + simuleret/valideret. Afventer kun go til build.
> **Harness:** `scripts/dev/sim-promotion-relegation.mjs` (reproducerbar; `node scripts/dev/sim-promotion-relegation.mjs`).

## 1. Beslutninger (ejer, 23/6)
- Op/nedrykning **aktiveres nu** — intet låst (fjern `FIRST_PROMOTION_RELEGATION_SEASON`-gate).
- **Vises som aktiv** (#1760's per-pulje-visning er korrekt; backend skal følge den).
- **Model = binær-træ-pyramide** (se §3). **Entry = Div3, erstat AI** (maks 24/pulje). **Div4 udskydes** indtil en Div3-pulje kun er ægte managere.

## 2. Faktisk udgangspunkt (prod 2026-06-23, sæson 1 dag 0)
| Division | Puljer | Ægte | AI | Note |
|---|---|---|---|---|
| Div 1 | 1 | 0 | 24 | +4 frosne/test (28 total — ryddes) |
| Div 2 | 2 | 0 | 24/pulje | fuld AI |
| Div 3 | 4 | **26** | ~18/pulje | alle ægte hold er her |
| Div 4 | 8 | 0 | 0 | tom (dormant) |

## 3. Modellen (binær-træ)
Hver pulje har **1 forælder** (tier over) + **2 børn** (tier under): `forælder(T,i)=(T-1, ⌊i/2⌋)`, `børn(T,i)=(T+1, 2i),(T+1, 2i+1)`. Strukturen 1/2/4/8 er et perfekt binært træ.
- **OP:** hver pulje rykker **top 2** op til sin forælder → 2 søsterpuljer × 2 = **4 op samlet** i forælderen.
- **NED:** hver pulje relegerer **bund 4**, **delt 2+2** ud i sine to børne-puljer.
- **Kanter:** Div1 rykker ikke op; Div4 rykker ikke ned. Relegering til en *dormant* tier (Div4) udskydes.
- **Balancerer eksakt:** hver pulje har ind = ud i steady state (Div1: ±4; midter-puljer: ±6; Div4: ±2). AI-fyld (`reconcileAiTeamsForPool`, #1739) holder enhver pulje på 24.
- **Div4-aktivering: per pulje** — en Div3-puljes to Div4-børn åbnes når *den* Div3-pulje kun er ægte managere (ikke når hele Div3 er fuld). Entry går til Div3 indtil en pulje er fuld, derefter til dens (nu aktive) Div4-børn.

## 4. Validering (simuleret, 12 sæsoner, snit af 5 seeds, skill-baseret klatring)
| Vækst | Overflow (pulje >24 ægte) | Div4 åbner | Vurdering |
|---|---|---|---|
| Ingen (kun 26) | **0** | aldrig (Div3 fyldes ej) | stabil |
| +8/sæson (→122) | **0** | aldrig i 12 sæsoner | stabil — realistisk |
| +20/sæson (→266) | 66 (max pulje ~31-38) | sæson 1 | kapacitets-grænse, ikke counts-fejl |

**Konklusion:**
- Modellen **balancerer matematisk** og er **0-overflow ved realistisk vækst (≤+8/sæson)**.
- Per-pulje Div4-aktivering er klart bedre end "vent til hele Div3 fuld" (overflow 104→66, Div4 åbner sæson 1 ikke 8).
- Den resterende overflow ved **+20/sæson** er en **kapacitets-grænse**: Div3's 96 entry-pladser kan ikke absorbere 20 nye/sæson i det uendelige. Det løses ved at udvide pyramiden (flere puljer/tiers) — **skalerings-epic #1608**, ikke denne opgave. Overflow-tælleren bliver i øvrigt et naturligt **signal** for hvornår #1608 skal trækkes.

## 5. Anbefaling
Byg ejer-modellen som beskrevet (binær-træ, op 2 / ned 4-delt, entry Div3-erstat-AI, **per-pulje Div4-aktivering**). Sikker for realistisk vækst; aggressiv vækst håndteres af #1608.

## 6. Implementeringsplan (efter go)
1. Fjern `FIRST_PROMOTION_RELEGATION_SEASON`-gaten (`economyConstants.js`/`economyEngine.js`).
2. Tilføj forælder/barn-pulje-mapping (binært træ via `pool_index`).
3. Omskriv `processDivisionEnd` → **per pulje**: top 2 op til forælder; bund 4 delt 2+2 til børn; kant-regler (Div1 ingen op, Div4 ingen ned, dormant-tier udskudt).
4. Per-pulje Div4-aktivering (Div3-pulje all-real → åbn dens Div4-børn). Entry-routing: Div3-pulje m. AI → ellers aktiv Div4-pulje.
5. Ryd Div1's 4 frosne/test-hold (28→24).
6. #1760's visning matcher modellen — verificér + fjern needs-fix-flag (genåbn/erstat #1760-PR).
7. **Simulér-før-ship:** kør harnessen mod endelig kode + scorecard. Migration kun hvis nye state-felter kræves (fx pool-tree-kolonne — kan udledes af pool_index, så formentlig ingen).
8. Patch-note + help.json (ny spiller-synlig mekanik).

---
_Kilde: prod-query 2026-06-23 + `scripts/dev/sim-promotion-relegation.mjs`._
