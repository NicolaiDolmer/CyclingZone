# Udvikling 2.0: potentiale P (1-99) og udviklingsmodel G3a

**Status:** design 20/11 2026 (DolmerPC, ejeren i sessionen; Fable som arkitekt). Afløser kandidat B som tændingskandidat for XP. Intet er tændt. **Epic:** [#6110](https://github.com/NicolaiDolmer/CyclingZone/issues/6110). **Tal:** kun privat i `balance-internals/6110/revision-2026-11-20/` (hard rule 17); dette dokument er kvalitativt.

**Dette dokument er SSOT for topalder, plateau og nedgang.** Alle andre kilder (GDD D-058, PROGRESSION_RULES, TRAINING_RULES, Hjælp, patch notes) henviser hertil og rettes, når G3a er målt.

## 1. Hvorfor

Prøvekørslen af kandidat B for tændingsnatten 20/11 gav de højeste stjerner ca. fire gange så mange point pr. dag som i dag og alle andre færre. Ejeren: fordelingen skal spredes jævnt, og potentialet skal designes færdigt først. Revisionen fandt desuden, at topalderen har glidet fra den oprindelige plan (27-28, kernesystemer 11/6) til 30-35, fordi den aldrig var et krav, en dommer kunne fejle på.

## 2. Potentiale P

- **P (1-99) er den rating for rytterens bedste ryttertype, vi forventer han ender på.** 50 giver ca. 50, 75 ca. 75, 99 ca. 95. Spejdere leder efter tallet.
- **Fast fra fødslen.** Kun skønnet, spilleren ser, flytter sig (afløser retning C's levende talent).
- **P måles med gennemsnitlig træner og facilitet.** En klub med mere giver lidt over P, en med mindre lidt under.
- **Omregning fra stjerner** (1-6 i halve trin) bevarer rækkefølgen; kun toppen presses ned (låst 11/10). Står en rytter allerede over sit nye P, hæves P til hans rating. Ingen rating ændres af omregningen.
- **Fordeling:** høje potentialer er sjældne. Tilgangen (akademiet = søndagens årgang) kalibreres til samme fordeling som bestanden, så toppen hverken tyndes ud eller vokser; målet er ca. én rytter med højt potentiale pr. aktiv manager. Researchen (Football Manager, OOTP, Basketball GM, Hattrick/Sokker) viser, at tilgangen bestemmer bestanden efter én karrierelængde, og at en selvregulerende tilgang svinger.
- **Hamstring** bremses med pris: høje potentialer er dyre.

## 3. Udviklingsmodel G3a

- **Ingen alder i udviklingen** (ejerens faste regel). Farten afhænger af potentialet og af **afstanden** mellem rytterens nuværende rating for bedste type og hans P. Jo længere fra, jo hurtigere; tæt på P går det næsten i stå. Stagnationen opstår af sig selv. P er dermed et blødt mål (som D1b 11/10 og spec 11/7: "forskellen kommer fra deres gap, ikke deres alder").
- **Pris pr. evnepoint er logaritmisk:** hvert point er en fast lille procent dyrere end det forrige. Kandidat B's stejle pris udgår.
- **Ingen hård grænse pr. dato.** Fjernes i kode før tænding; modellens fart gør flere point på én dato sjældent.
- **Kroppens aldring:** ved sæsonskiftet taber de fysiske evner (og brosten) en glidende procent, fra omkring 31 og stigende; teknik og de mentale evner taber mindre og senere. Løbsdage bremser faldet. **Det tabte kan ikke trænes tilbage (slid):** rytterens top sænkes varigt med det, aldringen har taget. Uden slid træner en rytter faldet tilbage hver sæson, og ingen bliver dårligere.
- **Faldet er proportionalt:** de bedste taber flest point, de svage færrest.
- Træthed over ca. 70 giver lidt mindre XP. Træner og facilitet skal kunne skalere med flere trin. Juniorer og akademiet følger samme model. Skade: ingen XP, intet tabes. AI-holdenes ryttere udvikler sig ikke. Gemt fremgang udbetales på rytterens første XP-dato.

## 4. Karrierebuen (krav, som dommeren fejler på)

- P nås omkring 28 (den oprindelige plan: top 27-28).
- Plateau: evnerne står næsten stille fra ca. 28 til 30-31.
- Herefter et tydeligt, men realistisk fald; mange løb halverer det omtrent, få løb øger det.
- Faldet sker kun ved sæsonskiftet, aldrig ved tænding eller midt i en sæson.
- **Gate i dommeren (hård):** rating ved 28 tæt på P for alle P; plateauet dækker mindst 28-30; median topalder 28-30 ved alle løbsmængder; faldet ved 34 og 38 inden for de private mål; mange løbs fald højst ca. 60 % af få løbs; 15-sæsoners-kørslen med median topalder 28-30. Fejler gaten, tændes intet.

## 5. Skøn og prognose

- Skønnet over P vises som ét tal med et sikkerhedsord (låst 23/10). Egne ryttere: skarpere med træning (5/12/20 datoer, låst 11/10). Andres: intet uden scouting. AI-ryttere på AI-hold kan ikke scoutes. Opdateres søndag og ved holdskifte.
- **Prognosen** (kun egne ryttere): én samlet rating, "fortsætter du den nuværende fart, ender du omkring her ved toppen", regnet med rytterens fart de sidste 30 dage. Alle flader læser samme kilde.
- **UI:** stjernerne fjernes helt; tal + sikkerhedsord overalt; samme tal hele livet; egen sorterbar kolonne "Potentiale" efter Rating i trup- og markedslister. Lofter og den gamle prognose fjernes fra fladerne.
- XP og potentiale-tallet går live samme dag. Værdi/løn-omregning og AI-holdenes styrke over tid afgøres efter tænding.

## 6. Byggeplan (alt bag slukkede kontakter; Fable-dom før merge af motor-PR'er)

1. Fjern grænsen pr. dato + afstandsfaktor i XP + logaritmisk pris + `expectedCareer` med roterende plan og samme faktor.
2. P (1-99) gemt pr. rytter + omregning som dry-run + akademiets fordeling i 1-99.
3. Aldring i procent ved sæsonskiftet + gemt slid pr. rytter (additiv migration), kun under XP-kontakten.
4. Skøn og prognose på samme kilde; flader: tal i stedet for stjerner, kolonne, prognose; lofter væk.
5. Talfil + kalibrering + 15-sæsoners-dom med gaten i §4; derefter Hjælp, patch note og docs rettet til §4; ejerens "kør".

## 7. Afløst

Kandidat B (stejl pris, x3,5 fra 5 stjerner, "top 75/78"), "XP ens hele karrieren / samme XP til og med 32", "kun fart, intet loft" (svar 20/11 tidligt på aftenen), og alle topaldre i andre dokumenter, der afviger fra §4.
