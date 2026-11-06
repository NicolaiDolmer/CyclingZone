# Udvikling med XP: fælles prisliste, potentiale giver XP

**Status:** design 6/11 2026. Intet er bygget, intet i spillet er ændret. Fokus-spørgsmålet afventer spillernes svar (§2, Å1).
**Epic:** [#6110](https://github.com/NicolaiDolmer/CyclingZone/issues/6110), ejerens kommentarer 6/11.
**Bygger på:** [samlet design 23/10](2026-10-23-6110-potentiale-et-tal-samlet-design.md) · [del 2 catch-up](2026-10-23-6110-del2-catchup-design.md) · [spec 3/10](2026-10-03-udvikling-2-design.md) · [katalog v3](2026-10-29-training-catalog-v3-design.md). Hvor de er i modstrid med denne spec, gælder §10.
**Tal:** privat i `balance-internals/6110/xp-model-grundlag-2026-11-06.md` (hard rule 17). Dette dokument er kvalitativt. Det private grundlags afsnit 7 er den gældende model.

## 0. Kort fortalt

1. Alle ryttere bruger **én fælles prisliste**. Næste point i en evne koster XP efter evnens værdi, og intet andet.
2. **Potentialet afgør, hvor meget XP rytteren tjener om dagen.** Forskellen mellem ryttere ligger i XP, ikke i prisen.
3. Der er **intet hårdt loft pr. evne**. Stejl pris i toppen og lavt XP ved lavt potentiale gør, at svage ryttere reelt ikke når toppen.
4. **XP falder tydeligt fra ca. 29 år.** Før det tjener samme rytter ca. det samme som 19-årig og 28-årig. Han stiger langsommere, fordi evnerne bliver dyrere.
5. Træning giver XP i **sessionens fokus**. Manageren skal skifte mellem træninger over tid (retning besluttet, låses efter spillersvar).
6. **Evner uden for rytterens type giver lidt mindre XP.** Alt kan trænes, men en ren sprinter bliver ikke topklatrer.
7. **XP-tallet vises.** Træningerne varierer fra dag til dag, så potentialet først kan estimeres over tid.
8. **Mentale evner følger samme prisliste**, uden særskilt loft.
9. Alt ligger bag **én slukket kontakt**. Den tændes kun mellem to datoer, tidligst efter 14/11, og kun efter en 10-sæsoners-kørsel.

## 1. Besluttet af ejeren 6/11

| # | Beslutning | Erstatter |
|---|---|---|
| B1 | Én fælles prisliste, højere evne koster mere XP | Niveau-leddet i kurve B med afstand til et loft |
| B2 | Potentiale afgør XP pr. dag | Potentialets fart plus blødt loft (D1b, S2) |
| B3 | Samme rytter tjener ca. samme XP som 19-årig og 28-årig | Alderens rest i kurven |
| B4 | Intet hårdt loft pr. evne | Rolleklassens hårde tag som stopklods |
| B5 | XP falder tydeligt fra ca. 29 år | Aftrapning af loftet efter toppen (#2472's form) |
| B6 | Træning giver kun XP i de evner, manageren vælger. En bjergrytter kan trænes til bakkerytter | "Kun signaturen når toppen" som fast regel (S5) |
| B7 | Evner uden for typen får lidt mindre XP. Alt kan trænes, en ren sprinter bliver ikke topklatrer | Rolleklassens loft |
| B8 | XP-tallet vises. Træninger varierer, så potentiale først kan estimeres over en længere periode | Bjælkens rå procent |
| B9 | Mentale evner følger samme prisliste, intet særskilt loft | Mentalt tag-loft (#5268) |
| B10 | Vi bruger dagens træninger. De giver kun det, de realistisk fokuserer på. **Spillerne spørges, før det låses** | Off-fokus-andelen (se Å1) |

Det åbner #2472's form og K3b og erstatter #7757-forklaringen. PR #7769 holdes tilbage.

## 2. Åbent

| # | Spørgsmål | Hvem | Hvad afhænger af svaret | Anbefaling |
|---|---|---|---|---|
| **Å1** | **Fokus-spørgsmålet:** giver en session kun XP i sine egne evner, så manageren må skifte mellem træninger over tid? | **Spillerne, derefter ejeren. ÅBENT, må ikke låses** | Off-fokus-andelen (§4.6), assistentens plan, kørslens variant | Ingen, ejeren har sagt, at spillerne spørges først |
| Å2 | Bliver XP-tallet og Udviklingsscoren ét tal? | Ejer | Trin 7, navneskiftet 20/10, S9, S10 | Ét tal: XP. Scorens 1-99-skala og navneskiftet udgår (§5.3) |
| Å3 | Skal omregningen 1-6 til 1-99 og retning C's levende talent bygges alligevel? Begge er låst 11/10 | Ejer | Trin 12, kolonnerne til grundtalent, om potentialet står fast | Nej. XP læser dagens potentiale direkte, og B3 peger på et fast potentiale (§6) |
| Å4 | Hvor meget er "lidt mindre" for evner uden for typen? | Ejer, efter kørslen | Typens andel (§4.7) | Sæt den efter gate X4, ikke på forhånd |
| Å5 | Dagsvariationens form: kun dag for dag, eller med gode og dårlige perioder? | Ejer, efter måling | H6b, reglen fra 5/11 om at alt har en ægte årsag | Mål begge, vis ét kort (§5.2) |
| Å6 | Skal rytterens type følge med, når han er trænet om? | Ejer | Hvilken evne der tæller som type | Nej. Typen er anlæg, bedste rolle følger evnerne som i dag (§4.7) |
| Å7 | Falder XP også for mentale evner efter ca. 29 år? Lederskab skal toppe sent (D-030) | Ejer | Aldersleddet for mentale evner | Samme fald for alle, undtagen hvis kørslen viser, at lederskab ikke når sin top |

Ingen af disse afgøres i denne spec. Hver af dem får et kort med tal, ét ad gangen.

## 3. Hvad der er sandt i dag

Læst i koden på `origin/main` 6/11 og i det private grundlag (prod læst med SELECT 6/11).

- **Kæden:** `dailyAbilityDelta` (`dailyTraining.js`) giver en rå fremdrift pr. evne. Under kurve B er basis niveau gange afstand til loftet. `gap === 0` giver 0, så en evne på det hårde tag står stille.
- **Lageret:** `rider_derived_abilities.ability_progress` er en andel (0 til 1) af næste point pr. evne. Klippede point bæres videre og kan lægge baren over 1. Reglen maks +1 pr. evne pr. dato er live (`ability_cap_per_date_enabled`).
- **Off-fokus:** alle evner uden for sessionen får i dag en lille andel (`offFocusMult`). Løbsdage har samme off-fokus (`includeOffFocus`).
- **Sessioner:** katalog v3 er live. Holdarbejde og Lederskab er i ingen session; S21 lader dem udvikle sig gennem løb efter rolle. Alle andre synlige evner er dækket af mindst én session.
- **Lofterne bærer mere end træningen:** `ability_caps` genberegnes ved hvert tick. Klassifikationen af ryttere uden gemt anlæg og værdisporet læser dem. En rytter med `archetype_draw` beholder sin type, uanset hvad han trænes til.
- **Kontakter:** `development_curve_b`, aldring, +1 pr. dato og løbsdagens rolletillæg er on. Score B (`development_score_v2`), catch-up (`race_day_catchup_enabled`) og skønnets `potential_estimate_*` er off.
- **Overgangen #7382:** stemplet i prod er 31/10. De 14 kalenderdage løber dermed til og med 13/11.
- **Tomme kolonner:** `riders.talent_ceiling` og grundtalentet har ingen rækker, og der er ingen gemte skøn. Der er intet at omregne eller rydde.

Målt baseline (AGENTS regel 36) står i grundlagets afsnit 1 og 2.

## 4. Modellen

### 4.1 Prisen

Pris for næste point er en ren funktion af evnens værdi. Den er ens for alle ryttere, alle typer, alle aldre og alle evner, også de mentale. Prisen stiger stejlt mod toppen af skalaen, men er endelig helt op til 99. Der er ingen mur, og en evne på 99 køber ikke flere point. Prisens form og eksponent er privat. Det valgte niveau er et kompromis mellem top og bund, ikke et optimum.

### 4.2 XP pr. dag

XP på en evne er et produkt af led. Enheden er én hård dato. Motorens tick får sin andel gennem den eksisterende deler (#6711), så sæsonens længde ikke flytter udbyttet.

| Led | Indhold | Kilde |
|---|---|---|
| Potentiale | XP pr. dag fra en privat tabel pr. potentialetrin. Spændet er større end dagens fartspænd, fordi det skal erstatte det bløde loft | B2 |
| Alder | Fuldt til og med 28, derefter tydeligt faldende | B5, §4.5 |
| Session | Intensitet og evnens vægt i sessionen, uændret fra katalog v3 og `abilityMult` | S12, B10 |
| Type | Andel efter rolleklasse | B7, §4.7 |
| Færdighedsdag | Uændret: en færdighedsdag træner højst til håndværks-raten (#3762) | 14/8 |
| Træner og facilitet | Kun på træningsdage | S13 |
| Træningsdisciplin | Løfter dagens udbytte, hvis trin 19 bygges (§9) | S11 |
| Dagsvariation | Deterministisk pr. (rytter, dato) med en hemmelig nøgle på serveren, neutral over en sæson | B8, §5.2 |
| Intention på løbsdage | Uændret multiplikator (#6641) | live |

Form og træthed er ikke led i XP (S29). Træthed koster gennem form og skadesrisiko. Belastningsevnen (D1) er neutral i de gældende params og føres ikke med over. Viser kørslen, at de helt unge går for hurtigt, er det et nyt ejer-kort.

### 4.3 Bjælken

- Bjælken gemmes **fortsat som en andel** i `ability_progress`. Vist XP = andel gange prisen for næste point.
- Når et point købes, regnes overskuddet om til den nye pris, så ingen XP går tabt eller opstår. Dagens `bar -= 1` kan ikke genbruges, fordi prisen skifter mellem to point.
- Maks +1 pr. evne pr. dato står uændret. Det, der klippes, bæres videre på bjælken.
- Fremdrift gemmes altid (S8). Falder en evne ved sæsonskiftet, står andelen uændret.
- XP-tallet skrives i tick-rapporten (`training_rider_ticks.report`), som også kan bære løbsdage. Ny tabel er ikke nødvendig.

### 4.4 Potentiale

Potentialet styrer kun XP pr. dag. Prisen afslører det ikke. Denne spec regner med, at det står fast gennem karrieren, og at dagens trin 1-6 i halve trin rækker til modellen. Begge dele er en slutning fra B2 og B3, ikke en ejerbeslutning (Å3).

### 4.5 Alder

- Fuld XP til og med 28 år. Ingen ungdomsfaktor, ingen alderstabel.
- XP falder tydeligt fra ca. 29 år. Kurven og vurderingen af den er private (`balance-internals/6110/`).
- En variant, hvor XP er uændret og kun sæsonfaldet bremser, udgår med B5.
- Tilbagegangen ved sæsonskiftet (D4) er uændret: intet fald til og med 30, fald fra 31, kun fysiske evner, løbsbremse. Kun D4's "ingen fremgang" på plateauet afløses af det lave XP.

### 4.6 Fokus (ÅBENT, se Å1)

**Retning:** en session giver XP i sine egne evner og intet andet. Manageren skal skifte mellem træninger over tid for at bygge en hel rytter.

**Må ikke låses, før spillerne har svaret.** Designet er bygget, så svaret kun flytter ét privat tal: off-fokus-andelen i XP-params. Ingen af de andre afsnit afhænger af den.

| | Kun fokus | Lille off-fokus bliver |
|---|---|---|
| Manageren | Skal rotere sessioner | Kan stå på én session |
| Assistentens standardplan | Skal rotere (`resolveProgram` vælger i dag ét fokus) | Uændret |
| Holdarbejde, Lederskab | Kun gennem løb, som S21 | Også lidt gennem træning |
| Kørslen | Skal køre med roterende plan | Kører med standardplan |

Kørslen køres med begge, så svaret ikke koster en ny runde. Løbsdage er ikke en del af spørgsmålet: et løb er bredere end en træning (D2: løb slår træning, men er mindre målrettet), og de beholder deres nuværende fordeling.

### 4.7 Rytterens type

- Rolleklassen flytter fra at være et loft til at være **en andel af XP**: evnens XP = sessionens vægt gange klassens andel.
- Andelen er det, der holder typerne adskilt.
- Hvor stort springet mellem signatur og sekundær skal være, er Å4. Bemærk spændingen: ejeren siger "lidt mindre", og dagens rater ligger langt fra hinanden. Gate X4 afgør, hvor lidt det kan være.
- Typen er anlæg. En bjergrytter, der trænes til bakkerytter, beholder sin XP-andel, men hans evner og bedste rolle flytter sig (Å6).

### 4.8 Mentale evner

Samme prisliste, uden `MENTAL_ABILITY_TAG_CEILING` i XP-stien. De falder fortsat aldrig (D4). Holdarbejde og Lederskab udvikles efter rolle i løb (S21). Risikoen er, at evner uden fald løber fra de fysiske på lang sigt, derfor gate X7. Holdarbejde og Lederskab er stadig uden for rating-opskriften.

### 4.9 Løbsdage

Reglerne står, oversat til XP: en løbsdag er en hård dag plus et tillæg i etapens evner, vægtet efter rolle (D-059, D3). Træner og facilitet tæller ikke (S13). Udgået rytter får basis (S16), fri rolle er halvt af hver (S17). Løb skal fortsat slå træning i etapens evner (D2, G1). Fordi potentialet giver XP, afhænger løbsdagens udbytte af potentialet. Det skal ses sammen med catch-up, når #6950 besluttes.

### 4.10 Uændret

AI-ryttere og frie ryttere udvikler sig ikke (D6). Ét løb eller træning pr. løbsdag. Synlige ratings falder aldrig uden ejerens vidende. Pension. Rating-opskrifterne. Træn nu afregner samme kæde.

## 5. Visning

### 5.1 XP-tallet

- Evnerækker og træningsrapport viser **XP**: dagens XP på evnen og "x af y XP til næste point". Det afløser bjælkens rå procent og svarer #7757: en hel træningsdag kan ikke længere ligne nul, heller ikke for en evne, hvor næste point koster mange sæsoner.
- XP vises kun for rytterens **egen manager**, som scoren i dag. Aldrig i svar til andre hold (H4).
- Løbsdage får XP på samme skala. Det opfylder S9.
- Tooltips og Hjælp om "Rollens loft" skrives om samme dag (krav 20/10): `rider.json` `loftTitle`, loft-visningerne i scouting og holdliste, `help.json`.
- Følger TASTE og de bindende skabeloner. Tal i tabular figures. Ejeren ser preview (desktop og Android-bredde) før merge.

### 5.2 Variationen og læsbarheden af talentet

Dette er modellens sværeste punkt. Spændet i XP er stort, og XP er nu selve potentialet. Med en variation på størrelse med dagens kan en spiller regne talentet ud på få dage. Det er for hurtigt mod ejerens "over en længere periode" (6/11) og "omkring 5-10 træninger" (11/10).

- Krav: gate H6b gælder fortsat, nu på XP-historikken. Talent udledt af XP må ikke være mere præcist end holdets eget skøn efter samme antal afregnede datoer.
- Variationen skal hæves til det niveau, H6b kræver, og må ikke flytte sæsonens samlede udbytte.
- **Variationen skal bruge en hemmelig nøgle.** Repoet er offentligt, og `seededUnitMixed` er en åben hash. Seeded alene på rytter og dato kan en spiller regne variationen efter og trække den fra, uanset hvor stor den er. Nøglen ligger i `private_config` sammen med XP-params og sendes aldrig til klienten. Samme rytter og dato giver stadig samme tal ved en gen-kørsel. Gate X9 måles mod en spiller, der kender den offentlige kode og alle input undtagen nøglen.
- Variation dag for dag midles hurtigt væk. Variation med hukommelse (gode og dårlige perioder) skjuler talentet længere ved samme daglige udsving. Begge måles (Å5).
- Reglen fra 5/11 er, at alt har en ægte årsag. Ren dagslotteri kolliderer med den, og S10 forbyder en faktorforklaring. Kortet til ejeren skal tage stilling til det.

### 5.3 Udviklingsscoren (Å2)

S22 siger, at scoren er udviklingen. Med XP er det opfyldt af XP-tallet selv. Score B's kobling i motoren er overflødig, og dens talent-led passer ikke til det nye spænd. Anbefaling: ét tal (XP) med 7-dages snit ved siden af. Afgøres på et kort, ikke her. Indtil da forbliver `development_score_v2` off.

## 6. Skønnet: hvad potentiale-tallet nu viser

Det samlede design 23/10 skønner over "det sande loft". Uden loft findes den størrelse ikke. Tallet er stadig ét skøn med et sikkerhedsord, i ratingens skala, på alle flader (låst 23/10). Det sande tal bliver i stedet **rytterens forventede topniveau**: det niveau, prislisten og hans XP pr. dag fører ham til med en standardkarriere fra hans nuværende evner i hans naturlige rolle.

- Det regnes ét sted, så skøn, prognose og akademi fortsat er én kilde (trin 4).
- Det opdateres ved søndagskørslen (§3.3 i designet 23/10).
- Den bevidste undtagelse fra doktrinen #5490 står: skønnet er visning, motoren regner på det sande potentiale.
- Retning C's bevægelige loft har intet at flytte, når loftet er væk (Å3). K1's særlinje om ryttere over loftet har intet at beskrive.
- Skønnet vises aldrig under nuværende rating, som hidtil.
- Omregningen 1-6 til 1-99 er ikke længere nødvendig for motoren eller visningen. Den er låst, så det kræver ejerens ja (Å3). Svarer ejeren, at det levende talent skal bestå, bliver XP pr. dag det, der flytter sig. Prisen er urørt, og resten af modellen står.

## 7. Overgang bag én slukket kontakt

### 7.1 Kontakten

- **Én kontakt:** `development_xp_model` (arbejdsnavn), binær, fail-safe off. Kun `on` tænder, `beta` læses som off, som kurve B: det er en balanceændring for hele ligaen.
- **Tal:** `development_xp_params` i `private_config` (#7390), aldrig i `app_config`. Kontakt on med manglende eller ugyldige params er dagens model plus en advarsel i loggen. På dato-stien læses den strengt.
- **Kontakten styrer alt:** motor, API-felter, visning, Hjælp (`helpFlagGates.js`) og tekster. Der er ingen separate underkontakter, som kan tændes hver for sig.
- **Off er bit-identisk,** bevist mod en frossen kopi af merge-base-koden, aldrig mod den nye kodes egen off-gren (#7587).
- **Samspil:**
  - `development_curve_b` står on, og XP vinder, når begge er on. Så lander en slukning på kurve B.
  - `development_score_v2` skal være off. XP og Score B samtidig er en ugyldig opsætning: dato-stien kaster, så datoen prøves igen.
  - `race_day_catchup_enabled` må først tændes med XP, når catch-up er udtrykt i XP (#6950).
- **Preview:** visningen kan ses med override på preview, før noget tændes.

### 7.2 Tænding

Tændes **kun mellem to datoer**. En dato må aldrig afregnes med to modeller, heller ikke når Træn nu har afregnet et hold tidligt, eller aftenkørslen afregner resten.

- Sammen med kontakten gemmes en startdato (`development_xp_from_date`, dansk dato). Motoren vælger model ud fra tick-datoen, ikke ud fra hvornår kontakten blev slået om. Efterslæb for datoer før startdatoen kører med dagens model. Det er samme erfaring som #7382.
- Kontakten slås om, efter at datoens aftenafregning er verificeret for alle hold, og startdatoen er den næste dato.
- **Tidligst efter 14/11.** #7382-overgangen slutter 13/11, og de to overgange må ikke overlappe. Det betyder, at aftenafregningen 14/11 er det tidligste skæringspunkt, og første XP-dato tidligst er 15/11. Det er et gulv, ikke en plan. Der er ingen dato, før gaterne er grønne.
- Aldrig på en dato med sæsonskifte.
- D7's søndag gælder skønnets visning, fordi søndagskørslen skriver det. Selve XP-kontakten kræver kun et datoskifte. Om de to tændes sammen, afgøres på tænd-kortet.

**Krav før tænding:** Å1 afgjort, §8 grøn, frossen golden grøn, privat tænd-kort, ejerens ordrette "kør" på netop det skridt, efter at ejeren har set den live tilstand. Hjælp en+da, patch note og Discord-udkast er klar samme dag.

### 7.3 Eksisterende ryttere og data

- **Ingen evne ændres, og ingen rating falder ved tænding.** Der køres ingen massemutation og ingen omregning.
- Bjælken bevarer sin andel. Ingen data skal migreres.
- Evner, der står fast ved det gamle hårde tag eller i klippet lige under et point, begynder at købe point igen. Baren over 1 betales ud med højst +1 pr. dato. Gate X6 måler den første uge, så det ikke bliver et spring, spillerne oplever som en fejl.
- **Ingen ny glidende overgang og intet nyt øjebliksbillede.** #7382 og D5 fandtes, fordi evner over et loft ellers ville bremse brat. Uden loft findes gruppen ikke. Tabellen fra #7382 røres ikke.
- Ryttere med lavt potentiale og lave evner får lidt mindre pr. dag, og ryttere over det gamle bløde loft får mere. Kørslen viser hvor meget. Er ændringen synlig for en gruppe, får ejeren et kort før tænding.

### 7.4 Slukning

Off virker fra næste dato (samme regel som tænding). Købte point bliver stående. Bjælken beholder sin andel. Motoren går tilbage til kurve B. Slukning for at stoppe er fint. At tænde igen er ejer-only.

### 7.5 Oprydning bagefter

Først når XP har kørt stabilt, og ejeren har sagt ja: kurve B's kode, #7382-sporet, de bløde lofter, kontakten selv og de gamle tekster fjernes (Til dørs krav 5). `ability_caps` kan ikke fjernes samtidig. Klassifikationen og værdisporet læser dem. Det er sit eget skridt.

## 8. 10-sæsoners-kørslen og gates

**Gate for tænding.** Grundlagets tal er en øvre grænse (hård træning hver dag, ingen løb, ingen træner, små prøver) og er ikke S25-kørslen.

Kørslen er `backend/scripts/dev/tenSeasonSim6110.mjs` (read-only, kopi af prod, assistenten styrer alle hold, S25). Den skal udvides med en XP-variant på den rigtige pakke: prisliste, XP, alder, type, løbsdage, sæsonskifte og +1 pr. dato. Den køres med begge svar på Å1, og for "kun fokus" med en roterende plan. Resultatet er ét privat kort.

| Gate | Krav |
|---|---|
| X1 Milepæle | D1-milepælene og top 27-28 (D-058) |
| X2 Niveau | Lavt potentiale når reelt ikke toppen, topper ender over middeltalenter |
| X3 Veteraner | Etablerede ryttere over ca. 29 år stiger ikke bredt |
| X4 Type | En ren sprinter bliver ikke topklatrer på en hel karriere. En bjergrytter kan blive bakkerytter |
| X5 Aldrig nul | En hel træningsdag giver altid synligt XP (#7757) |
| X6 Tændingen | 0 ratingfald, +1 pr. dato holder, ingen unormal første uge |
| X7 Mentale evner | Ingen mental evne løber fra de fysiske. Taktik vurderes særskilt |
| X8 Løb | G1, G2, G6 og G8 fra del 2 holder i XP |
| X9 Talentet | H6b holder på XP-historikken, også mod en spiller, der kender koden (§5.2) |
| X10 Fokus | Hver evne kan udvikles, og assistenten er ikke fanget på én session |

Foreløbige resultater står kun i `balance-internals/6110/`.

H1-H6 genkøres mod det nye sande tal (§6). Fejler en gate, ændres tallene, ikke beslutningerne. To kørsler med samme fejl er et ejer-kort. Ejeren vælger, om en gate må vige.

## 9. #6110-planen: hvad der falder væk

Trinnene er fra §11, §13.1 og §13.2 i designet 23/10. "Falder væk" med stjerne rører et låst valg og kræver ejerens ja.

| Trin | Indhold | Med XP | Hvorfor |
|---|---|---|---|
| 1 | Harness for skøn | Ændres | Genkøres mod nyt sandt tal |
| 2 | Migration: grundtalent, gemte skøn | Delvist væk | Tabellen til gemte skøn står. Grundtalent og loft-kolonnen bruges ikke, hvis Å3 er nej |
| 3 | `potentialEstimate` | Står | Målet skifter, mekanikken står |
| 4 | Én prognose-kilde | Ændres | Prognosen regnes med prisliste og XP |
| 5 | Søndagsjob og skrivning | Står | |
| 6 | Tal og ord på alle flader | Står | Loft-linjer udgår |
| 7 | Udviklingsscore B | **Falder væk\*** som motorkobling | XP er udviklingen (Å2) |
| 8 | +1 pr. dato | Står | Live |
| 9 | #7084 kvittering | Står | |
| 10 | Train now hele dagen | Står | Live |
| 11 | #2798 værdien | Ændres | Historikken bliver XP i stedet for score |
| 12 | Omregning til 1-99 | **Falder væk\*** | XP læser dagens potentiale (Å3) |
| 13 | Tænd-kort | Ændres | Nye krav i §7.2 og §8 |
| 14 | Bløde lofter pr. evne | **Falder væk** | Intet loft (B4). Typen flytter til XP |
| 15 | Fart pr. klasse, fremdrift uden mur | Delvist væk | Muren er væk. Klassens fart bliver typens andel |
| 16 | Katalog v3 | Står | Live, "dagens træninger" |
| 17 | Løbsdagen | Ændres | Reglerne står, udtrykkes i XP |
| 18 | Søndagsbesked om skøn | Står | Årsagen "loftet flyttede sig" udgår |
| 19 | Træningsdisciplin | Ændres | Loft-delen af S11 er væk, udbytte-delen står |
| 20 | Tæller for 5 datoer | Står | |
| 21 | Holdarbejde i motoren | Står | Egen plan |
| 22 | GDD og SSOT | Ændres | Omskrives til XP, når modellen er låst |
| 23 | 10-sæsoners-simulering | Skærpes | Gate for tænding (§8) |
| 24 | Træningssiden og udviklingsplanen | Står | XP skal have plads. Rotation skal kunne planlægges, hvis Å1 ender dér |
| 25 | Fart-ord pr. evne (S23) | **Falder væk\*** | XP og pris viser det samme, mere præcist |

Uden for de nummererede trin falder også D5's glidende overgang, K3b's personlige loft, K1's særlinje og #7757-forklaringen i PR #7769 væk.

## 10. Afløste beslutninger

| Beslutning | Nu |
|---|---|
| D1b, S2: blødt loft fra potentialet | Afløst af B1, B2, B4 |
| S4: sekundæren har de næsthøjeste lofter | Lofter væk. Sekundæren lever videre som XP-andel |
| S5: kun signaturen når verdenstoppen | Ikke længere en fast regel (B6). Stejl pris og typens andel er bremsen |
| S6: svaghed langsomst | Står, som XP-andel |
| S7: ingen regel mod hyperspecialisering | Står. Kun fokus gør det dyrere at bygge bredt, så gabet måles igen |
| S8: dyrere top, fremdrift gemt, ingen mur | Står, nu pr. konstruktion |
| S11: disciplin løfter det reelle loft | Loft-delen afløst |
| S22: scoren er udviklingen | Står, XP er tallet (Å2) |
| S23: fem fart-ord | Foreslået afløst af XP |
| D5, K3b, K1: ryttere over loftet | Gruppen findes ikke |
| K3: kalibrering af loftet | Bortfalder, §6 |
| Retning C: det reelle loft flytter sig | Foreslået afløst: loftet er væk, og potentialet står fast (Å3) |
| D4: "ingen fremgang" på plateauet | Afløst af lavt XP. Faldet efter D4 står |
| #5268: mentalt tag-loft | Afløst i XP-stien (B9) |
| #2472: aftrapning af loftet | Får ny form som XP-fald |
| D-058: top 27-28 og milepælene | **Står,** nu som gate X1 |

GDD, `PROGRESSION_RULES` §0, §1, §3, §4, §11 og `TRAINING_RULES` §2.1b rettes i trin 22, når modellen er låst. Ikke før, for reglerne er sande, indtil kontakten er tændt.

## 11. Byggeplan (små PR'er, alt bag den slukkede kontakt)

Bygges først efter ejerens godkendelse af denne spec. Trin 1-3 afhænger ikke af Å1.

| # | PR | Afhænger af |
|---|---|---|
| 1 | Rent modul `developmentXp.ts`: pris, XP pr. dag, køb af point, params-validering, tests, ingen kaldere | - |
| 2 | Kontakt, params, startdato, grenen i `dailyAbilityDelta` og `applyDailyTick`, frossen golden for off | 1 |
| 3 | XP-variant i `tenSeasonSim6110.mjs`, begge svar på Å1, privat kort | 1 |
| 4 | XP i tick-rapporten, API-felter for egen manager, H4-test | 2 |
| 5 | Visning, tekster, Hjælp en+da, gated på kontakten, preview til ejeren | 4 |
| 6 | Prognose og skøn på nyt sandt tal (trin 3-5) | 2 |
| 7 | Assistentens plan, hvis Å1 ender på kun fokus | Å1 |
| 8 | Tænd-kort: gates, billeder, startdato, ejerens "kør" | Alle |

Verifikation: TIER FULL for 2, 4, 5 og 6. Migrationer er additive og efter #2642. Patch note og Hjælp følger tændingen, ikke merge.

## 12. Kendte risici

1. **Talentet aflæses for hurtigt (§5.2).** Det kan vise sig, at variationen, der skal til, føles tilfældig. Så skal ejeren vælge mellem præcist XP og sent talent.
2. **Toppens timing** skal afgøres med rigtige planer og løb, ikke med en model med daglig hård træning.
3. **Verdensklassen kan flytte sig** for nye generationer. Det ændrer, hvad spillerne ser som toppen, og skal vises for ejeren.
4. **Toppen føles stille.** En evne højt på listen koster mange sæsoner pr. point. XP-tallet forklarer det, men fremgangen er ikke mærkbar.
5. **Kun fokus gør manageren til planlægger.** Det er pointen, men det kræver, at assistent og træningsside kan bære rotation. Derfor spørges spillerne først.
6. **`ability_caps` lever videre** som input til klassifikation og værdi, efter at de er holdt op med at betyde noget for træningen. Det skal stå tydeligt i koden, så ingen læser dem som lofter.
