# Sponsor-reglerne — SSOT

> **Læs denne FØR enhver opgave der rører sponsorkontrakter, sponsor-udbetaling, arketyper,
> renown/omdømme eller divisions-tillægget.** Hard rule 30 ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221),
> ejer-mandat 25/8) · områdedokument oprettet under [#4266](https://github.com/NicolaiDolmer/CyclingZone/issues/4266).
>
> Reglerne lå spredt over `2026-06-21-renown-sponsor-fase2-design.md`, to audits og seks issue-tråde,
> og flere af dem sagde noget andet end koden. Denne fil er kilden til hvad der rent faktisk kører.
> Den **duplikerer ikke** `docs/GAME_INVARIANTS.md`s konstanter — den peger på dem og siger hvad der
> er sket siden. Økonomiens øvrige regler (rytterværdi, løn, upkeep, auktion) bor i
> [`ECONOMY_RULES.md`](ECONOMY_RULES.md); denne fil er §3's udfoldning.
>
> Alt heri er verificeret mod kode og mod prod 29/8. Hvad der ikke kunne verificeres står i §8,
> ikke som en påstand. Beslutnings-arkæologien bag filen:
> [`audits/2026-08-29-sponsor-board-decision-inventory.md`](audits/2026-08-29-sponsor-board-decision-inventory.md).

---

## 1. De tre tal

Spillere og kode taler om "sponsoraftalen" som ét beløb. Det er **tre**, og de flytter sig efter
helt forskellige regler. Det er den hyppigste fejlkilde i området.

| Tal | Hvad det er | Rører sig |
|---|---|---|
| `renownTarget` | Aftalens samlede værdi ved fuld deltagelse = `SPONSOR_INCOME_BY_DIVISION[division] × renownMultiplier`. Beregnes **kun** når tilbud genereres | Ved hver tilbuds-generering. Er **ikke** en kolonne — den findes ikke i DB og kan kun bagud-udledes som `guaranteed_base / guaranteed_fraction` |
| `guaranteed_base` | Den garanterede del, udbetalt ved sæsonstart | **Frosset ved valg-tidspunktet.** Rører sig ALDRIG i kontraktens løbetid — heller ikke ved divisions-skift (se §3) |
| `per_race_day_rate` | Betaling pr. **etape** holdet starter i | Frosset ved valg, men **genberegnes ved aktivering** mod divisionens etapetal (#2913). Det er den ene af de tre der ikke er låst som spec 21/6 §4.3 lover |

**Fælden:** `renownTarget` er ikke gemt nogen steder. Enhver kode der vil kende et holds aftale-værdi
skal udlede den fra `guaranteed_base / guaranteed_fraction` — præcis som `recomputeActivationRate`
og `contractRaceDayPool` gør. Gæt aldrig på divisionen; udled fra fraktionen.

**Anden fælde:** basen skrives mod `teams.division` som den er **på valg-tidspunktet**. Manageren
vælger midt i sæsonen, altså før op-/nedrykningen er skrevet. Aftalen er derfor prissat mod den
division han forlader, ikke den han lander i. Det er #4376, og §3 er svaret.

**Renown-multiplieren** (`renownEngine.js`): `clamp(1 + W_RESULTS × resultsScore, 1.00, MAX_MULTIPLIER)`
med `W_RESULTS = 0,45` og `MAX_MULTIPLIER = 1,40`, harness-kalibreret 21/6
(`audits/2026-06-21-renown-sponsor-calibration.md`). `resultsScore ∈ [0,1]` = sidste sæsons point mod
divisions-medianen × rank-faktor. Frisk hold uden historik → 0 → multiplier 1,00.

**Den afledte invariant, som al ny kode må måles mod:**

```
SPONSOR_INCOME_BY_DIVISION[div] ≤ renownTarget ≤ SPONSOR_INCOME_BY_DIVISION[div] × 1,40
```

Målt 29/8 brød **36 af 230 hold** den nedadtil (D1 21 · D2 8 · D3 7 · D4 0). Ingen brød den opadtil.
Der findes ingen CI-gate eller prod-vagt der fanger det i dag — se §8.

---

## 2. Kontraktens tilstandsmaskine

```
                 ┌──────────────────────────────────────────────┐
                 │  intet valg truffet                          │
                 └───────┬──────────────────────────┬───────────┘
       manager vælger    │                          │  sæsonskifte uden valg
       for KOMMENDE      │                          │  → default 'safe', 1 sæson (#2914)
       sæson             ▼                          ▼
                 ┌───────────────┐          ┌───────────────┐
                 │   pending     │          │    active     │
                 │ start_season  │──────────▶  (oprettet    │
                 │  = N+1        │ sæsonskifte│   direkte)   │
                 └───────┬───────┘          └───────────────┘
                         │ nyt valg før skiftet
                         ▼
                 ┌───────────────┐
                 │   replaced    │
                 └───────────────┘

  hold UDEN aktiv kontrakt (#3316):  valg → 'active' MED activated_at = now, samme sæson
  hold oprettet midt i sæsonen (#3730): kontrakt ved oprettelse + forholdsmæssig base
```

**Hvad der låses hvornår:**

| Tidspunkt | Hvad der skrives | Hvad der genberegnes |
|---|---|---|
| **Valg** (`acceptOffer`) | `guaranteed_base`, `guaranteed_fraction`, `race_day_share`, `length_seasons`, `bonus_clauses` (frosset i **kroner**, ikke andele), `sponsor_name`, `signed_division` | — |
| **Aktivering** (`expireAndRenewContracts`, pending → active) | `status`, signing-bonus krediteres | **KUN `per_race_day_rate`**, mod holdets faktiske etapetal (#2913) |
| **Hver sæsonstart derefter** | — | Intet. Basen bæres uændret med, hele løbetiden |
| **Udløb** | `status = 'expired'` | Nye tilbud genereres mod da-aktuel division + renown |

Højst **én** `active` og højst **én** `pending` pr. hold — håndhævet af to delvise UNIQUE-indekser.
Flip altid den eksisterende væk FØR insert af en ny af samme status.

**Bonusklausuler fryses i kroner, ikke i andele** (`freezeClauses`). En kontraktrække må aldrig
afhænge af et live-driftende `renownTarget` — det var lektien fra #2589.

---

## 3. Divisions-tillægget (ejer-besluttet 29/8, opad-reglen ændret 4/9 · afventer merge + apply)

Aftalen er prissat mod den division holdet var i da det valgte. Rykker holdet op, betaler det den
nye divisions upkeep fra dag ét mod en sponsor prissat til den gamle. Rykker det ned, beholder det
en for høj base **og** får en nedrykningsfaldskærm for et fald der aldrig skete.

**Opadgående regel — "gulv + 50 %" (ejer-beslutning 4/9 kl. ~15:45, erstatter den oprindelige
0,5 × hele forskellen fra 29/8):**

```
tillæg = max(0, base[D−1] − base[prissat]) + 0,5 × (base[D] − base[D−1])
```

hvor `D` er holdets nuværende division og `D−1` er divisionen lige under (D2 for D1, D3 for D2,
D4 for D3 — D4 har ingen D−1, men kan omvendt aldrig modtage en opadgående korrektion, da intet er
billigere end D4). Holdet løftes FØRST til gulvet (basen for D−1), derefter halvdelen af resten op
til egen divisions fulde base. Ved ét-trins oprykning (D−1 = den prissatte division) er gulvet 0,
og reglen er uændret 50 % af hele forskellen — ingen ændring for det almindelige tilfælde.
Eksempel (ejer, 4/9): D1-hold med D4-aftale = gulv til D2 (400.000−315.000=85.000) + 0,5×(600.000−
400.000=100.000) = **185.000** oveni basen 315.000 = 500.000 (samme total som et hold der selv
sidder på en D2-aftale i D1). D2-hold med D4-aftale = (340.000−315.000=25.000) + 0,5×(400.000−
340.000=30.000) = **55.000** oveni 315.000 = 370.000.

**Nedadgående regel (uændret formel siden 29/8, men fra 4/9 bag et eksplicit tænd/sluk-flag):**

```
tillæg = 0,5 × ( SPONSOR_INCOME_BY_DIVISION[nuværende division]
               − SPONSOR_INCOME_BY_DIVISION[den division aftalen blev prissat mod] )
```

I S3 er nedad slået fra (grandfathering, §3.1 punkt 5, uændret). Fra S4 findes formlen i koden,
men er IKKE automatisk: `DOWNWARD_ADJUSTMENT_ENABLED` i `backend/lib/divisionAdjustment.js`
(og den tilsvarende frontend-konstant) er `false` som default. Ejeren sætter den til `true`
bevidst ved et sæsonskifte — korrektion 4/9, fordi ejeren vil tænde den selv, ikke få den
automatisk tændt af et sæsonnummer alene.

- Begge dele udbetales **kontant ved hver sæsonstart** hvor forskellen findes, som sin egen
  finance-linje ved siden af den garanterede base.
- **Ganges med bestyrelsens budget-modifier** præcis som basen (§5).
- `guaranteed_base` og `per_race_day_rate` røres ikke. Aftalen er stadig den underskrevne.
- **Prissætnings-divisionen skal lagres på kontrakten, ikke rekonstrueres.** Den er den division
  `loadRenownTargetValue` læste da tilbuddet blev genereret. En ny kolonne (`signed_division`)
  skrives af `acceptOffer`, `acceptOfferImmediately`, `expireAndRenewContracts` og
  `midSeasonSponsor`.
  **Hvorfor ikke rekonstruere:** den nærliggende genvej — holdets division i sæsonen før
  `start_season`, læst fra `season_standings` — virker ikke. Målt 29/8: **23 af 230 hold har ingen
  standing i den sæson**, alle oprettet efter 27/7, altså midt i en sæson. For dem er
  rekonstruktionen udefineret, og en udefineret prissætnings-division gør tillægget uberegneligt.
  **Backfill af eksisterende rækker må IKKE bruge standingen alene.** Det var første udkast, og
  det er forkert for **38 af 230** aktive kontrakter (målt 29/8). Grunden er sekvensen ved et
  sæsonskifte: komprimeringen skriver den nye division **før** `expireAndRenewContracts` genererer
  default-aftaler, så en transitions-skabt kontrakt er prissat mod holdets NYE division mens dets
  standing fra forrige sæson stadig peger på den gamle. Målt eksempel: et hold med
  `guaranteed_base` 772.800 (= target 840.000 = D1 × 1,40) fik standings-division 3, hvilket ville
  have udløst +130.000 til et hold der allerede er korrekt baseret.

  **Reglen der bruges i stedet** er invarianten fra §1: `target` skal ligge i
  `[base[d] ; base[d] × 1,40]`. Find alle divisioner der opfylder båndet; er holdets
  standings-division blandt dem, vinder den; ellers vinder en entydig enekandidat; ellers **NULL**.
  Et tvetydigt bånd (target 400.000 passer både D2 × 1,00, D3 × 1,18 og D4 × 1,27) er ikke noget at
  gætte på. Målt: 209 af 230 opløses, 21 forbliver NULL.
  **Fallback i drift:** manglende `signed_division` → tillæg 0, aldrig et gæt.

**Symmetrien med faldskærmen gælder NEDAD-formlen — det er hele designet dér.**
`PARACHUTE_FACTOR = 0,5` (#1980, ejer-låst 5/7) udbetaler `0,5 × (base[gammel] − base[ny])` ved
nedrykning. Nedad-tillæggets fradrag er nøjagtig samme beløb med modsat fortegn. For et nedrykket
hold med **løbende** aftale ophæver de to hinanden eksakt, så holdet beholder sin høje base uden
også at få faldskærm. For et hold hvis aftale er **udløbet og fornyet** i den nye division findes
ingen forskel, så tillægget er 0 og faldskærmen står uændret. **Ingen undtagelse i koden.** Enhver
anden faktor end 0,5 for nedad-formlen bryder dette. Opad-reglen (gulv + 50 %) bruger samme 0,5 i
sit sidste trin, men er ikke længere en ren spejling af faldskærmen — det var ejerens bevidste valg
4/9.

Konkrete beløb (opad, ny regel): D3→D1 **+160.000** · D2→D1 **+100.000** · D4→D1 **+185.000** ·
D4→D3 **+12.500** · D4→D2 **+55.000**. Nedad (uændret formel, kun ved flag+S4): D2→D3 **−30.000** ·
D3→D4 **−12.500**.

### 3.1 De fem beslutninger bag (ejer, 29/8) — og korrektionen 4/9

| # | Valg | Begrundelse der blev vejet |
|---|---|---|
| 1 | **Hver sæson** forskellen findes, ikke engangs | Holdet betaler den nye divisions upkeep hver sæson. 212 af 230 aftaler udløber alligevel efter S3, så det rammer kun 11 hold |
| 2 | **50 %** af forskellen (nu: af resten over gulvet, se korrektion 4/9 nedenfor) | Ejer-låst `PARACHUTE_FACTOR`. Kun ved 0,5 ophæver op og ned hinanden eksakt for nedad-formlen |
| 3 | **Kontant ved sæsonstart**, ikke fordelt i aftalens form | Upkeep trækkes på dag ét. En fordeling i aftalens form ville sende over halvdelen af hjælpen ud i en strøm der lander efter regningen |
| 4 | **Ganget med bestyrelsens modifier** | Konsistens: hver sponsorkrone i sæsonstart-udbetalingen går gennem modifieren. En umodificeret linje ville være endnu en undtagelse |
| 5 | **I S3 kun opad** (54 hold efter backfill-rettelsen af 29/8, +3.901.500 CZ$ efter modifier); nedad kun via eksplicit flag fra S4 | Ingen mister penge midt i en sæson — grandfathering-princippet fra #1234. De 10 hold der ligger for højt i S3 beholder pengene (ejer-beslutning 4/9): alle 10 aftaler udløber efter S3 |

**Korrektion 4/9 kl. ~15:45 (ejer, ét spørgsmål ad gangen):** opad-reglen ændret fra ren 50 % af
hele forskellen til **"gulv + 50 %"** — se formlen øverst i §3. Nedad-formlen er uændret, men er
nu bag et eksplicit `DOWNWARD_ADJUSTMENT_ENABLED`-flag (default `false`) i stedet for kun at være
gated af sæsonnummer — ejeren tænder den bevidst ved et sæsonskifte, ikke automatisk.

**Overgangsreglen for S3 er en éngangs-undtagelse med en udløbsdato.** Fra S4 kan nedad tændes af
ejeren; opad gælder altid.

**Beslutningsgrundlaget** (spiller-vendt, EN+DA): artefakt `4c8ed4bc-62c7-47e8-9beb-72c5787d4d08`.
Sporet i #4376. **Design-go: ejer 29/8, korrigeret 4/9** — hard rule 25's design-gate er dermed opfyldt.

### 3.2 Hvor det er implementeret

| Enhed | Ansvar |
|---|---|
| `backend/lib/divisionAdjustment.js` | Ren kerne: faktor, overgangsregel, modifier-loft, idempotency-nøgle. Ingen I/O |
| `sponsor_contracts.signed_division` | Den prissatte division. Skrives af `acceptOffer`, `acceptOfferImmediately`, `expireAndRenewContracts` (default-grenen) og `midSeasonSponsor` |
| `economyEngine.processSeasonStart` | Krediterer tillægget som egen `division_adjustment`-transaktion, efter faldskærmen |
| `financeForecast.js` | `projected_division_adjustment` — fuldt modellérbart, indgår i `projected_net` |
| `SponsorOfferModal.jsx` | Viser beløbet pr. division **før** underskrift (spillerens forbehold) |
| `scripts/creditDivisionAdjustment-4376.mjs` | Éngangs-efterbetaling for S3, samme funktioner og samme idempotency-nøgle som motoren |

**Invarianten der holder designet sammen** er en test, ikke en kommentar:
`divisionAdjustment.test.js` fejler hvis `DIVISION_ADJUSTMENT_FACTOR ≠ PARACHUTE_FACTOR`, og hvis
fradrag + faldskærm ikke summer til nul for D1→D2 og D2→D3. `divisionAdjustmentParity.test.js`
fejler hvis frontendens projektion afviger fra motoren for nogen kombination af divisioner —
uden den kunne en spiller se ét beløb i modalen og få et andet udbetalt (#4345's fejlklasse).

---

## 4. De seks tilfælde

| Tilfælde | Hvad der sker i dag | Fil |
|---|---|---|
| **Oprykning** | Basen følger IKKE med. Fra S4: divisions-tillæg opad. I S3: tillæg opad, efterbetalt | `expireAndRenewContracts` |
| **Nedrykning** | Basen følger IKKE med, men faldskærmen udbetales (kun D1→D2 og D2→D3; D3→D4 er bevidst ekskluderet fordi D4-upkeep er 0). Fra S4: fradrag der ophæver faldskærmen for løbende aftaler | `economyEngine` fase parachute |
| **Nyt hold, sæson 1** | Division-skaleret intro-sponsor, ingen variabel del. Springes over hvis holdet stadig har uberørt `INITIAL_BALANCE` (#1678) | `computeSponsorForSeason` intro-gren |
| **Hold uden aktiv kontrakt** | Forhandler for **indeværende** sæson og aktiverer straks. **Ingen** base-udbetaling her — den krediteres først ved næste rigtige sæsonstart. Race-day og signing-bonus gælder fra `activated_at`, så der aldrig sker bagudbetaling | `acceptOfferImmediately` (#3316) |
| **Hold oprettet midt i sæsonen** | Får kontrakt ved oprettelse + **forholdsmæssig** base efter resterende løbsdage. Løste en målt 10× indtægtsforskel i D4 | `midSeasonSponsor.js` (#3730) |
| **Kontrakt udløber** | `status='expired'`, nye tilbud mod da-aktuel division og renown. Intet valg → default `safe`, 1 sæson | `expireAndRenewContracts` (#2914) |

---

## 5. Hvad bestyrelsen må røre ved sponsorpengene

Bestyrelsen har præcis **tre** håndtag på sponsorøkonomien. Alt andet er uden for dens rækkevidde.
Den fulde ansvarsfordeling: [`BOARD_RULES.md`](BOARD_RULES.md) §Adskillelsen.

| Håndtag | Hvad den må | Grænse |
|---|---|---|
| **Budget-modifier** | Ganger den garanterede base **og** divisions-tillægget | `satisfactionToModifier`: ≥80 → 1,20 · ≥60 → 1,10 · ≥40 → 1,00 · ≥20 → 0,90 · ellers 0,80. Gennemsnit af alle `completed` planer |
| **Sponsor-pullout** (konsekvens-lag 5) | Ganger med 0,90 ovenpå modifieren, **multiplikativt** | Udløses ved tilfredshed <10 ELLER 2× planudløb under 30 %. Varer én sæson |
| **Bonustilbud** (konsekvens-lag 6) | Egen pengestrøm, uafhængig af sponsoraftalen | — |

**Loftet er et bestyrelses-tal:** `ceiling = guaranteed_base × MAX_BOARD_MODIFIER (1,20)`. Det
capper board-modifier-bypass, ikke legitim renown-skalering.

**Hvad bestyrelsen IKKE må:**
- Ændre `guaranteed_base`, `per_race_day_rate`, længde eller klausuler. Aftalen er managerens.
- Røre løbsdags-indtægten. Den er **rå** — ikke board-modificeret, ikke omfattet af loftet. Det er
  aktivitets-betaling, ikke standing-betaling (spec 21/6 §4.3, ejer-låst).
- Udbetale eller inddrage penge gennem mål. Belønningsvalutaen er **kun tillid** (ejer-valg 7/8).

---

## 6. De fem arketyper (faktiske tal fra `sponsorOffers.js`)

Andele af `renownTarget`. Rebalanceret 3/8 i #3192 (PR #3237, ejer-merget).

| Variant | Garanti | Løbsdage | Længde | Klausuler | Potentiale ved fuld deltagelse |
|---|---|---|---|---|---|
| `safe` | 0,92 | 0,08 | 1 | — | 1,00 fast |
| `loyal` | 0,78 | 0,18 | 3 | signing 0,08 | 1,04 fast |
| `racing` | 0,50 | 0,58 | 1 | — | 1,08 ved 100 % deltagelse |
| `results` | **0,60** | 0,12 | 2 | stage_win 0,035/sejr · podium 0,014/podie · loft 0,53 | gulv 0,72 → loft 1,25 |
| `ambition` | 0,70 | 0,20 | 2 | season_objective 0,38, betingelse `top_40pct` | gulv 0,90 → loft 1,28 |

**Om "results 72 %":** audit'ens TL;DR skriver "hæv results' garanti fra 65 % til 72 %". Det er
tabellens **gulv** (0,60 + 0,12), ikke garantien. Koden står på 0,60 = præcis audit'ens §4-tabel.
Ingen uforklaret værdi. Rettelsen hører i audit-dokumentet, ikke i koden.

**Legacy-varianter** fra før #2948 lever stadig på aktive rækker og kan kun identificeres via
`length_seasons`: `predictable` 0,88/1 · `activity` 0,55/2 · `long` 0,73/3. Enhver ny kode der
udleder target fra fraktionen SKAL have fallback via `guaranteedFractionForLength`.

Klausul-typen `top_half` (før 3/8) og `top_40pct` (efter) lever side om side i
`OBJECTIVE_THRESHOLD_FRACTION`. Frosne kontrakter beholder den betingelse de blev tegnet med.

---

## 7. Hvad der håndhæver hvad

| Niveau | Hvad det fanger | Hvor |
|---|---|---|
| Delvise UNIQUE-indekser | Højst én `active` og én `pending` pr. hold | `sponsor_contracts` |
| Idempotency-nøgler | Race-day og resultat-bonus dobbeltbetales ikke ved cron-retry | `sponsor_race_day:<raceId>:<teamId>` |
| Pre-filter + DB-constraint | To lag på samme idempotens (#3123) | `fetchPaidSponsorKeys` |
| `resolveContractForNewSeason` | Preview og udførelse kan ikke drive fra hinanden (#2926) | ren funktion, delt af begge |
| `results_bonus_paid` | Resultat-klausulernes loft kan ikke overskrides | `sponsorRaceDayIncome` |
| Delt scorecard | Arketype-EV kan måles mod ægte population før ship. **Manuel praksis, ikke en gate** — intet i CI kræver at den er kørt | `scripts/sponsorChoiceScorecard.js` |
| **Intet i dag** | At et holds `renownTarget` ligger uden for `[base[div] ; base[div] × 1,40]` | §8.1 |
| **Intet i dag** | At `per_race_day_rate`s divisor matcher sæsonens faktiske etapetal | §8.2 |

---

## 8. Kendte åbne modsigelser

| # | Modsigelse | Bevis |
|---|---|---|
| 1 | **Ingen invariant fanger et target uden for båndet.** 36 af 230 hold lå under gulvet 29/8 og ingen vagt sagde noget. Fejlen levede fra 23/8 til den blev fundet i en Discord-triage | §1 |
| 2 | **Løbsdags-raten er sat mod et etapetal der ikke gælder.** D1 brugte divisor 140 mod 155 faktiske, D2 112 mod 124, D4 56 mod 62 for 47 hold. 102 hold tjener ca. 10,7 % mere race-day-penge end `race_day_share × target`. Kalibrerings-invarianten i spec §4.1 holder ikke | målt 29/8 |
| 3 | **Tilbuds-modalen viser en rate op til 2,6× for høj når den kommende sæsons kalender ikke findes endnu.** `loadSeasonStageCounts` falder tilbage på `FULL_CALENDAR_DAYS = 60`; D1 kører 155. En spiller så 5.800 og ville få 2.245. Rod-årsag til [#4345](https://github.com/NicolaiDolmer/CyclingZone/issues/4345) | verificeret mod spiller-rapport 28/8 |
| 4 | ~~`/rules` lover et sponsor-loft der ikke findes~~ — **LØST 29/8.** `FINAL_SPONSOR_PAYOUT_CEILING` er slettet fra `economyConstants.js` og `rulesNumbers.js`, prosaen på `/rules` (en+da) beskriver nu det kontrakt-bevidste loft, og `GAME_INVARIANTS.md` er rettet. D4's sponsor-base manglede også på `/rules` og er tilføjet | PR #4376 |
| 5 | **Spec 21/6 §4.3 siger `per_race_day_rate` er låst.** #2913 gjorde den om til noget der genberegnes ved aktivering. Bevidst ændring, spec aldrig opdateret — SSOT-gæld, ikke fejl | §2 |
| 6 | **Sponsoren kører på omdømme-proxy v1** (division + resultat-historik), eksplicit markeret midlertidig i spec §9 indtil #1099 lander. Der findes **ingen aftalt udgang**: ingen dato, intet issue der ejer hvad der sker med løbende kontrakter den dag den rigtige motor kommer | §8, inventaret §5 |
| 7 | **Renown-multiplieren mætter i praksis.** Alle 24 D1-hold har `resultsScore = 1,0` → multiplier 1,40, fordi de alle blev forfremmet og derfor lå i toppen af deres pulje. Proxy'en giver nul differentiering inden for den øverste division | målt 29/8 |
| 8 | **#3595 er ubesvaret:** sponsormålets penge udbetales up front og målet kan ignoreres uden konsekvens. Ejeren bekræftede det i tråden 9/8; ingen beslutning om hvad et mislykket mål skal koste | #3595 |

---

## Kildedokumenter (afløst af denne fil som regelkilde)

- `superpowers/specs/2026-06-21-renown-sponsor-fase2-design.md` — §2's ejer-låste beslutninger er
  fortsat gyldige. §4.3's "per_race_day_rate er låst" er **overhalet** af #2913. §4.2's tre varianter
  er overhalet af #2948's fem. Brug den som designhistorik, ikke som beskrivelse af nutiden.
- `audits/2026-06-21-renown-sponsor-calibration.md` — kalibreringen af `W_RESULTS`/`MAX_MULTIPLIER`
  er stadig grundlaget for de to konstanter.
- `audits/2026-08-03-sponsor-archetype-ev-3192.md` — §4-tabellen er den mergede beslutning.
  **TL;DR'ens "garanti 65 → 72 %" er en fejlformulering** af gulvet; se §6.
- `superpowers/specs/2026-07-05-economy-fase3-empire-design.md` — "oprykning er en investering,
  højere sponsor-base er opsiden" er designgrundlaget for §3.
- `audits/2026-08-29-sponsor-board-decision-inventory.md` — beslutnings-arkæologien bag denne fil.
- `GAME_INVARIANTS.md` — fortsat SSOT for konstanterne selv.
