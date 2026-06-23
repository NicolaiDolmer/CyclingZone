# Op-/nedrykning — gennemregnet design-forslag (#1152, #1745/#1760)

> **Status:** forslag til ejer-godkendelse (23/6). Bygges IKKE før godkendt.
> **Ejer-beslutninger (23/6):** op/nedrykning **aktiveres nu** (intet låst mere — fjern sæson-3-gate), **per pulje**, **vises som aktiv**. Dette doc regner modellen igennem + simulerer mod faktisk population, jf. simulér-før-ship.
> **Harness:** `scripts/dev/sim-promotion-relegation.mjs` (reproducerbar; kør `node scripts/dev/sim-promotion-relegation.mjs`).

## 1. Faktisk udgangspunkt (prod 2026-06-23, sæson 1 dag 0)

| Division | Puljer | AI/pulje | Ægte managere | Note |
|---|---|---|---|---|
| Div 1 | 1 | 24 | 0 | +4 frosne/test → 28 total (over 24) |
| Div 2 | 2 | 24 | 0 | fuld AI |
| Div 3 | 4 | ~18 | **26 (ALLE ægte hold)** | 6-7/pulje |
| Div 4 | 8 | 0 | 0 | **helt tom** |

To vigtige afvigelser fra "ægte managere ind fra bunden (Div4)":
- **Alle 26 ægte hold sidder i Div3**, ikke Div4.
- **Div4 er helt tom** (0 hold). AI fylder kun Div3+4-puljer med ≥1 ægte hold, så de 8 tomme Div4-puljer forbliver tomme indtil et ægte hold lander der.

## 2. Flow-matematikken (fan-out-pyramide 1/2/4/8)

Pyramiden smalner opad. For at op/ned-strømmen balancerer pr. grænse skal **antal op fra tier N+1 = antal ned fra tier N** (ellers driver pulje-sammensætningen — men AI-fyld holder altid *størrelsen* på 24).

- **Symmetrisk 2/2 (Skema A):** Div2's 2 puljer sender 4 op, men Div1 (1 pulje) relegerer kun 2 → 2 "for mange" vil op. AI-fyld i Div1 absorberer det (trimmer AI), indtil Div1 er fuld af ægte hold. Mismatch vokser opad, men bides først langt ude.
- **Balanceret (Skema B): op 1 / ned 2 pr. pulje i lavere divisioner.** Div1 ned 2 ⇄ Div2 op 2 (2×1) ✓; Div2 ned 4 ⇄ Div3 op 4 (4×1) ✓; Div3 ned 8 ⇄ Div4 op 8 (8×1) ✓. Matematisk stabilt uden at læne sig på AI-fyld.

## 3. Simulering (10 sæsoner, snit af 5 seeds, skill-baseret klatring)

**Ingen overflow (pulje >24 ægte) i NOGEN variant** over 10 sæsoner — heller ikke ved høj vækst. Udvalgte tal (ægte hold pr. division, sæson 10):

| Scenarie | Skema | Div1 | Div2 | Div3 | Div4 | max ægte/pulje |
|---|---|---|---|---|---|---|
| Kun 26 nuværende | A | 6.2 | 3.8 | 8.2 | 7.8 | 8 |
| Kun 26 nuværende | B | 2.0 | 4.2 | 11.6 | 8.2 | 5 |
| +8 nye/sæson | A | 12.6 | 11.0 | 27.0 | 55.4 | 16 |
| +8 nye/sæson | B | 6.0 | 6.8 | 25.0 | 68.2 | 9 |
| +20 nye/sæson | A | 17.0 | 17.8 | 46.2 | 145.0 | 22 |
| +20 nye/sæson | B | 8.6 | 8.0 | 39.8 | 169.6 | 23 |

**Læsning:**
- Begge skemaer er **sikre nu og mellemlangt** (ingen overflow, max-pulje < 24 i 10 sæsoner).
- **Skema A** lader ægte hold klatre hurtigere → toppen (Div1) fyldes hurtigere. Ved *vedvarende* høj vækst nærmer Div1's ene pulje sig kapacitet langt ude (~sæson 12-15).
- **Skema B** holder en mere bund-tung, fodbold-agtig pyramide (færre nær toppen, lavere max-pulje).
- **Den reelle grænse er total-kapacitet, ikke counts:** ved +20/sæson fylder Div4 (≈170/192) → pyramiden skal udvides (flere puljer/tiers) — det hører under skalerings-epic **#1608**, ikke denne opgave.

## 4. Anbefaling

**Skema A (2 op / 2 ned pr. pulje), aktiv nu.** Begrundelse:
- Matcher præcis det #1760 allerede viser → ingen visnings-omskrivning, kun backend skal følge.
- Intuitiv spiller-regel ("top 2 op, bund 2 ned i din pulje").
- Empirisk sikker i 10+ sæsoner ved realistisk vækst.
- Den langsigtede top-trængsel er år ude og løses naturligt af pyramide-udvidelsen i #1608.
- Tempererer mod over-engineering: vi sender den selv-korrigerende (AI-fyld-buffrede) simple regel nu og forfiner counts hvis/når ligaen reelt nærmer sig kapacitet.

Skift til Skema B hvis du foretrækker en strammere, mere bund-tung pyramide hvor det er sværere at klatre (mindre op-mobilitet).

## 5. Beslutninger jeg mangler fra dig

1. **Skema A (anbefalet) vs B?** (counts pr. pulje)
2. **Hvor kommer NYE managere ind?** Den oprindelige plan var Div4 (bunden), men de 26 nuværende sidder i Div3 og Div4 er tom. Skal nye ind i Div4 fremover?
3. **Den "inverterede" start:** når op/nedrykning aktiveres, relegerer Div3's 4 puljer hver sine bund-2 = **8 ægte hold falder ned i det tomme Div4** (som så AI-fyldes omkring dem), og 8 klatrer til Div2. Er det ok, eller vil du **seede Div4 / flytte entry til Div4 først** så starten ikke er omvendt?
4. **Div1's 4 frosne/test-hold** (28 > 24) — skal de ryddes som del af dette?

## 6. Implementeringsplan (efter godkendelse)

1. Fjern `FIRST_PROMOTION_RELEGATION_SEASON`-gaten i `economyConstants.js`/`economyEngine.js` (aktivér nu).
2. Lav `processDivisionEnd` **per pulje** (i dag: per division `slice(0,2)`/`slice(-2)`) — promovér top-N / relegér bund-N pr. pulje, med tier-grænser (Div1 ingen op, Div4 ingen ned) + valgte counts.
3. Destinations-routing: spred op/nedrykkere over destinations-puljer; AI-fyld (`reconcileAiTeamsForPool`, #1739) bringer puljer til 24 bagefter.
4. #1760's visning matcher allerede Skema A — verificér + fjern "needs-fix"-flag.
5. **Simulér-før-ship:** kør harnessen mod den valgte model + scorecard før merge. Migration kun hvis state-felter kræver det.
6. Patch-note + help.json (ny spiller-synlig mekanik).

---
_Kilde-data: `seasons` + `league_divisions`/`teams` prod-query 2026-06-23. Harness: `scripts/dev/sim-promotion-relegation.mjs`._
