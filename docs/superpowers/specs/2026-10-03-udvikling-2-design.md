# Udvikling 2.0 (S4): niveau-kurve, løb der betaler sig, tilbagegang man kan påvirke

**Status:** retning ejer-besluttet 2-3/10 · design færdiggøres søndag 4/10 / mandag 5/10 · byg uge 41 (6.-10/10)
**Epic:** [#6110](https://github.com/NicolaiDolmer/CyclingZone/issues/6110) · **Dele:** [#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564) kurve · [#5950](https://github.com/NicolaiDolmer/CyclingZone/issues/5950) løbsudvikling · [#6109](https://github.com/NicolaiDolmer/CyclingZone/issues/6109) tilbagegang · [#6059](https://github.com/NicolaiDolmer/CyclingZone/issues/6059) knæk ved sæsonskiftet · [#5965](https://github.com/NicolaiDolmer/CyclingZone/issues/5965) analyse af udviklingsfart
**SSOT for reglerne:** [`docs/PROGRESSION_RULES.md`](../../PROGRESSION_RULES.md) §11 · **GDD:** D-058-D-060
**Tal:** privat i `balance-internals/2026-10-03-udvikling-2/` (hard rule 17). Dette dokument beskriver mekanikken kvalitativt.

## 1. Hvorfor nu

Discord #dansk-snak 2/10 (bobby2106 = ejeren, thelamba, jeppek, egomadsen, friisisch) diskuterede alder, potentiale og udvikling. Ejeren konkluderede samme aften:

- *"Alderen påvirker komplet overtunet udviklingen. Unge ryttere udvikler sig for meget."*
- *"Denne udvikling, som man tager fra alderen, kan man lægge ind i 'evnerne' … nemmere fra 1-10, end fra 90-100."*
- *"Sværhedskurven (let 1-10, svært 90-100) - Virker ikke optimalt. Skal forbedres. (Gøre større forskel)"*
- *"Udvikling fra løb [er] ikke tæt nok på udvikling fra træning."* Og: *"Træning går stadig for hurtigt."*
- *"Idag er … 91% af alle ryttere der kan peake for tidligt."* Model A (*"83% … kan peake som 21 årige"*) støttes ikke.
- Løbsforslagene 1-3 i §4 postet offentligt som *"noget jeg arbejder med"*.

Spillernes pointer, der skal bevares i designet:
- thelamba: *"1 point mistet føles meget værre end +10 mens man udvikler."* Op og ned må ikke begge føles dårligt.
- thelamba: løb skal være vejen for de bedste, træning skal forme de unge.
- egomadsen: god fra 23, top 27, god til 32 er nok.
- jeppek: 90 efter ca. 9 sæsoner for et stort talent er fint. Bagudrettede ændringer ville være et selvmål.

## 2. Hvad der er sandt i dag (målt 2-3/10)

1. **Motoren** udvikler efter afstand til rytterens eget loft × en alderstabel × et ungdomstillæg. Alderen er den dominerende knap. Det samme spring i en kerneevne tager flere gange længere som 26-årig end som 16-årig. En toptalent er næsten færdigudviklet som 21-årig.
2. **Beslutning 4 fra 9/8** (absolut-niveau-kurve, top omkring 27, "færdig ved 20-21 er en fejltilstand") blev fittet i `curveHarness3564.mjs`, men aldrig bygget ind i motoren.
3. **Løbsdagen** udvikler som et normalt pas. Den giver omkring halvdelen af en hård træningsdag og koster træthed, der tvinger til hvile. Ejer-valget 6/8 (løb lidt over det pas, det erstatter) er ikke i motoren.
4. **Tilbagegangen** er en fast trappe efter alder ved sæsonskiftet, uafhængig af løb og træning. En 29-31-årig vinder langt mindre på en sæson, end han taber ved skiftet.
5. **Ved sæsonskiftet** får AI-ryttere og frie ryttere sæsonvækst, managerryttere gør ikke. Det er "knækket" (#6059).
6. **De unge i toppen** er launch-genererede (22.-26. juni). Det er en genereringsfejl, ikke træningen. Ejeren: *"Det er jo bare en fejl der skal rettes, som i så fald ikke burde tages med i samtalen."*
7. **"Træning er nerfet"-følelsen** forklares delvist af, at hele holdet bliver et år ældre ved skiftet og derfor træner langsommere med samme motor (ejer 2/10).

## 3. Besluttet

| ID | Beslutning | Dato | Kilde |
|---|---|---|---|
| D-058 | **Kurvemodel B:** udviklingen styres af niveau (hvert point koster mere jo tættere på 100) og potentiale (fart). Alder er ikke længere en turbo. Alder vender kun tilbage som *belastningsevne*: de helt unge tåler ikke fuld træning, så de går langsommere på samme niveau, men starter lavt, hvor point er billige. Sværhedsforskellen mellem lavt og højt niveau skal være større end i dag. Mål: omkring 60 % ved 22, omkring 85 % ved 25, top 27-28. | 3/10 | #3564, Discord 2/10 |
| D-059 | **Løbsdag = hård dag + tillæg i etapens profil-evner, vægtet efter rolle.** Kaptajn og angribere mest i de afgørende evner, hjælpere i de sekundære. Løb skal slå træning, men være mindre målrettet. Planen er fortsat ikke input på en løbsdag. Afløser variant A's mellem-pas (24/9). | 3/10 | #5950, Discord 2/10 |
| D-060 | **Retning: løb bremser tilbagegangen** ("kilometer i benene"). Mange løbsdage giver mindre fald ved sæsonskiftet. Omfang og stilstandsår designes i D4. | 2/10 | #6109 |

Modellen A (ren niveau-kurve uden alder) er fravalgt, fordi lave niveauer er billige, så de unge stadig ville være næsten færdige som 21-årige.

## 4. Design-kort søndag 4/10 / mandag 5/10

Ét kort ad gangen med billede, i denne rækkefølge, da hvert kort bygger på det forrige:

| Kort | Spørgsmål | Input |
|---|---|---|
| D1 | Kurvens stejlhed og belastningsevnens profil (hvor hurtigt de unge når fuld belastning) | harness-fit mod milepælene, "større forskel" (ejer 2/10) |
| D2 | Samlet tempo: skal træning give mindre, løb mere eller begge? | #5965-analysen (lovet man 5/10), ejer 2/10 "træning går stadig for hurtigt" |
| D3 | Rollevægte på løbsdagen; bliver +1 pr. evne pr. løbsdag? | #5950, eksisterende `raceRoles`/indsats-signaler |
| D4 | Tilbagegang: start, stilstandsår, hvor meget løb bremser, og om træning også bremser | #6109, thelamba/egomadsen 2/10 |
| D5 | Eksisterende ryttere: kun fremadrettet (anbefalet) eller bagudrettet rettelse | rating-reglen (synlige ratings falder aldrig uden ejerens vidende), jeppek 2/10 |
| D6 | AI-ryttere og frie ryttere på samme kurve som managerryttere, så sæsonvæksten fjernes | #6059 |
| D7 | Indfasning: kurve og løb midt i S4 bag flag; tilbagegang ved S4→S5 | sæsonkalenderen |

Anbefaling til D5: kun fremadrettet. Launch-ungdommen (§2.6) behandles som separat fejl med eget kort, hvis den skal rettes.

## 5. Byg uge 41

Rækkefølge. Hvert trin har egen PR, flag og verifikation:

1. **Harness og scorecard** (`backend/scripts/dev/`): kurve B, løbsdag og tilbagegang simuleret samlet mod hele feltet. Gates: milepælene i D-058, aldersfordelingen i top 50 over 5 sæsoner, 0 synlige ratingfald, løbsdag ≥ hård dag i profil-evner.
2. **Kurve B** i `dailyAbilityDelta` bag nyt flag. Alderstabel og ungdomstillæg udfases som turbo; belastningsevnen indføres.
3. **Løbsdag** i `raceDayYield.js` bag flag: hård basis, tillæg, rollevægt.
4. **Tilbagegang** i `riderProgression.js`'s sæson-trin: løbsdage tælles pr. sæson, bremsen anvendes ved skiftet.
5. **AI og frie** gennem samme kurve; sæsonvæksten i `riderProgressionEngine.js` fjernes eller omlægges.
6. **Forklaring:** `help.json` (en+da), patch note og Discord-tekst (ejeren poster selv). Udviklingsfart vist som hurtig/normal/langsom med årsag (#3659).

## 6. Hvad der ikke ændres

Potentialets skala (1-6 internt, §3 i PROGRESSION_RULES) · 140 løbsdage pr. sæson (låst) · ét løb ELLER træning pr. løbsdag · pension 36-40 med varsel · rating-opskrifterne.
