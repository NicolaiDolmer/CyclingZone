# Sponsor-arketyper — EV-gennemgang og risiko/afkast-trappe (2026-08-03)

> Refs [#3192](https://github.com/NicolaiDolmer/CyclingZone/issues/3192) (kilde: Discord #feedback-and-ideas, @thelamba 30/7, "Sponsor 'Larkin Brewing' needs a buff"). Relateret: #3147 (race-day-udbetalinger), #2889 (sæsonskifte-økonomi), #3020 (flad sponsor-cap på tværs af divisioner), #2926 (dry-run overvurderede sponsor ~20 mio — lærestykke om oversponsorering).
> **Status:** Analyse + foreslået konstant-ændring. Balance-følsomt → simulér-før-ship. PR er DRAFT — ejeren beslutter på baggrund af tallene i dette dokument.
> Metode: genbruger de ÆGTE `backend/lib/renownEngine.js` / `backend/lib/sponsorOffers.js`-funktioner mod eksporteret S1+S2-data (read-only SELECT, project `ghwvkxzhsbbltzfnuhhz`, snapshot 2026-08-03). Ingen tal er gættet — alt er kørt gennem den samme kode som produktionen bruger.

## TL;DR

Spillerens påstand er **empirisk bekræftet**: den nuværende "ambition"-arketype (Larkin Brewing-puljen) har en forventet værdi (EV) på **~99% af renownTarget** — statistisk identisk med den flade "safe"-arketype (100%), selvom den bærer reel nedside-risiko (90% hvis målet ikke nås). Årsagen er matematisk indlysende, ikke en fejlmåling: "top-halvdel af egen division" er per konstruktion tæt på 50/50 for en gennemsnitlig spiller i en afbalanceret pulje, og den gamle bonus-andel (18%) var for lille til at skabe en reel præmie oven på den ~50%-odds.

**Samme princip var brudt for "results"-arketypen, men i den modsatte retning:** selv den BEDSTE kvartil af hold (målt på faktiske etapesejre/podier) havde EV **under** den flade sponsor (86,7%) — arketypens hele pointe (gå efter sejre) blev straffet selv når du rent faktisk vandt.

**Forslag:** hæv "ambition"s sæsonmåls-andel fra 18% til 38% og skærp betingelsen fra top-halvdel til **top-40%** (matcher spillerens eget forslag om en hårdere betingelse); hæv "results"s garanti fra 65% til 72% og fordoble stort set bonus-andelene, så den bedste kvartil får en reel præmie (110%+) uden at gøre bunden urimeligt hård. "safe", "loyal" og "racing" er **uændrede** — de har ingen resultat-betinget risiko og var ikke en del af klagen.

Mix-scenariet (realistisk fordeling på tværs af arketyper) stiger **+1,1% vs. flad reference** (mod −2,0% i dag) — dvs. **+3,2% relativ stigning i sponsor-udbetaling**, godt inden for den ±10%-guard konventionen i `scripts/sponsorChoiceScorecard.js` allerede bruger. Ingen eksisterende (allerede-tegnede) kontrakter ændres — kun fremtidige tilbud.

## 1. Katalog — alle 5 sponsor-arketyper (nuværende, `backend/lib/sponsorOffers.js`)

Alle beløb er andele af `renownTarget` (= `SPONSOR_INCOME_BY_DIVISION[division] × renownMultiplier`, se `renownEngine.js`). Garanteret base + race-day-pulje udbetales UANSET resultat (race-day kræver kun deltagelse); klausuler kræver et resultat.

| Arketype | Garanteret | Race-day-andel | Længde | Klausul | Betingelse | Potentiale (fuld deltagelse) |
|---|---|---|---|---|---|---|
| **safe** | 92% | 8% | 1 sæson | — | — | 100% (fast) |
| **loyal** | 78% | 18% | 3 sæsoner | signing 8% | ingen (engangs, ved aktivering) | 104% (fast) |
| **racing** | 50% | 58% | 1 sæson | — | — | 108% ved 100% deltagelse (deltagelses-risiko, ikke resultat-risiko) |
| **results** | 55% | 10% | 2 sæsoner | stage_win 1,8%/sejr + podium 0,7%/podie, loft 50% | absolutte etapesejre/podier | 65% floor → 115% loft |
| **ambition** (Larkin) | 70% | 20% | 2 sæsoner | season_objective 18% | top-halvdel af egen division | 90% floor → 108% loft |

**Kun "results" og "ambition" er resultat-betingede** (variabel udbetaling afhænger af sportslig præstation, ikke bare deltagelse) — det er dem risiko-præmie-princippet gælder for. "racing" har deltagelses-risiko (skal stille til start hver etape), som er en anden risikoklasse og ikke del af klagen.

## 2. Empirisk sandsynlighedsgrundlag (S1 + S2, ægte population)

Population: **175 rigtige hold** (is_ai=false, is_bank=false, is_frozen=false, is_test_account=false), snapshot 2026-08-03. Sæson 1 er komplet (facit for "resultater over en hel sæson"); sæson 2 er i gang (93 af 455 planlagte løb fuldført på tværs af puljerne).

**Vigtig metode-detalje:** at gruppere S1-resultater efter holdets NUVÆRENDE (S2) division er misvisende, fordi S2-pyramiden blev omlagt (forfremmelse/nedrykning) mellem sæsonerne — nuværende D2-hold blev valgt netop FORDI de klarede sig godt i S1 (målt top-halvdel-rate = 100% for den gruppe, et rent selektions-artefakt, ikke en fremadrettet sandsynlighed). Det ubiased grundlag er i stedet **S2 TIL DATO, i de puljer holdene faktisk konkurrerer i nu**:

| Division (S2) | n | Top-halvdel opnået | Top-40% opnået | Avg. etapesejre til dato | Avg. podier til dato | Andel med 0 sejre |
|---|---|---|---|---|---|---|
| D2 | 48 | 50% | 42% | 1,21 | 2,42 | 60% |
| D3 | 96 | 50% | 42% | 0,54 | 1,08 | 77% |
| D4 | 31 | 55% | 45% | 0,77 | 1,84 | 58% |
| **Samlet** | **175** | **50,9%** | **42,3%** | — | — | — |

Dette bekræfter tallet direkte: "top-halvdel" er en 50,9%-odds og "top-40%" en 42,3%-odds, begge tæt på deres nominelle brøk (som forventet af en pulje-relativ rangordning). En hel-sæsons (S1) unbiased måling af sejre/podier (156 hold med S1-historik, ikke grupperet efter nuværende division) giver: **gennemsnit 2,13 etapesejre og 4,12 podier pr. hold pr. sæson**, men **49,4% af holdene fik NUL etapesejre** hele sæsonen — en stærkt højreskæv fordeling (median = 1 sejr), i modsætning til den nogenlunde symmetriske top-X%-fordeling.

Denne forskel er kernen i hvorfor "ambition" og "results" skal kalibreres forskelligt: "ambition" er en **pulje-relativ mønt** (nogenlunde retfærdig for et gennemsnitligt hold), mens "results" er en **absolut færdigheds-væddemål** (de fleste hold rammer aldrig loftet, et mindretal dominerer).

## 3. EV-tabel: FØR (nuværende tal)

EV som andel af renownTarget, S2-til-dato-udfald (ubiased grundlag):

| Arketype | EV (hele populationen) | Note |
|---|---|---|
| safe | 100,0% | reference |
| loyal | 104,0% | fast, ingen risiko |
| racing | 108,0% | ved fuld deltagelse |
| **results** | **67,6%** | selv topkvartilen (flest sejre/podier) lander på kun **86,7%** (S1, hel sæson) — dvs. den BEDSTE fjerdedel af feltet taber stadig penge ift. flad |
| **ambition** | **99,2%** | statistisk identisk med "safe" — bekræfter spillerens klage |

**Verdikt på spillerens påstand: bekræftet.** "Disse to ender med at betale nøjagtigt det samme" er ikke en fornemmelse — det er en målt EV-forskel på 0,8 procentpoint, inden for støj, mens nedsiden (90% ved manglende resultat) er reel.

## 4. Foreslået risiko/afkast-trappe

Kun **results** og **ambition** ændres. "safe"/"loyal"/"racing" er uændrede (ingen klage, ingen resultat-betinget risiko der kan brydes).

| Arketype | Garanteret | Race-day | Klausul (ny) | Floor | Loft | EV (S2-til-dato, hele pop.) |
|---|---|---|---|---|---|---|
| safe | 92% (uændret) | 8% | — | 100% | 100% | 100,0% |
| loyal | 78% (uændret) | 18% | signing 8% (uændret) | 104% | 104% | 104,0% |
| racing | 50% (uændret) | 58% | — | — | 108%@100% deltagelse | 108,0% |
| **results** | **60%** (var 55%) | **12%** (var 10%) | stage_win **3,5%**/sejr (var 1,8%) + podium **1,4%**/podie (var 0,7%), loft **53%** (var 50%) | 72% (var 65%) | 125% (var 115%) | **77,1%** samlet — men **top-kvartil (flest sejre) 110,5%**, top-halvdel ~97% (S1) |
| **ambition** | 70% (uændret) | 20% (uændret) | season_objective **38%** (var 18%), betingelse **top-40%** (var top-halvdel) | 90% (uændret) | **128%** (var 108%) | **106,3%** |

**Larkin/ambition-verdikt efter ændring:** EV løftet fra 99,2% til **106,3%** — en reel, men ikke ekstrem risikopræmie (+6,3 point i forventning, floor uændret 90%, loft løftet fra 108% til 128%). Spillerens eget forslag ("top 40%, payout mellem flad og results, ~624.800 total") er **strukturelt fulgt**: betingelsen er skærpet til top-40% som foreslået, og loftet (128%) sidder nu lige under det nye results-loft (125% for gennemsnits-sejre, op til 178% ved cap). Det konkrete "~624.800"-tal kan ikke genskabes 1:1 — det er specifikt for spillerens EGEN renownTarget (division + resultat-historik, formentlig en D1-aftale med multiplier ≈1,04), ikke en universel konstant, men *forholdet* (mellem flad og results) er det samme princip vi har fulgt.

**Hvorfor "results" IKKE er kalibreret til at slå flad i gennemsnit for HELE populationen:** i modsætning til "ambition" (pulje-relativ rang, ~50/50 for et gennemsnitshold) er "results" et absolut færdigheds-væddemål — 49% af alle hold får nul etapesejre en hel sæson. At tvinge den samlede populations-gennemsnit over 100% ville kræve enten (a) at fjerne al reel nedside (floor tæt på 100%, hvilket ikke er en risiko-arketype længere), eller (b) at gøre loftet så højt at et lille mindretal af dominerende hold trækker en uforholdsmæssig stor sum sponsor-penge ud af økonomien (inflations-risiko, jf. #2926). Den rigtige test for "results" er derfor: **giver den en reel præmie til den type hold der rationelt VILLE vælge den** (dem der faktisk vinder løb)? Ja — topkvartilen går fra 86,7% (tabte penge selv som vinder) til 110,5% (reel præmie).

## 5. Simulér-før-ship: mod ægte population

Alle beregninger kører `backend/lib/renownEngine.renownTarget()` og de ægte `ARCHETYPES`-tal direkte (ingen dupliceret logik) mod S1 (facit, komplet sæson) og S2-til-dato (partiel, ubiased puljer).

### 5.1 Total payout hvis ALLE 175 hold vælger arketype X (S1-udfald, fuld deltagelse — stress-scenarie, ikke en realistisk prognose)

| Arketype | Gammel total | Ny total | Δ |
|---|---|---|---|
| safe | 72,20 mio | 72,20 mio | 0,0% |
| loyal | 75,08 mio | 75,08 mio | 0,0% |
| racing | 77,97 mio | 77,97 mio | 0,0% |
| results | 52,60 mio | 62,25 mio | **+18,3%** |
| ambition | 71,42 mio | 76,79 mio | **+7,5%** |

### 5.2 Mix-scenarie (35/15/20/15/15 — samme vægte som `sponsorChoiceScorecard.js`s eksisterende konvention)

| Scenarie | Total | Δ vs. flad reference |
|---|---|---|
| Flad reference (renownTarget-sum) | 72,20 mio | — |
| Mix, gamle arketyper | 70,73 mio | −2,0% |
| **Mix, nye arketyper** | **72,98 mio** | **+1,1%** |

**Δ ny mix vs. gammel mix: +3,2%.** Komfortabelt inden for ±10%-guarden scorecardet allerede håndhæver på tværs af andre sponsor-ændringer. Ingen inflations-eksplosion.

### 5.3 Faktisk nuværende fordeling (inflations-kontekst — hvor meget rører dette LIGE NU)

Aktive `sponsor_contracts` på tværs af alle 175 rigtige hold: `{"safe": 88, "predictable": 41 (legacy), "activity": 11 (legacy), "racing": 5, "long": 7 (legacy), "results": 1, "ambition": 2, "loyal": 1}`.

**Kun 3 af 175 hold (1,7%) har i dag valgt "results" eller "ambition".** Den umiddelbare inflations-effekt af denne ændring er derfor lille — den bliver først relevant i det omfang flere spillere begynder at vælge disse arketyper NU DE FAKTISK GIVER MENING, hvilket §5.2's mix-scenarie allerede stress-tester (+3,2% i det tilfælde alle 5 arketyper bliver ligeligt populære efter merget).

### 5.4 S2-til-dato sanity-check (partiel sæson, deltagelses-skaleret)

| Arketype | Gammel (til dato) | Ny (til dato) | Δ |
|---|---|---|---|
| safe | 72.619.255 | 72.619.255 | 0,0% |
| loyal | 68.795.031 | 68.795.031 | 0,0% |
| racing | 44.116.487 | 44.116.487 | 0,0% |
| results | 45.931.216 | 51.926.794 | +13,1% |
| ambition | 63.682.021 | 69.211.417 | +8,7% |

Samme retning og størrelsesorden som S1-baserede tal — ingen overraskelse fra den partielle S2-måling.

## 6. Afgrænsning — eksisterende kontrakter røres IKKE

- `ARCHETYPES` i `sponsorOffers.js` bruges kun til at generere NYE tilbud (`generateOffers`, kaldt fra `getOffers`/`acceptOffer`/`expireAndRenewContracts`). Allerede-tegnede rækker i `sponsor_contracts` har deres `guaranteed_fraction`/`race_day_share`/`bonus_clauses` FROSSET på pick-tidspunktet (jf. `freezeClauses`-kommentaren i koden) — de læses aldrig igen fra `ARCHETYPES`.
- `evaluateSeasonObjectives` (sponsorContractsService.js) er udvidet til at forstå BÅDE `"top_half"` (gammelt, findes på de 2 aktive + 1 pending "ambition"-kontrakter i dag) OG `"top_40pct"` (nyt, kun på fremtidige tilbud) — se `OBJECTIVE_THRESHOLD_FRACTION`-opslaget. De 3 eksisterende Larkin/ambition-kontrakter fortsætter uændret med top-halvdel-betingelsen og 18%-andelen de blev tegnet med.
- Ingen DB-migration: arketype-konstanterne bor i kode (`backend/lib/sponsorOffers.js`), ikke i en databasetabel. Der er derfor ingen `database/*.sql`-fil i denne PR.

## 7. Metodologi og begrænsninger

- Alle beregninger genbruger `renownEngine.renownTarget()`/`computeResultsScore()` direkte (importeret, ikke reimplementeret) for at undgå divergens fra den ægte kode.
- `divisionStandings` (bruges til `computeResultsScore`s median/rank-faktor) er rekonstrueret som et syntetisk array af `tierSize` elementer sat til den målte `medianPoints` — matematisk ækvivalent for medianberegningen, da funktionen kun bruger `.length` og `median()`.
- Resultat-bonusser (stage_win/podium) tæller kun `result_type='stage'` (rank 1/2-3) — matcher `sponsorRaceDayIncome.computeResultBonusCredits` præcis. Per `docs/GAME_INVARIANTS.md` er endagsløbs-facit `result_type='gc'`, IKKE `'stage'` — dvs. sejre i rene endagsklassikere tæller ikke med i denne bonus. Det er en eksisterende egenskab ved produktionskoden (ikke noget denne PR ændrer), men det betyder at "results"-arketypens reelle EV for hold i etape-tunge divisioner kan afvige en smule fra hold der primært kører endagsløb. Værd at holde øje med, men ikke i scope for #3192.
- S1-baseret gruppering efter NUVÆRENDE division er bevidst IKKE brugt til kalibrering (selektions-bias fra pyramide-omlægningen, se §2) — kun til at demonstrere at man skal passe på med den fælde.
- Ambitionens `top_40pct`-sandsynlighed er målt til 42,3% (ikke eksakt 40%) — det er forventeligt: puljestørrelser er ikke altid delelige med 10, og `Math.ceil(poolSize × 0,4)` runder op.

## 8. Filer ændret

- `backend/lib/sponsorOffers.js` — `ARCHETYPES.results` og `ARCHETYPES.ambition` (se §4).
- `backend/lib/sponsorContractsService.js` — `evaluateSeasonObjectives` forstår nu `top_40pct` ud over `top_half` (backward-kompatibelt opslag, `OBJECTIVE_THRESHOLD_FRACTION`).
- `backend/lib/sponsorOffers.test.js` — opdaterede forventede fraktioner/andele for results+ambition.
- `scripts/sponsorChoiceScorecard.js` — kalibrerings-scorecardet forstår nu begge objective-typer (`computedTopFraction`, generaliseret fra `computedTopHalf`).
- `frontend/src/components/SponsorOfferModal.jsx` + `SponsorContractPanel.jsx` — klausul-teksten grenes nu på `clause.objective` (top_half vs. top_40pct), så gamle FROSNE kontrakter fortsat viser korrekt tekst.
- `frontend/public/locales/{en,da}/sponsor.json` — ny i18n-nøgle `clause.seasonObjectiveTop40`; den gamle `clause.seasonObjective` ("top half") er bevaret uændret til de 3 eksisterende kontrakter.
- `frontend/public/locales/{en,da}/help.json` — `sponsorNegotiation`-FAQ-svaret opdateret fra "top half" til "top 40 percent" (beskriver nye forhandlinger fremadrettet).

**Ikke rørt (per opgavens hårde regler):** `package*.json`, `frontend/src/lib/patchNotes.js`. Patch notes for denne balance-ændring er derfor IKKE tilføjet i denne PR — flag som åbent punkt til ejeren/næste session (se slutrapport).

## 9. Åbne spørgsmål til ejeren

1. **Godkend/juster de konkrete nye tal** (§4) — de er kalibreret mod øget EV + begrænset inflation, men er i sidste ende en smagssag hvor stejlt "risiko" skal føles.
2. **Patch notes:** denne PR rører ikke `patchNotes.js` (eksplicit forbudt i opgaven). Skal en patch-note tilføjes separat før/efter merge?
3. **`results`-arketypens `result_type='gc'`-blindside** (§7) — separat, mindre issue værd at oprette hvis ejeren vil have endagsløbs-sejre til at tælle i stage_win-klausulen.
4. **Skal de 3 eksisterende Larkin/ambition-kontrakter (2 aktive + 1 pending, top_half/18%) tilbydes en frivillig re-forhandling** til de nye vilkår, eller skal de bare løbe deres kontrakt ud som tegnet (nuværende forslag: sidstnævnte, jf. "ingen retroaktiv ændring")?
