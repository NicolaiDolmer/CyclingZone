# Værdimodel v4: værdi = forventet spilproduktion (fase 2) — design

- **Dato:** 2026-07-13
- **Status:** Udkast — afventer ejer-godkendelse
- **Afløser:** Perception-model v3 (`riderValuationModel.json`, anchor-fittet) — se [docs/decisions/rider-valuation-model-v1.md](../../decisions/rider-valuation-model-v1.md)
- **Relaterer:** #1101 (fase-roadmap), #1281 (markeds-glidning = fase 3), #1364 (værdi følger evner — mekanikken genbruges uændret), #1308 (akademi-økonomi)
- **Type:** Balance-følsom spil-økonomi → **simulér-før-ship** med ejer-godkendt scorecard.

## 1. Problem (hvorfor v3 skal afløses)

v3 prissætter ryttere efter *virkelighedens transfermarkeds-perception* (26 ejer-anchors), men
rytternes indtjening kommer fra *spillets egen motor* (kalender + præmiestruktur + race-fysik).
De to er ikke koblet. Konkrete symptomer:

1. **Type-offsets er håndsatte og skrøbelige** — sprinter ≈ 6,4× en identisk puncheur, fittet på
   1-3 anchors pr. type. Om det er sandt i SPILLET er aldrig målt.
2. **Død top** — `output_max=91` + `value_cap=189M` betyder nul værdistigning for ryttere udviklet
   forbi top-anchoren; progression-dead-zone præcis hvor investeringen er størst.
3. **Ingen alder/potentiale** — 36-årig og 19-årig med samme stats er lige meget værd; "sælg før
   forfald" og udvikl-og-sælg (#1308) mangler sit økonomiske fundament.
4. **`prize_earnings_bonus` dobbelt-belønner** (evner forudsiger allerede præmier) og er additiv
   kroner oven på en eksponentiel model — støj i toppen, dominerende i bunden.
5. **Alsidigheds-blend (alpha=0,5) er håndsat** — burde være målt: producerer alsidighed faktisk
   mere i vores kalender?

**Ejer-retning (13/7-2026):** typernes værdiforskelle skal baseres på rigtig data fra spillet.
Anchors degraderes til validering nu og udfases helt på sigt, når systemet er selvkørende.

## 2. Kerne-idé

> **En rytters værdi = nutidsværdien af den produktion han forventes at levere resten af karrieren, målt ved at simulere spillets egen sæson.**

```
base_value(rytter) = Σ_{s=0..H} d^s · E[produktion i sæson s | evner_s, alder+s]

produktion  = præmiepenge + β_pt · point            (motorens egne payout-tabeller)
evner_s     = progressions-motorens fremskrivning (aldringskurve + potentiale)
d           = diskonteringsfaktor pr. sæson (ejer-tunes, start ~0,80)
H           = horisont til forventet karrierestop (aldersbestemt)
```

Alt håndsat i v3 bliver hermed **målt**: type-forskelle opstår af kalenderen og præmiestrukturen;
alsidighedspræmien opstår hvis brede profiler faktisk kan starte/score i flere løb; ungdomspræmien
opstår af flere resterende sæsoner + forventet udvikling; forfald opstår af aldringskurven.

## 3. Arkitektur

### 3.1 Trin A — produktionsmåling (Monte Carlo over sæsonen)
Nyt script `backend/scripts/simulateSeasonProduction.js`:
- Kør **K fulde sæson-simuleringer** (K ≈ 20-50, deterministisk seedet) af den aktive sæsonkalender
  med race-motoren (`raceSimulator.js`/`raceRunner.js`) på hele populationen, med realistisk
  startliste-logik (1 rytter = 1 løb/dag, felt-fyld som i drift).
- Output pr. rytter: `E[præmier]`, `E[point]`, varians — gemmes som artefakt
  (`backend/lib/riderProductionSample.json` eller tabel `rider_production_samples`).
- Kørslen er offline/admin-triggeret (samme kadence som re-fit i dag) — ikke i hot-path.

### 3.2 Trin B — udglattet værdifunktion (fit på sim-data)
Rå per-rytter-gennemsnit er støjfulde og lækker startliste-held. Derfor fittes en **glat funktion**
på sim-outputtet (afløser anchor-fittet i `fitRiderValuationModel.js` → ny kerne
`riderValuationFitV4.js`):

```
ln(E[produktion]) ~ f(abilities, primary_type)
```

- Samme funktionsfamilie som i dag kan genbruges som startpunkt
  (`ln v = a + b·O + c·O² + offset[type]`), men **alle koefficienter inkl. type-offsets og alpha
  fittes nu på tusindvis af simulerede rytter-sæsoner** i stedet for 26 anchors. Ingen
  `output_max`/`value_cap`-klamper nødvendige — kurven er kalibreret på hele skalaen, og toppen
  er bundet af hvad motoren faktisk kan udbetale.
- Modellen persisteres som `riderValuationModel.json` **version 4** med `method`,
  `sim_run_id`, K, sæson-id + koefficienter. Manuel re-fit, ejer-godkendt — ingen tavs auto-læring
  (uændret princip fra v1).

### 3.3 Trin C — karriere-NPV (alder + potentiale)
`predictBaseValue` v4:
1. Fremskriv rytterens evne-vektor sæson for sæson med **progressions-motorens** aldrings-/
   udviklingskurver (genbrug `previewRiderProgression.js`-kernen; potentiale styrer udviklings-
   tempoet som i dag). Forventningsværdi, ikke ny Monte Carlo pr. rytter — billigt.
2. Evaluér trin B-funktionen pr. fremskreven sæson, diskontér med d, summér over horisonten.
3. Skala-kalibrering: én global faktor så medianen matcher den nuværende prod-skala (ingen
   økonomi-chok ved cutover; p10/median/p90 rapporteres i scorecardet).

Resultat: unge talenter prises for deres *fremtid*, veteraner for deres *rest* — symmetrisk og
uden håndsatte ungdomspræmier.

### 3.4 Genberegning + skrivning (uændret)
#1364-mekanikken genbruges 1:1: `predictBaseValue` byttes ud bag samme interface;
trænings-sweepets dirty-pass + sæson-reconcile skriver `base_value`; `market_value` GENERATED.
Alder-leddet betyder at sæson-reconcilen nu også flytter værdi ved aldring — det er ønsket (#1364 §
"Symmetri").

### 3.5 `prize_earnings_bonus` — udfases af værdien
Forventet præmieproduktion ligger nu I modellen; den additive bonus dobbelt-tæller.
**Forslag:** drop bonussen fra `market_value` ved cutover (`market_value = base_value`), og lad
*realiserede* resultater i stedet virke via fase 3's markeds-præmie (#1281) — dér hører
"denne rytter har bevist noget"-signalet hjemme, spiller-drevet og separat fra model-værdien.
(Alternativ, hvis vi vil beholde et resultat-signal før #1281: konvertér til en lille
**multiplikativ** form-faktor, fx ±10%. Ejer-valg ved godkendelse.)

### 3.6 Anchors → validering (og udfasning)
`riderValuationAnchors.json` bruges IKKE i fittet. De beholdes midlertidigt som **sanity-tjek** i
scorecardet: rangordenen blandt top-anchors (≥15M) skal bevares (blød advarsel, ikke hård gate —
hvis spillets kalender siger at Ganna producerer mere end Philipsen, er det nu *spillet* der har
ret). Når fase 3-markedsdata findes og modellen re-fittes på ægte drift, slettes anchor-filen.

## 4. Fase 3-kobling (#1281) — næste slice, designes med nu
- Ny kolonne `riders.market_premium` (default 0):
  `market_value = base_value + market_premium` (GENERATED-udtrykket ændres ved cutover).
- Ved auktions-/transfer-finalization glider premium mod `handelspris − base_value`
  (vægtet, fx 25% pr. handel, clamp ±50% af base_value), og **henfalder** langsomt mod 0 mellem
  handler (sæson-tick), så gamle prischok ikke fossilerer.
- Aldrig glid af `base_value` selv (Model 1-reglen fra #1364 §4 — ellers snapper den tilbage).
- Langsigtet selvkørende loop: periodisk re-fit af trin B mod *faktiske* driftdata (rigtige løb i
  stedet for sim) — modellen lærer da helt af spillets egen historie, og sim bruges kun til nye
  populationer/kalender-ændringer.

## 5. Simulér-før-ship — scorecard (ejer godkender FØR cutover)

Harness: `backend/scripts/valuationV4Scorecard.js` (udvider mønstret fra `valuationScorecard.js`).
Gates:

1. **Type-økonomi-tabel:** målt E[produktion] pr. type (median + p90) vs v3's offsets — viser
   sort på hvidt hvor perception og spil-virkelighed afveg. Ejer ser tabellen som del af go.
2. **Skala-kontinuitet:** p10/median/p90 af `market_value` før/efter — median-drift ≤ ±15%
   (global kalibreringsfaktor, § 3.3).
3. **Udvikl-og-sælg-P&L (#1308-gate):** repræsentativ ung prospect skal være net-positiv at
   udvikle, men ikke dominant (genbrug #1364 § 5-kriterierne).
4. **Symmetri:** veteran-forfaldskurve + ungdomspræmie vist som konkrete trajectories.
5. **Ingen runaway:** populations-total over N simulerede sæsoner er bundet.
6. **Anchor-sanity (blød):** top-anchor-rangorden; afvigelser rapporteres med forklaring
   (= spillets data), ikke exit 1.
7. **Determinisme:** samme seed → samme model-JSON (fit-kørslen er reproducerbar).

## 6. Rollout

1. **Slice 1 (shadow):** sim-harness + fit + v4-preview i admin-sammenligningstabellen
   (v3 vs v4 side om side, samme mønster som #1101 slice 1). Ingen økonomi-ændring.
2. **Slice 2 (cutover, ejer-gated):** skift `predictBaseValue` til v4 + drop
   `prize_earnings_bonus` fra GENERATED-udtrykket (migration — **ejer merger**, aldrig auto).
3. **Slice 3 (#1281):** `market_premium` + glidning + henfald.
4. **Slice 4 (selvkørende):** re-fit-script mod ægte driftdata; anchors slettes.

## 7. Non-goals
- Ingen ændring af race-motorens fysik eller præmietabeller (de er inputtet, ikke scope).
- Ingen løn-ændringer (`salary` forbliver frossen pr. #1309).
- Ingen UI-redesign af værdi-visning (evt. værdi-bånd/fog er en separat design-diskussion).

## 8. Åbne ejer-valg (besluttes ved godkendelse)
- **Q1:** `prize_earnings_bonus` — drop helt ved cutover (anbefalet) eller interim form-faktor?
- **Q2:** diskonteringsfaktor d (0,80 foreslået) + horisont-model — tunes via scorecard.
- **Q3:** point-vægt β_pt (hvor meget er ikke-monetær produktion/prestige værd?).
