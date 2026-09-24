# Clarity: /training (til #5485)

Kilde: Microsoft Clarity, `query-analytics-dashboard`, hentet 23/9 2026. Kun URL'en `cyclingzone.org/training` findes (fanerne tæller ikke som egne URL'er). Ingen bots. Ingen optagelser brugt.

## 1. Trafik og adfærd pr. enhed

| Periode | Enhed | Sessioner | Visninger | Scroll-dybde | Aktiv tid | Døde klik (side) | Rage clicks | Quickbacks |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 3 dage (21-23/9) | PC | 33 | 47 | 95,6 % | 146 s | 12 | 0 | 29 sessioner |
| 3 dage | Mobil | 22 | 32 | 87,2 % | 41 s | 15 | 0 | 18 sessioner |
| 3 dage | Tablet | 3 | 5 | 89,8 % | 3 s | 0 | 0 | 3 sessioner |
| 7 dage (16-23/9) | PC | 129 | 223 | 93,9 % | 78 s | 35 sess. | 0 | 99 |
| 7 dage | Mobil | 96 | 151 | 92,3 % | 39 s | 15 sess. | 0 | 64 |
| 30 dage (24/8-23/9) | PC | 592 | 1.120 | 95,1 % | 60 s | 316 | 1 | 493 |
| 30 dage | Mobil | 464 | 839 | 90,9 % | 41 s | 107 | 0 | 358 |
| 30 dage | Tablet | 30 | 76 | 92,6 % | 32 s | 3 | 0 | 36 |

Kendt fra 20-22/9 (ikke hentet igen): PC 45 sessioner/76 visninger, mobil 35/48, aktiv tid PC 102 s, mobil 44 s.

**Læsning**
- Mobil er 42-44 % af besøgene, men aktiv tid er 40-41 s mod 60-146 s på PC. Mobil-besøget er et hurtigt tjek, så dagens handling skal kunne klares på første skærm.
- Scroll-dybden er 90-96 % på alle enheder: spillerne ruller siden igennem. Det er ikke et bevis på at de VIL scrolle, men på at det de har brug for står langt nede.
- Rage clicks er næsten 0. Frustrationen viser sig som døde klik og quickbacks, ikke som hamren.
- Quickbacks er høje (7 dage: 163 på 374 visninger). Sandsynlig årsag (antagelse): klik på rytternavn, ud på profilen, straks tilbage.

## 2. Mest klikkede tekster og dødt-klik-signal

EN og DA er samme knap i to sprog. "Dødt" er Clarity's tal pr. klik-tekst.

| Element (EN / DA) | Klik 7 d | Dødt 7 d | Klik 30 d | Dødt 30 d |
|---|---:|---:|---:|---:|
| Rest / Hvile | 142 + 225 = 367 | 90 + 129 | 498 + 871 = 1.369 | 195 + 585 |
| Save day / Gem dag | 82 + 172 = 254 | 32 + 80 | 442 + 1.119 = 1.561 | 95 + 657 |
| Training / Træning | 97 + 113 = 210 | 47 + 67 | 462 + 591 = 1.053 | 126 + 427 |
| Active recovery / Aktiv restitution | 72 + 108 = 180 | 18 + 39 | 380 + 657 = 1.037 | 65 + 391 |
| Rytternavn (maskeret af Clarity) | 153 | 272 | 694 | 714 |
| "on" (checkboks) | 138 | 254 | 741 | 673 |
| Tomt område (" ") | 126 | 94 | 771 | 328 |
| Train today (+25 %) / Træn i dag | 47 + 79 = 126 | 24 + 39 | 235 + 374 = 609 | 65 + 200 |
| Fatigue / Træthed | (DA) 88 | 51 | (DA) 375 | 234 |
| Physical abilities… / Fysiske evner… (dagspanelets "Training"-kort) | 36 + 45 = 81 | 9 + 25 | (DA) 271 | 204 |
| Individual weekly plan / Individuel ugeplan | ikke i top 20 | 20 (DA) | – | – |
| Fanerækken (klik mellem fanerne) | – | 15 (DA) + 12 (EN) | – | – |

**Forbehold (vigtigt):** Clarity's dødt-klik-tal pr. tekst kan være STØRRE end antal klik (rytternavn 272 døde på 153 klik), og summen pr. tekst er langt over sidens samlede døde klik (30 dage: 426). Tallet pr. tekst tælles altså ikke som "andel af klikkene". Brug det kun til at rangere elementerne mod hinanden. Den danske udgave af de samme knapper har gennemgående et højere signal end den engelske (fx Gem dag 657 mod Save day 95 på 30 dage); ingen evidens for hvorfor.

## 3. Hvad spilleren sandsynligvis forventer (koden læst i `TrainingPage.jsx` og `components/training/`)

Kolonnerne "forventning" og "hvorfor intet sker" er hypoteser ud fra koden og skærmbillederne, ikke verificeret i optagelser.

| Mønster | Hvad elementet er i dag | Sandsynlig forventning | Hvorfor intet sker |
|---|---|---|---|
| **Rytternavn** | Desktop: et link til rytterprofilen inde i en bred navnecelle. Mobil-beta: rækken folder kortet ud | Klik på rytteren = se og ændre HANS træning (dag, form, træthed, fremgang) | Klik ved siden af navneteksten rammer cellen, ikke linket. Rammer man linket, forlader man siden (quickbacks) |
| **"on"** | Værdien af de umærkede checkbokse: markér-kolonnen forrest i rosteret, "Vælg alle", "Group by type" og assistentpanelet | Enten "vælg til mængde-handling" eller "tag rytteren med i dagens træning" (en boks forrest på en side der hedder Train today) | Kolonnen har ingen overskrift ud over en boks, 16 px mål i en 40 px celle, og mængde-bjælken dukker op over tabellen, ikke ved rækken |
| **Rest / Active recovery / Training** | Samme ord to steder: rækkens knaprække "Rest · Active recovery · session" og dagspanelets trin 1 | Tryk = dagen skifter, og man kan se at det er gemt | Tryk på den allerede valgte knap gør intet. På løbsdage er rækken dæmpet men aktiv, og skiftet gælder først næste ikke-løbsdag. I panelet viser "Training" trin 2 længere nede, ofte uden for synsfeltet |
| **Save day / Gem dag** | Dagspanelets gold primary. Deaktiveret indtil valget er komplet OG ændret (`!complete \|\| !dirty`) | "Gem og luk", også når man bare bekræfter det der står | Klik på en deaktiveret knap er dødt pr. definition. Typisk: "Training" valgt uden session, eller panelet åbnet uden ændring |
| **Train today (+25 %)** | Sidens gold primary. Deaktiveret når dagens træning er kørt, flaget er off eller dagen ikke er lukket | "Kør træningen nu" eller "vis mig resultatet" | Knappen står grå (men gul) resten af dagen efter kørslen |
| **Træthed** | Sortérbar kolonneoverskrift (desktop), etiket i mobilens rytterkort | Sortér efter træthed eller forklar hvad træthed betyder | På 1440 ligger kolonnen uden for skærmen til højre; sorteringen giver ingen tydelig tilstand |
| **Individuel ugeplan** | Tekstlink i rækkens yderste kolonne, folder en ekstra række ud | Åbn rytterens egen ugeplan | Den udfoldede række starter i venstre side af en vandret scrollet tabel, uden for synsfeltet |

## 4. Konsekvens for designet

1. Første skærm skal svare på "hvem mangler en dag, hvem kører løb, hvem er træt" (mobil-tiden er 41 s).
2. Ingen deaktiverede primærknapper: både "Train today" og "Save day" er store kilder til døde klik.
3. Én vej til at skifte en rytters dag, med synlig kvittering. I dag findes tre (dropdown, knaprække, panel).
4. Rytternavnet skal åbne rytterens træning på siden, ikke sende spilleren væk.
5. Markér-kolonnen skal hedde noget, og handlingen skal stå ved rækkerne.
6. Programmet og de individuelle ugeplaner hører til i fanen Week plan, ikke øverst på Today og ikke i en række-kolonne.
