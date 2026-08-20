# #3592 — Måling: hvor mange ryttere er reelt ramt af tt⊆gc og rouleur⊆brostensrytter (i dag, 18/8)

**Kilde:** `docs/snapshots/3591/riders_full.json` (8.717 ryttere, taget 13/8-2026, prod-snapshot).
**Population:** `owner_kind === "human" && potentiale >= 5` → **313 ryttere** (pot-5-6, menneske-ejede).
**Metode:** de FAKTISKE funktioner fra `backend/lib/riderProgression.js` (`buildYouthCaps`, `buildCapsForRider`) importeret direkte og kørt mod snapshottet — intet re-implementeret. Script: `measure.mjs` i denne mappe.

## Grundproblemet, kort

`CAPS_SHAPING_WEIGHTS` (`backend/lib/weights/capsShapingWeights.js`) har i dag:

```
tt        positive: { time_trial }
gc        positive: { climbing, time_trial, recovery, tempo, endurance, durability }
rouleur   positive: { flat, endurance, positioning }
brostens  positive: { cobblestone, flat, endurance, punch, positioning }
```

`tt`'s positive sæt er en ægte delmængde af `gc`'s. `rouleur`'s positive sæt er en ægte
delmængde af `brostensrytter`'s. `signatureFactor`/`youthRoleFactor` (riderProgression.js)
tester KUN fortegn (`w > 0` → fuldt tag), så enhver evne der er positiv for BÅDE A og B får
**samme** loft-bidrag, uanset om A's vægt er 1 og B's er 6.

## Caps-type-score (målestok)

Der findes ingen eksporteret "type-score for et caps-objekt" i repoet — jeg har bygget den
lokalt i `measure.mjs`, efter nøjagtig samme opskrift som `outputScore` (riderValuation.js)
og `ratingForRole` (displayRecipes.js): vægtet snit af caps-værdierne over typens POSITIVE
`CAPS_SHAPING_WEIGHTS`-vægte. Enhed: samme 0-99-skala som caps selv.

`Uafgjort` = `|scoreA − scoreB| < 1.0` — samme tærskel som issuets egen oprindelige måling
("under 1 rating-point").

## Resultat 1 — hele pot-5-6-populationen (upartisk, uanset rytterens egen type)

Pure caps (`buildYouthCaps`, uden gulv/alders-taper — det "rent anlægs-formede" loft issuet taler om):

| par | n | uafgjort | uafgjort % | median gap |
|---|---|---|---|---|
| tt/gc | 313 | 123 | **39,3 %** | 3,25 |
| rouleur/brostensrytter | 313 | 20 | **6,4 %** | 21,70 |

Live caps (`buildCapsForRider`, med gulv+alders-taper — krydstjek, ~samme billede):
tt/gc 31,3 % uafgjort, rouleur/brostensrytter 6,7 % uafgjort.

**Denne tabel er misvisende alene** — en stor del af "uafgjort" er blot to LAVE scores der
tilfældigvis ligger tæt (fx en sprinter har lav tt-score OG lav gc-score). Kun 4,5 % af pot-5-6
har BÅDE gap<1 OG begge scores ≥85 (det reelle "99/99"-mønster fra issuet) for tt/gc; 1,0 % for
rouleur/brostensrytter.

## Resultat 2 — den population der reelt er ramt (afgørende tal)

Fordi `gc`'s positive sæt er en superset af `tt`'s, er det **gc-ryttere** hvis caps
strukturelt camoufleres som tt-topmættede (og tilsvarende brostensrytter-ryttere vs.
rouleur). Nedbrudt på ryttere hvis EGEN primær- eller sekundærtype er superset-siden:

| par | filtreret på | n | uafgjort | uafgjort % | median gap |
|---|---|---|---|---|---|
| tt/gc | **gc**-primær/sekundær | 138 | 88 | **63,8 %** | **0,00** |
| tt/gc | tt-primær/sekundær (kontrol) | 52 | 5 | 9,6 % | 27,50 |
| rouleur/brostensrytter | **brostensrytter**-primær/sekundær | 27 | 20 | **74,1 %** | **0,00** |
| rouleur/brostensrytter | rouleur-primær/sekundær (kontrol) | 201 | 14 | 7,0 % | 23,11 |

Live caps (`buildCapsForRider`) giver praktisk talt samme billede (gc-siden 63,8 %,
brostensrytter-siden 74,1 %) — gulv/alders-taper camouflerer ikke problemet.

**Konklusion:** blandt de 138 pot-5-6-ryttere hvis primær- eller sekundærtype er `gc`, kan
**64 %** ikke skelnes fra `tt` på caps-niveau (median gap = 0,00 — bogstaveligt identiske
scores, ikke bare "tæt på"). Blandt de 27 brostensrytter-ryttere gælder det **74 %**. Kontrol-
gruppen (tt-siden, rouleur-siden) viser samme mønster IKKE går den anden vej — det bekræfter
at det er delmængde-relationen (superset camouflerer subset), ikke en generel modeltendens.

## Type-fordeling, pot-5-6 human (kontekst)

```
gc: 88, baroudeur: 40, rouleur: 53, sprinter: 22, puncheur: 22, tt: 39, climber: 29, brostensrytter: 20
```

`gc` er den STØRSTE enkelttype i pot-5-6-feltet (88/313 = 28 %) — problemet rammer altså ikke
en marginal gruppe, det rammer den mest almindelige elite-type i spillet.

## Output-filer

- `measure.mjs` — scriptet
- `measure-output.json` — maskinlæsbart resumé af alle tal ovenfor
