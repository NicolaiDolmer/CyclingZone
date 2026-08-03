# Empirisk rekalibrering af fair-play-prisbånd (#3136)

Status: **FÆRDIG.** Ren empirisk analyse — ingen enforcement-kode ændret. Leverer det
kalibrerede bånd PR #3227 (draft, ships OFF) venter på.

## Kontekst

- **#3136:** 0,5×/3,0×-reglen fra #2226 flagger ca. halvdelen af alle ærlige, konkurrenceudsatte
  salg (median 0,49× i auktioner med 2+ uafhængige budgivere, snapshot 2026-07-30).
- **Owner-kommentar 2026-08-03 (ugescanning 3/8):** 0,6×-baseline gav 33% falske positiver på én
  uge (10/30 menneske-handler flagget, 0 bekræftet snyd). Strukturelt fund: **alle 13 handler
  under 0,6× i det vindue lukkede på præcis `starting_price` med præcis 1 byder** —
  single-bidder-auktioner måler sælgerens gulv-gæt, ikke markedets betalingsvilje.
- **PR #3227** (mekanisme, draft, ships OFF): håndhæver floor/cap på `transfer_offers`-accept,
  `swap_offers`-accept, `auctions.starting_price` (kun egen-rytter). `app_config`-nøgler:
  `transfer_price_floor_pct` (default 0), `transfer_price_cap_multiple` (default null) — ÉT
  globalt bånd for alle tre håndhævelsespunkter, ikke per-type-nøgler.

## Metode + datahygiejne

Alle tal er kørt READ-ONLY mod prod (`ghwvkxzhsbbltzfnuhhz`) 2026-08-03. Queries ligger i
`scripts/fairplay/3136-*.sql` (genkørbare, alle med resultat-kommentarer).

**Datahygiejne-fund #1 (påvirker alt nedenstående):** af 92 "completed" auktioner med
`seller_team_id IS NOT NULL AND current_bidder_id IS NOT NULL` er **10 selv-handler**
(`seller_team_id = current_bidder_id`, alle `is_guaranteed_sale=false`, ingen eksterne bud).
Mønster: udløbne auktioner uden bud, hvor systemet logger sælgeren som "vinder" for at lukke
rækken teknisk — ingen reel pengeoverførsel mellem to parter. **Ekskluderet fra al analyse.**
Reel peer-to-peer auktions-population: **82** (ikke 92). Ingen tilsvarende mønster i
`transfer_offers` (0/36) eller `swap_offers` (0/6).

**Datahygiejne-fund #2:** `finance_transactions`-retningen for auktioner er modsat af hvad man
først ville gætte: sælgerens indbetaling har `type='transfer_in'` (ikke `'transfer_out'` — det
er køberens række). `before_balance` på sælgerens `transfer_in`-række = sælgerens saldo FØR
salgsprovenuet lander, brugt som nødsalgs-proxy. 100% dækning (82/82).

**Alder-note:** Open beta startede 2026-05-08 (~87 dage siden). **Alle** 82 reelle p2p-auktioner
og alle 36 accepterede transfers falder derfor inden for de sidste 90 dage — "hele historikken"
og "sidste 90 dage" er reelt SAMME datasæt for disse to typer. Ingen ældre data at sammenligne
med endnu.

---

## 1. Konkurrenceudsat prisbånd (kernespørgsmålet)

| Bucket | n | Middel | P05 | P10 | **Median** | P90 | P95 |
|---|---|---|---|---|---|---|---|
| Konkurrence (2+ uafhængige budgivere) | 14 | 0,587× | 0,111× | 0,139× | **0,441×** | 1,124× | 1,367× |
| Én budgiver | 68 | 0,476× | 0,095× | 0,108× | 0,426× | 0,931× | 1,099× |

Bekræfter #3136's tese: medianen i ægte konkurrenceudsatte salg er **0,44×**, langt under
#2226's "under 0,5× er mistænkeligt". (Let opdateret fra issuets 0,49×/n=14-snapshot fra 2026-07-30
— samme population, 3-4 dage senere + selv-handler nu eksplicit renset ud.)

**Overraskende observation:** konkurrence- og enkelt-budgiver-populationerne ligner hinanden mere
end forventet i medianen (0,441× vs 0,426×) — enkelt-budgiver-auktioner er IKKE systematisk meget
lavere i medianen. Forskellen sidder i halerne: konkurrenceauktioner har en tykkere høj-hale
(P90 1,12× vs 0,93×). Se næste afsnit for hvorfor ejerens strukturelle fund alligevel holder for
en vigtig delmængde.

## 2. Verifikation af det strukturelle fund (fuld historik, ikke kun ugevinduet)

`scripts/fairplay/3136-single-bidder-structural-check.sql`:

| | n | Andel af alle 82 |
|---|---|---|
| Under 0,6× **og** enkelt-budgiver **og** klarer præcis på starting_price | 43 | 52% |
| Under 0,6× **og** enkelt-budgiver, men prisen bevægede sig (delvis budgivning) | 3 | 4% |
| Under 0,6× **og** konkurrenceudsat (2+ budgivere) — ægte lav klaring via reel budkrig | 7 | 9% |
| ≥0,6× (uanset budgiver-antal) | 29 | 35% |

Ejerens fund (43/53 = **81%** af alle under-0,6×-handler er "ingen prisopdagelse") holder for
**langt størstedelen**, men ikke for alle: **7 handler er ægte konkurrenceudsatte og alligevel
under 0,6×** (fx Hajun Hong-eksemplet fra #3136-issuet: 0,22× med 5 bud fra 3 hold). Konklusion:
"under 0,6×" er hverken universelt mistænkeligt (#2226s oprindelige antagelse) eller universelt
støj — men bidder-count alene forklarer heller ikke det hele. Et bånd bygget udelukkende på
konkurrenceudsatte handler (som efterspurgt i #3136 punkt 1) undgår denne fælde, fordi det per
definition kun bruger de 14 (nu klart definerede) konkurrenceudsatte observationer som anker.

## 3. Segmentering

### (a) Rytterens værdiniveau — 3 buckets (auktioner, `scripts/fairplay/3136-segmentation.sql`)

| Værdi-tier | Bucket | n | P10 | Median | P90 |
|---|---|---|---|---|---|
| Budget (≤30k) | competitive | 3 | 0,656× | 0,869× | 1,621× |
| Budget (≤30k) | single | 30 | 0,173× | 0,539× | 1,118× |
| Mid (30-150k) | competitive | 9 | 0,119× | 0,256× | 1,114× |
| Mid (30-150k) | single | 24 | 0,109× | 0,348× | 0,717× |
| Star (>150k) | competitive | 2 | 0,266× | 0,447× | 0,628× |
| Star (>150k) | single | 14 | 0,095× | 0,256× | 0,555× |

Samme mønster gentages i transfers (se afsnit b): **jo dyrere rytteren er, jo lavere er
pris/market_value-medianen.** Budget-ryttere handler tæt på deres `market_value` (0,54-0,87×);
star-ryttere handler til en markant større relativ rabat (0,25-0,45×). Konsistent på tværs af BÅDE
auktioner og transfers — ikke en tilfældighed i én kanal. Dette er det centrale input til
verdikt-afsnittet nedenfor. **Advarsel:** competitive-n pr. tier er meget lille (3/9/2) — brug
single-bidder-tallene (30/24/14) til at se mønstret, competitive-tallene kun til retning.

### (b) Auktion vs. direkte transfer (`scripts/fairplay/3136-transfers-swaps-band.sql`)

| Type | n | P10 | Median | P90 |
|---|---|---|---|---|
| Transfer, budget (≤30k) | 15 | 0,272× | 0,614× | 3,188× |
| Transfer, mid (30-150k) | 15 | 0,136× | 0,490× | 1,344× |
| Transfer, star (>150k) | 6 | 0,097× | 0,235× | 1,240× |
| Transfer, ALL | 36 | 0,139× | 0,488× | 1,585× |
| Auktion, ALL (konkurrenceudsat) | 14 | 0,139× | 0,441× | 1,124× |

Transfer-tallene matcher PR #3227's egen dry-run 1:1 (god krydstjek på metodologi). Transfers og
konkurrenceudsatte auktioner ligger tæt på hinanden i medianen (0,49× vs 0,44×) — direkte
forhandling og konkurrenceudsat budgivning giver ca. samme "ærlige pris"-niveau. Swap-data (n=6,
12 ben) er for lille til robust segmentering — se punkt (c).

### (c) Sælger-likviditet (nødsalgs-proxy, `before_balance` ved afvikling)

| Likviditet | n | P10 | Median | P90 | heraf competitive |
|---|---|---|---|---|---|
| Nødsalg (<50k) | 16 | 0,079× | 0,317× | 0,709× | 2 |
| Normal (50-250k) | 28 | 0,118× | 0,549× | 1,084× | 8 |
| Velhavende (>250k) | 38 | 0,136× | 0,369× | 0,930× | 4 |

**Ikke monotont.** "Normal"-likviditet sælger til HØJERE median-ratio end både nødsalg OG
velhavende. Nødsalg presses til lavere pris som forventet — men velhavende sælgere sælger OGSÅ
under normal-niveau, hvilket matcher ejerens LEGO-Vestas-observation fra 3/8-kommentaren
(velhavende sælger underpriser rutinemæssigt egne auktioner uden at være i nød). **Konklusion:
likviditet er ikke en ren, monoton forklaringsakse** — støtter beslutningen om IKKE at bygge en
likviditets-betinget bånd-udvidelse. Signalet er for svagt/ikke-monotont til at bære en separat
tærskel, og et likviditets-check ville tilføje kompleksitet uden klar gevinst.

### Swaps — kritisk fund

`scripts/fairplay/3136-transfers-swaps-band.sql`: swap-datasættets ekstreme outlier (min
0,008×/max 153,8× på de to ben af samme handel) er swap `9e426877` (2026-07-01): **EvoPro
(jcarey983@gmail.com) gav en 5.013-værdi rytter + 1.000 kontant for Barra CCs 772.214-værdi
rytter.** Barra CC (jcarey071@gmail.com, division 3) har `is_frozen=TRUE` — dette ER (en del af)
den allerede kendte og allerede-håndterede **#2221-svindelsag**, ikke en ny opdagelse. Ekskluderet
fra kalibreringsgrundlaget (ellers kalibrerer vi båndet ud fra netop den handel det skal fange).
Rensede swap-ben (n=10, 5 swaps): P10 0,459×, median 1,001×, P90 2,166× — tæt på 1,0× (fair swap)
uden outlieren, som forventet. n=6/n=10 er for lille til robust politik alene, men bekræftende:
**et bånd på 0,10-0,15× floor ville have fanget den kendte fraud-handel** (0,008× ligger langt
under selv den mest permissive kandidat).

## 4. Kombineret "ærlig pris"-reference

`scripts/fairplay/3136-combined-reference-and-fp-rates.sql` — 14 konkurrenceudsatte auktioner +
36 transfers + 10 rensede swap-ben (n=60 observationer, fraud-outlier ekskluderet):

| n | P05 | P10 | Median | P90 | P95 |
|---|---|---|---|---|---|
| 60 | 0,111× | 0,150× | 0,562× | 1,763× | 2,167× |

Dette er den bedste enkeltstående "hvad betaler markedet reelt"-reference vi har: den samler alle
tre kanaler (auktion, transfer, swap) hvor prisen er reelt forhandlet/konkurrenceudsat, uden
enkelt-budgiver-støj.

## 5. Anbefalede percentil-tærskler til `app_config`

PR #3227 bruger ÉT globalt `transfer_price_floor_pct` + `transfer_price_cap_multiple` for alle tre
håndhævelsespunkter (ikke per-type-nøgler) — anbefalingen holder sig til det for at være
shippable uden kode-ændring.

| Kandidat | floor_pct | cap_multiple | Baseret på |
|---|---|---|---|
| **A — anbefalet (stram)** | **0,15** | **1,8** | P10/P90 af kombineret ærlig-pris-reference |
| **B — anbefalet (permissiv, primær anbefaling)** | **0,10** | **2,2** | P05/P95 af kombineret ærlig-pris-reference |

**Primær anbefaling: Kandidat B (floor=0,10 / cap=2,2×).** Begrundelse: formålet med denne
rekalibrering er netop at stoppe falske positiver (33% ugentligt støj-niveau var ved at gøre
scanningen ubrugelig, jf. ejerens 3/8-kommentar). Et permissivt bånd fanger stadig
størrelsesordens-afvigelser (0,008× og 153,8× fra den kendte #2221-swap ligger begge langt uden
for selv kandidat B), mens det ikke rammer den brede, legitime spredning i almindelige handler.
Kandidat A er tilgængelig hvis ejeren vil acceptere en højere støj-rate (~20%, se nedenfor) for
strammere håndhævelse.

**Per-segment-udvidelse vurderes IKKE nødvendig nu:** værdi-tier-mønstret (afsnit 3a) er reelt,
men retter sig mod `market_value`-kalibrering (afsnit 6), ikke mod selve bånd-bredden — et bredt,
globalt bånd rammer stadig rigtigt for alle tre tiers, fordi P10/P90 for hele populationen allerede
er brede nok til at dække tier-forskellen. Likviditets-segmentering blev afprøvet og afvist
(afsnit 3c — ikke-monotont signal). Hold det simpelt: to globale tal.

## 6. Falsk-positiv-rater

Anvendt på de faktiske sidste-90-dages-handler (= hele historikken, se alders-note). Auktioner
måles på **starting_price** (det PR #3227 rent faktisk håndhæver ved oprettelse, ikke
slutklaringsprisen).

| Bånd | Transfer (n=36) | Auktion-startpris (n=82) | Swap (n=6, OR-logik) |
|---|---|---|---|
| **A anbefalet (0,15/1,8×)** | 19,4% | 19,5% | 50,0% |
| **B anbefalet-permissiv (0,10/2,2×)** | **11,1%** | **9,8%** | 33,3% |
| C ugescan-baseline (0,6/2,3×) | 63,9% | 69,5% | 66,7% |
| D #2226 oprindelig (0,5/3,0×) | 58,3% | 57,3% | 50,0% |
| E PR#3227 kandidat A (0,25/3,0×) | 27,8% | 36,6% | 33,3% |

Kandidat B reducerer falsk-positiv-raten fra 58-70% (nuværende baselines) til **~10%** for
transfer og auktion — en 6-7× reduktion i støj. Swap-tallene (n=6) bør ikke tillægges vægt uanset
kandidat; prøvestørrelsen er for lille (samme forbehold som PR #3227).

## 7. VERDIKT: er `market_value` systematisk for høj?

**Ja, men ikke ensartet — miskalibreringen er værdi-tier-afhængig, værst i toppen af markedet.**

- Konkurrenceudsatte auktioner (den reneste "ærlig pris"-kilde) klarer med median **0,44×**
  `market_value` — ikke 1,0×.
- Men gabet er IKKE fladt: budget-ryttere (≤30k) handler til 0,54-0,87× i medianen (relativt tæt
  på `market_value`), mens star-ryttere (>150k) handler til 0,25-0,45× — under halvdelen af
  budget-tierets ratio. Mønstret er identisk i BÅDE auktioner og transfers (uafhængig
  bekræftelse, ikke en tilfældighed i én kanal).
- Fortolkning: `market_value`-formlen ser ud til at overvurdere top-ryttere relativt mere end
  billige ryttere — enten fordi formlen ikke har tilstrækkelig aftagende marginalværdi i toppen,
  eller fordi et tyndt marked for dyre ryttere (få potentielle købere med råd/behov) strukturelt
  ikke kan prisopdage til fuld værdi uanset formel.

**Konsekvens for økonomien:** dette påvirker ikke kun fair-play-detektoren — det påvirker
trup-værdi-visninger, sponsor-beregninger (indirekte via #1441-epic) og spillerens oplevede
"hvad er mit hold værd", især for hold med flere star-ryttere (systematisk oppustet
selvopfattet formue).

**Anbefaling til ejeren: SHIP det empiriske prisbånd nu (lav risiko, reversibel via
`app_config`, løser det akutte fair-play-støj-problem) — men rekalibrér IKKE selve
`market_value`-formlen som en del af denne opgave.** Begrundelse: (1) `market_value` er en
epic-niveau, høj-risiko ændring, der propagerer til trup-visninger, sponsor-tal og alle
historiske handler — det hører hjemme i #1441 (langsigtet økonomi-epic), ikke som en hurtig
reaktion på et n=14-92-stikprøve. (2) Prisbåndet løser det akutte, konkrete problem (falske
positiver stopper en scanning fra at blive ignoreret) UDEN at røre `market_value` — det er
allerede kalibreret til de FAKTISKE priser, ikke til den formodede formel. (3) Denne rapports
værdi-tier-fund (afsnit 3a/5) bør vedhæftes #1441 som konkret evidens til den designsession, når
ejeren tager fat på formel-rekalibrering — ikke handles ad hoc her.

## 8. Kendte begrænsninger

1. **`market_value` er nuværende værdi**, ikke et historisk snapshot på handelstidspunktet —
   ingen snapshot-kolonne findes. Værdien kan have flyttet sig siden handlen (progression/
   økonomi-genberegning). Samme begrænsning som PR #3227 selv påpeger.
2. **Alle datasæt er unge** (spillet er ~87 dage gammelt) — "hele historikken" og "sidste 90
   dage" er identiske for auktioner/transfers. Ingen sæson-2-data endnu; båndet bør genkøres
   når mere historik samler sig, især efter sæsonskift (ny rytterpopulation/prisniveau).
3. **Swap-stikprøven er meget lille** (6 handler/12 ben, 5/10 efter fraud-eksklusion) — ikke
   statistisk robust. Global bånd anvendes på swaps primært fordi det ER globalt, ikke fordi
   swap-specifikke data understøtter det selvstændigt.
4. **Competitive-n pr. værdi-tier er meget lille** (3/9/2) — værdi-tier-mønstret er retningsgivet
   af de større single-bidder-populationer (30/24/14), ikke af competitive alene.
5. **`before_balance`-likviditetsdata dækker kun fra 2026-06-29** (finance_transactions-
   metadata er ikke ældre) — men det dækker 100% (82/82) af den rensede auktions-population, så
   ingen selektionsbias inden for det vindue vi har.

## 9. Draft tilbageførsels-kommentar til #2226

*(#2226 er lukket/konsolideret ind i #3131 — kommentaren nedenfor er klar til at poste der for at
lukke feedback-løkken, som acceptkriteriet i #3136 kræver. IKKE postet endnu — kun udkast.)*

> **Empirisk bånd leveret (#3136) — dette issues regel 1 (pris-ratio <0,5×/>3,0×) erstattes.**
>
> #3136 har nu kørt den fulde empiriske analyse. Konklusion: 0,5×/3,0×-tærsklen (og
> ugescanningens 0,6×/2,3×-baseline) er begge for stramme. Konkurrenceudsatte auktioner (2+
> uafhængige budgivere, den reneste "ærlig pris"-kilde) klarer med median 0,44× `market_value` —
> ikke 1,0×, og slet ikke ≥0,5×.
>
> **Nyt kalibreret bånd: floor=0,10× / cap=2,2×** (P05/P95 af en kombineret reference på 60
> observationer: 14 konkurrenceudsatte auktioner + 36 transfers + 10 rensede swap-ben). Reducerer
> falsk-positiv-raten fra 58-70% til ~10% på transfers og auktions-startpriser, mens det stadig
> fanger størrelsesordens-afvigelser (bekræftet: båndet ville have fanget den kendte #2221
> jcarey-swap på 0,008×/153,8×).
>
> Mekanismen ligger klar i PR #3227 (draft, ships OFF) — afventer ejerens go til at skrive disse
> to tal i `app_config` (`transfer_price_floor_pct=0.10`, `transfer_price_cap_multiple=2.2`).
>
> Fuld analyse, segmentering (værdi-tier/likviditet/kanal) og verdikt om `market_value`:
> `docs/audits/2026-08-03-price-band-recalibration-3136.md`.

## 10. Åbne spørgsmål til ejeren

1. **Kandidat A (0,15/1,8×, ~20% FP) eller Kandidat B (0,10/2,2×, ~10% FP)?** Anbefaling er B,
   men det er en risiko/støj-afvejning ejeren bør tage stilling til eksplicit.
2. **`market_value`-rekalibrering:** skal værdi-tier-fundet (star-ryttere handler til <halvdelen
   af budget-ryttere relativt) tilføjes som konkret input til #1441's designsession, eller er det
   allerede kendt/planlagt der?
3. **Genkør-kadence:** båndet er kalibreret på en 87-dages-ung økonomi. Bør det genkøres efter
   sæson-2-start, eller er kvartalsvis/halvårlig kadence fint?
4. **Swap-båndet (n=6):** er ejeren komfortabel med at bruge det globale bånd på swaps trods den
   lille prøvestørrelse, eller skal swap-håndhævelsen forblive slået fra indtil flere swaps er
   observeret?
