# Etape-struktur, mænds WorldTour-etapeløb 2024

Metode: Wikipedia-artikler for hver 2024-udgave, hentet via WebFetch (som konverterer siden til markdown og lader en lille model besvare et prompt — det er IKKE en rå HTML-parse). For flertydige/usædvanlige rækker (fx "Intermediate stage" hos Giro/Tirreno, prologen hos Romandie) er der kørt en ekstra, strammere verifikations-fetch med krav om ordret citat af Type-kolonnen. De øvrige rækker er taget fra én fetch og er IKKE enkeltvis krydstjekket mod rå wikitext — se forbehold i opsummeringen nederst.

---

## Tour Down Under 2024
kilde: https://en.wikipedia.org/wiki/2024_Tour_Down_Under
klasse: WorldTour
etaper: 6

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Hilly stage | hilly |
| 2 | Hilly stage | hilly |
| 3 | Flat stage | flat |
| 4 | Hilly stage | hilly |
| 5 | Hilly stage | hilly |
| 6 | Hilly stage | hilly |

bemærkninger: Ingen ITT/TTT, ingen prolog, ingen brosten nævnt. Etape 5 slutter på Willunga Hill og etape 6 på Mount Lofty (kendte stigningsmål), men kilden klassificerer begge som "Hilly stage" (ikke "Mountain stage") og bruger ikke ordet "summit finish" nogen steder — så det er IKKE noteret som bekræftet bjergankomst, kun som kendt terræn.

---

## UAE Tour 2024
kilde: https://en.wikipedia.org/wiki/2024_UAE_Tour
klasse: WorldTour
etaper: 7

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Flat stage | flat |
| 2 | Individual time trial | itt |
| 3 | Mountain stage | mountain |
| 4 | Flat stage | flat |
| 5 | Flat stage | flat |
| 6 | Flat stage | flat |
| 7 | Mountain stage | mountain |

bemærkninger: Sidste etape (7) er en "Mountain stage" der slutter på Jebel Hafeet — velkendt bjergankomst, men kilden bruger ikke selve ordet "summit finish". Etape 3 (Jebel Jais-området) er også "Mountain stage". Ingen brosten nævnt.

---

## Paris–Nice 2024
kilde: https://en.wikipedia.org/wiki/2024_Paris%E2%80%93Nice
klasse: WorldTour
etaper: 8

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Hilly stage | hilly |
| 2 | Flat stage | flat |
| 3 | Team time trial | ttt |
| 4 | Mountain stage | mountain |
| 5 | Hilly stage | hilly |
| 6 | Hilly stage | hilly |
| 7 | Mountain stage | mountain |
| 8 | Medium mountain stage | hilly |

bemærkninger: Etape 3 er en holdtempoetape (TTT). Etape 4 slutter ved Mont Brouilly, etape 7 (dronningeetapen) ved Auron — begge "Mountain stage", men kilden bruger ikke ordet "summit finish" eksplicit. Sidste etape (8) er "Medium mountain stage" i og omkring Nice, ikke ceremoniel/flad. Ingen brosten nævnt. Stednavnet for etape 7's mål blev gengivet inkonsistent på tværs af to fetches ("Auron" hhv. "Auron Madone d'Utelle") — selve Type-teksten ("Mountain stage") er dog konsistent, kun stednavnet er usikkert.

---

## Tirreno–Adriatico 2024
kilde: https://en.wikipedia.org/wiki/2024_Tirreno%E2%80%93Adriatico
klasse: WorldTour
etaper: 7

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Individual time trial | itt |
| 2 | Hilly stage | hilly |
| 3 | Intermediate stage | andet:Intermediate stage |
| 4 | Mountain stage | mountain |
| 5 | Mountain stage | mountain |
| 6 | Mountain stage | mountain |
| 7 | Flat stage | flat |

bemærkninger: Etape 3's Type-felt er verificeret (dobbelt-fetchet) til ordret at sige "Intermediate stage" — bemærk at ikon-filnavnet bag teksten hedder "Mediummountainstage.svg", altså er ikon og tekst uens i kilden; jeg har fulgt TEKSTEN ordret pr. instruks, ikke ikonet. Etape 6 slutter ved Monte Petrano (bjergankomst), men "summit finish" er ikke et ord kilden selv bruger. Ingen brosten. Sidste etape (7) er flad og afgøres ved massespurt, ikke ceremoniel.

---

## Volta a Catalunya 2024
kilde: https://en.wikipedia.org/wiki/2024_Volta_a_Catalunya
klasse: WorldTour
etaper: 7

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Medium-mountain stage | hilly |
| 2 | Mountain stage | mountain |
| 3 | Mountain stage | mountain |
| 4 | Flat stage | flat |
| 5 | Flat stage | flat |
| 6 | Mountain stage | mountain |
| 7 | Medium-mountain stage | hilly |

bemærkninger: Kilden skriver "Medium-mountain stage" med bindestreg (etaper 1 og 7) — normaliseret til `hilly` jf. nøglens "Medium mountain stage"-regel, selvom stavemåden afviger med en bindestreg. Etaper 2, 3 og 6 er bjergankomster (Vallter, Port Ainé, Queralt). Sidste etape (7) er ikke ceremoniel — den er selv klassificeret som en mellemsvær bjergetape. Ingen brosten nævnt.

---

## Itzulia Basque Country 2024
kilde: https://en.wikipedia.org/wiki/2024_Tour_of_the_Basque_Country (Wikipedias artikel-titel er "2024 Tour of the Basque Country" — "2024 Itzulia Basque Country" findes ikke som URL)
klasse: WorldTour
etaper: 6

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Individual time trial | itt |
| 2 | Hilly stage | hilly |
| 3 | Medium mountain stage | hilly |
| 4 | Medium mountain stage | hilly |
| 5 | Medium mountain stage | hilly |
| 6 | Mountain stage | mountain |

bemærkninger: Sidste etape (6) er selv en "Mountain stage" med opløb i Eibar — IKKE en ceremoniel/flad afslutning. Ingen brosten nævnt.

---

## Tour de Romandie 2024
kilde: https://en.wikipedia.org/wiki/2024_Tour_de_Romandie
klasse: WorldTour
etaper: 6 (prolog "P" + 5 nummererede etaper)

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| P | Individual time trial | itt |
| 1 | Hilly stage | hilly |
| 2 | Mountain stage | mountain |
| 3 | Individual time trial | itt |
| 4 | Mountain stage | mountain |
| 5 | Hilly stage | hilly |

bemærkninger: Prolog-rækken (23. april, Payerne, 2,28 km) er nummereret "P" af løbet, men Type-kolonnen skriver ordret "Individual time trial" — IKKE ordet "Prologue". Jeg har derfor normaliseret den som `itt` (verificeret ved separat, strammere fetch), ikke som `prologue`, fordi instruksen beder om at følge kildens ordlyd, ikke min fortolkning af stage-nummeret. Etape 2 (Salvan/Les Marécottes) og etape 4 (Leysin) er bjergankomster; kilden bruger ikke ordet "summit finish". Ingen brosten nævnt.

---

## Critérium du Dauphiné 2024
kilde: https://en.wikipedia.org/wiki/2024_Crit%C3%A9rium_du_Dauphin%C3%A9
klasse: WorldTour
etaper: 8

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Flat stage | flat |
| 2 | Hilly stage | hilly |
| 3 | Hilly stage | hilly |
| 4 | Individual time trial | itt |
| 5 | Hilly stage | hilly |
| 6 | Mountain stage | mountain |
| 7 | Mountain stage | mountain |
| 8 | Mountain stage | mountain |

bemærkninger: Sidste tre etaper (6-8) er bjergetaper med mål ved hhv. Le Collet d'Allevard, Samoëns 1600 og Plateau des Glières. Sidste etape (8) er IKKE ceremoniel — den er selv en bjergetape der afgør løbet. Ingen brosten nævnt.

---

## Tour de Suisse 2024
kilde: https://en.wikipedia.org/wiki/2024_Tour_de_Suisse
klasse: WorldTour
etaper: 8

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Individual time trial | itt |
| 2 | Hilly stage | hilly |
| 3 | Hilly stage | hilly |
| 4 | Mountain stage | mountain |
| 5 | Mountain stage | mountain |
| 6 | Mountain stage | mountain |
| 7 | Mountain stage | mountain |
| 8 | Individual time trial | itt |

bemærkninger: Sidste etape (8) er en individuel tempoetape (Aigle–Villars-sur-Ollon) — IKKE ceremoniel, afgør løbet. Etaper 4-7 er bjergetaper (mål bl.a. Gotthard Pass, Carì, Blatten, Villars-sur-Ollon). Ingen brosten nævnt.

---

## Tour de Pologne 2024
kilde: https://en.wikipedia.org/wiki/2024_Tour_de_Pologne
klasse: WorldTour
etaper: 7

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Hilly stage | hilly |
| 2 | Individual time trial | itt |
| 3 | Hilly stage | hilly |
| 4 | Flat stage | flat |
| 5 | Hilly stage | hilly |
| 6 | Hilly stage | hilly |
| 7 | Flat stage | flat |

bemærkninger: Sidste etape (7, Wieliczka–Kraków) er "Flat stage" — kilden beskriver den ikke eksplicit som ceremoniel/processional, kun som flad. Etape 6 slutter i Bukowina Tatrzańska (bjergrigt terræn) men er selv klassificeret "Hilly stage", ikke "Mountain stage". Ingen brosten nævnt.

---

## Renewi Tour 2024
kilde: https://en.wikipedia.org/wiki/2024_Renewi_Tour
klasse: WorldTour
etaper: 5

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Hilly stage | hilly |
| 2 | Individual time trial | itt |
| 3 | Flat stage | flat |
| 4 | Flat stage | flat |
| 5 | Hilly stage | hilly |

bemærkninger: Sidste etape (5) slutter i Geraardsbergen (Muur van Geraardsbergen-området) og er klassificeret "Hilly stage" — ikke ceremoniel. Ingen bjergankomst/"summit finish" nævnt af kilden. Ingen brosten nævnt (bemærk: Renewi Tour krydser typisk brostensklassikernes område, men kilden nævner det ikke eksplicit i den udtrukne tekst — så det står IKKE i tabellen).

---

## Giro d'Italia 2024
kilde: https://en.wikipedia.org/wiki/2024_Giro_d%27Italia
klasse: WorldTour (Grand Tour)
etaper: 21

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Hilly stage | hilly |
| 2 | Intermediate stage | andet:Intermediate stage |
| 3 | Flat stage | flat |
| 4 | Flat stage | flat |
| 5 | Hilly stage | hilly |
| 6 | Hilly stage | hilly |
| 7 | Individual time trial | itt |
| 8 | Mountain stage | mountain |
| 9 | Hilly stage | hilly |
| 10 | Intermediate stage | andet:Intermediate stage |
| 11 | Flat stage | flat |
| 12 | Hilly stage | hilly |
| 13 | Flat stage | flat |
| 14 | Individual time trial | itt |
| 15 | Mountain stage | mountain |
| 16 | Mountain stage | mountain |
| 17 | Mountain stage | mountain |
| 18 | Flat stage | flat |
| 19 | Intermediate stage | andet:Intermediate stage |
| 20 | Mountain stage | mountain |
| 21 | Flat stage | flat |

bemærkninger: Etaper 2, 10 og 19 er verificeret (dobbelt-fetchet) til ordret at sige "Intermediate stage" i Type-kolonnen — samme mønster som Tirreno–Adriatico, hvor ikon-filnavnet ("Mediummountainstage.svg") ikke matcher selve teksten. Fulgt teksten ordret. Sidste etape (21) er en flad kredsløbsetape i Rom — kilden beskriver den ikke eksplicit som "ceremonial"/"processional", men den er traditionelt Giroens afsluttende sprintetape (i modsætning til Tour de France, der har en ren ceremoniel indledning før finalespurt på sidste etape). Bjergetaper med opløb: 8, 15, 16, 17, 20. Ingen brosten nævnt.

---

## Tour de France 2024
kilde: https://en.wikipedia.org/wiki/2024_Tour_de_France
klasse: WorldTour (Grand Tour)
etaper: 21

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Hilly stage | hilly |
| 2 | Hilly stage | hilly |
| 3 | Flat stage | flat |
| 4 | Mountain stage | mountain |
| 5 | Flat stage | flat |
| 6 | Flat stage | flat |
| 7 | Individual time trial | itt |
| 8 | Flat stage | flat |
| 9 | Hilly stage | hilly |
| 10 | Flat stage | flat |
| 11 | Mountain stage | mountain |
| 12 | Flat stage | flat |
| 13 | Flat stage | flat |
| 14 | Mountain stage | mountain |
| 15 | Mountain stage | mountain |
| 16 | Flat stage | flat |
| 17 | Mountain stage | mountain |
| 18 | Hilly stage | hilly |
| 19 | Mountain stage | mountain |
| 20 | Mountain stage | mountain |
| 21 | Individual time trial | itt |

bemærkninger: **Sidste etape (21) var IKKE en ceremoniel Champs-Élysées-etape** — pga. de olympiske lege i Paris sluttede 2024-udgaven usædvanligt med en individuel tempoetape fra Monaco til Nice, som reelt afgjorde løbet. Kilden citeres for: "the tour finished in Nice with an individual time trial — the last time a time trial was the final stage in the Tour was in 1989." **Etape 9** havde grus-/sterrato-sektioner ved Troyes — kilden bruger ordene "gravel tracks" og "multiple sections of gravel road", IKKE "pavé"/"cobblestones". Det er altså grusveje (à la Strade Bianche), ikke klassiske brosten — bør ikke forveksles med Paris-Roubaix-stil pavé. Bjergetaper med opløb: 4, 11, 14, 15, 17, 19, 20.

---

## Vuelta a España 2024
kilde: https://en.wikipedia.org/wiki/2024_Vuelta_a_Espa%C3%B1a
klasse: WorldTour (Grand Tour)
etaper: 21

| Etape | Type (ordret fra kilde) | Normaliseret |
|---|---|---|
| 1 | Individual time trial | itt |
| 2 | Hilly stage | hilly |
| 3 | Hilly stage | hilly |
| 4 | Mountain stage | mountain |
| 5 | Flat stage | flat |
| 6 | Mountain stage | mountain |
| 7 | Hilly stage | hilly |
| 8 | Medium-mountain stage | hilly |
| 9 | Mountain stage | mountain |
| 10 | Mountain stage | mountain |
| 11 | Medium-mountain stage | hilly |
| 12 | Hilly stage | hilly |
| 13 | Mountain stage | mountain |
| 14 | Medium-mountain stage | hilly |
| 15 | Mountain stage | mountain |
| 16 | Mountain stage | mountain |
| 17 | Medium-mountain stage | hilly |
| 18 | Medium-mountain stage | hilly |
| 19 | Hilly stage | hilly |
| 20 | Mountain stage | mountain |
| 21 | Individual time trial | itt |

bemærkninger: **Sidste etape (21)** er ifølge kilden en individuel tempoetape (Distrito Telefónica–Madrid, 24,6 km, vundet af Stefan Küng) — IKKE den traditionelle flade, ceremoniel-agtige Madrid-afslutning man kender fra tidligere Vuelta-udgaver. Dette er verificeret ved to uafhængige fetches med samme resultat, men er ikke krydstjekket mod en tredje kilde — flag denne som værd at dobbelttjekke hvis den skal bruges til noget kritisk, da den bryder med Vueltaens sædvanlige mønster. Kilden nævner ikke eksplicit noget om demonstrationer/protester ved finalen (selvom dette er kendt fra andre kilder om 2024-udgaven, står det ikke i den tekst jeg har trukket ud herfra). Etape 1 er også en individuel tempoetape (Lissabon), IKKE en holdtempoetape. Bjergankomster bl.a. etape 15 (Valgrande-Pajares) og etape 16 (Lagos de Covadonga). Ingen brosten nævnt. "Medium-mountain stage" (med bindestreg) er kildens stavemåde for etaperne 8, 11, 14, 17, 18 — normaliseret til `hilly`.

---

## Opsummering

- **Løb med komplet data:** 14 af 14 (alle på listen — Tour Down Under, UAE Tour, Paris–Nice, Tirreno–Adriatico, Volta a Catalunya, Itzulia Basque Country, Tour de Romandie, Critérium du Dauphiné, Tour de Suisse, Tour de Pologne, Renewi Tour, Giro d'Italia, Tour de France, Vuelta a España).
- **Etaper i alt:** 138
  (6 + 7 + 8 + 7 + 7 + 6 + 6 + 8 + 8 + 7 + 5 + 21 + 21 + 21 = 138)
- **Ingen UKENDT-rækker** — alle 138 etaper fik en Type-værdi fra kilden.

**Huller / forbehold (vær ærlig):**
1. **Metode-begrænsning:** Data er hentet via WebFetch, som konverterer Wikipedia-siden til markdown og lader en lille model besvare et prompt — det er IKKE en rå HTML/wikitext-parse. For de fleste rækker er der kun én fetch pr. løb. Jeg har KUN dobbelt-verificeret (separat, strammere fetch der beder om ordret citat) de rækker der virkede usædvanlige: Tirreno–Adriatico etape 3, Giro etape 2/10/19 ("Intermediate stage"), Tour de Romandie-prologen, samt Vuelta-slutetapen. De øvrige ~130 rækker hviler på én enkelt fetch og bør betragtes som "sandsynligvis korrekt, men ikke hånd-verificeret linje for linje".
2. **"Intermediate stage"-mønsteret** (Tirreno etape 3; Giro etaper 2, 10, 19) matcher ikke normaliserings-nøglens forudsete kategorier. Jeg har fulgt instruksen "skriv ordret, gæt ikke" og lagt dem i `andet:Intermediate stage` frem for at gætte at det er "hilly" — selvom det underliggende ikon i kilden (Mediummountainstage.svg) antyder mellemsvær bjergetape, er selve TEKSTEN noget kilden selv skriver anderledes end tabelnøglen forventede.
3. **Vuelta 2024's slutetape som ITT** er den mest overraskende enkeltoplysning i hele datasættet (bryder med Vueltaens traditionelle flade Madrid-finale). Den er bekræftet to gange fra samme kilde, men IKKE krydstjekket mod en anden kilde (fx procyclingstats.com) — flag den til ekstra opmærksomhed hvis den skal bruges videre.
4. **Paris–Nice etape 7's stednavn** var inkonsekvent på tværs af to fetches ("Auron" vs. "Auron Madone d'Utelle") — kun stednavnet er usikkert, Type-værdien ("Mountain stage") er konsistent og bruges i tabellen.
5. **"Summit finish"/bjergankomst-sprog:** Ingen af de 14 Wikipedia-artikler bruger selv ordet "summit finish" i den tekst jeg fik udtrukket. Hvor jeg har nævnt bjergankomster i bemærkninger, er det baseret på Type=Mountain stage + kendt/navngivet stigningsmål — IKKE et direkte citat af ordet "summit finish". Det er markeret eksplicit i hver bemærkning for at undgå at det læses som et kilde-citat.
6. **Ingen sekundær kilde brugt** (procyclingstats.com/officielt site) — det var ikke nødvendigt, da Wikipedia havde data for alle 14 løb.
