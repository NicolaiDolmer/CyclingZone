# Udvikling med XP: fælles prisliste, potentiale giver XP

**Status:** design 6/11 2026, ejervalg 7/11, byg-go 12/11. Trin 1-3 er merget (#7819, #7843, #7887), og motorens rest (dagsvariation og løbsdags-gulv) er bygget bag den slukkede kontakt (§11). Ingen kontakt er tændt, og intet i spillet er ændret. Alle syv spørgsmål er besvaret (§2).
**Epic:** [#6110](https://github.com/NicolaiDolmer/CyclingZone/issues/6110), ejerens kommentarer 6/11.
**Bygger på:** [samlet design 23/10](2026-10-23-6110-potentiale-et-tal-samlet-design.md) · [del 2 catch-up](2026-10-23-6110-del2-catchup-design.md) · [spec 3/10](2026-10-03-udvikling-2-design.md) · [katalog v3](2026-10-29-training-catalog-v3-design.md). Hvor de er i modstrid med denne spec, gælder §10.
**Tal:** privat i `balance-internals/6110/xp-model-grundlag-2026-11-06.md` (hard rule 17). Dette dokument er kvalitativt. Det private grundlags afsnit 7 er modellens startpunkt. Kørslens tal ligger i samme mappe.

## 0. Kort fortalt

1. Alle ryttere bruger **én fælles prisliste**. Næste point i en evne koster XP efter evnens værdi, og intet andet.
2. **Potentialet afgør, hvor meget XP rytteren tjener om dagen.** Forskellen mellem ryttere ligger i XP, ikke i prisen.
3. Der er **intet hårdt loft pr. evne**. Stejl pris i toppen og lavt XP ved lavt potentiale gør, at svage ryttere reelt ikke når toppen.
4. **XP falder tydeligt fra ca. 29 år.** Før det tjener samme rytter ca. det samme som 19-årig og 28-årig. Han stiger langsommere, fordi evnerne bliver dyrere.
5. En træning giver **mest XP i sessionens fokus og lidt i resten**. Manageren vælger, hvad rytteren skal blive god til, og en ensidig plan efterlader ikke resten på nul.
6. **Evner uden for rytterens type giver lidt mindre XP.** Alt kan trænes, men en ren sprinter bliver ikke topklatrer.
7. **Ét tal: XP,** vist for i dag og de sidste 30 dage. Træningerne varierer fra dag til dag, så potentialet først kan estimeres over tid.
8. **Mentale evner følger samme prisliste**, uden særskilt loft, og vokser længere end de fysiske.
9. **Potentialet er fast.** Det ændrer sig ikke gennem karrieren og styrer XP pr. dag. Rytterens type er anlæg og følger ikke med, når han trænes om.
10. Alt ligger bag **én slukket kontakt**. Den tændes kun mellem to datoer, tidligst efter 14/11, og kun efter en 10-sæsoners-kørsel.

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
| B10 | Vi bruger dagens træninger. En træning giver mest i fokus og lidt i resten (Å1 = C, forum 9-4-1) | Spørgsmålet om kun fokus |
| B11 | Ét tal: XP, vist for i dag og de sidste 30 dage (Å2) | Udviklingsscoren som eget tal, navneskiftet 20/10 |
| B12 | Potentialet er fast: ét tal pr. rytter, som styrer XP pr. dag og ikke flytter sig. Omregningen 1-6 til 1-99 bygges stadig (Å3, ejerens rettelse 6/11) | Retning C's levende talent |
| B13 | Typen er anlæg og følger ikke med ved omskoling (Å6) | |
| B14 | Mentale evner vokser længere end fysiske, målt i kørslen (Å7) | Samme fald for alle evner |
| B15 | XP-træning først. Potentialet går ud af værdien, og træningshastigheden (XP over tid) går ind, hvilket også løser #2798. Omregningen kommer, når potentialet er ude af prisen. Hvordan de tre tændes sammen, afgøres med ejeren efter kørslen | Rækkefølgen i designet 23/10 |
| B16 | Træn nu giver en bonus frem for automatisk træning. Størrelsen måles ved 10, 15 og 25 %, og ejeren vælger bagefter (#7801) | Beslutning 2 fra 6/9: ingen bonus |

Det åbner #2472's form og K3b og erstatter #7757-forklaringen. PR #7769 holdes tilbage.

## 2. Spørgsmålene

Ejeren svarede 6/11 på Å1, Å2, Å3, Å6 og Å7 og 7/11 på Å4 og Å5 (efter spilleranalysen, seks træningsvalg). Svarene står i issuet, og resten af denne spec er rettet til dem.

| # | Spørgsmål | Status | Svar eller næste skridt |
|---|---|---|---|
| Å1 | Giver en session kun XP i sine egne evner? | **Afgjort: C** | Mest i fokus og lidt i resten (forum 9-4-1). Andelen er ét privat tal, off-fokus i XP-params (§4.6) |
| Å2 | Bliver XP-tallet og Udviklingsscoren ét tal? | **Afgjort: ét tal** | XP, vist for i dag og de sidste 30 dage. Scorens 1-99-skala og navneskiftet udgår (§5.3) |
| Å3 | Står potentialet fast, og skal omregningen og det levende talent bygges? | **Afgjort** | Potentialet er fast og styrer XP pr. dag. Det levende talent udgår. Omregningen 1-6 til 1-99 bygges stadig, efter at potentialet er ude af prisen (§6) |
| Å4 | Hvor meget er "lidt mindre" for evner uden for typen? | **Afgjort 7/11: Midt B** | Typen tæller mest af mellemvejene, men er ikke længere en skjult bremse. Andelene er private i XP-params; vises tydeligt på rytterprofilen (§4.7) |
| Å5 | Dagsvariationens form: kun dag for dag, eller med gode og dårlige perioder? | **Afgjort 7/11: bred, med hukommelse** | XP må være synligt, men skal variere meget fra dag til dag med gode og dårlige perioder. Bredde og hukommelse sættes, så H6b holder, og måles i næste kørsel (§5.2, gate X9) |
| Å6 | Skal rytterens type følge med, når han er trænet om? | **Afgjort: nej** | Typen er anlæg. Bedste rolle følger evnerne som i dag (§4.7) |
| Å7 | Falder XP også for mentale evner efter ca. 29 år? | **Afgjort** | Mentale evner vokser længere end fysiske. Hvor længe måles i kørslen (§4.5, gate X7) |

**Ejervalg 7/11 (træning 1-6 af 6), ud over Å4 og Å5:**

| # | Valg | Hvor |
|---|---|---|
| E1 | Tempo: grundtabellen er XP kalibreret mod kurve B; næste kørsel følger kun nye ryttere fra 16 til 40 år plus en særskilt måling af, at spillet ikke løber løbsk | §8, privat kort |
| E2 | Løbsdag: en løbsdag giver altid mindst det samme som en hård træningsdag med rytterens træner og facilitet, og mere i det, etapen kræver. Gate X8 skal være grøn før tænding | §4.9 |
| E3 | Træn nu-bonus: valgt blandt de tre målte niveauer, tændes sammen med XP (#7737) | §4.2 |
| E4 | Intet loft på +1 point pr. evne pr. dato under XP. Kun prisen bremser. Kræver ny måling (X6, X1, inflation) før tænding | §4.3, #7739 |

**Byg-go 12/11:** #6110 bygges færdigt hurtigst muligt bag den slukkede kontakt. 14/11 er kun gulvet for selve tændingen (første XP-dato tidligst 15/11), ikke for byggeriet. Løbsdags-kravet E2 er nok; en sammenligning med den gamle model er ikke et krav. Ordet er Potentiale overalt.

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

Pris for næste point er en ren funktion af evnens værdi. Den er ens for alle ryttere, alle typer, alle aldre og alle evner, også de mentale. Prisen stiger stejlt mod toppen af skalaen, men er endelig helt op til 99. Der er ingen mur, og en evne på 99 køber ikke flere point. Tallene er private. Det valgte niveau er et kompromis mellem top og bund, ikke et optimum.

### 4.2 XP pr. dag

XP på en evne er et produkt af led. Enheden er én hård dato. Motorens tick får sin andel gennem den eksisterende deler (#6711), så sæsonens længde ikke flytter udbyttet.

| Led | Indhold | Kilde |
|---|---|---|
| Potentiale | XP pr. dag fra en privat tabel over potentialet, lineært mellem punkterne. Spændet er større end dagens fartspænd, fordi det skal erstatte det bløde loft. Tabellens punkter kan flyttes til skalaen 1-99 uden ny kode | B2, B12 |
| Alder | Fuldt til og med 28, derefter tydeligt faldende. Mentale evner har deres egen, længere kurve | B5, B14, §4.5 |
| Session | Intensitet og evnens vægt i sessionen, uændret fra katalog v3 og `abilityMult`. Evner uden for sessionen får off-fokus-andelen, som følger intensiteten | S12, B10, §4.6 |
| Type | Andel efter rolleklasse, Midt B (Å4) | B7, §4.7 |
| Færdighedsdag | Uændret: en færdighedsdag træner højst til håndværks-raten (#3762) | 14/8 |
| Træner og facilitet | På træningsdage. På løbsdage kun gennem løbsdags-gulvet | S13, E2 |
| Træn nu | Bonus på træningsdage, når manageren selv trykker. Størrelsen er valgt 7/11 (#7737) | B16, E3 |
| Træningsdisciplin | Løfter dagens udbytte, hvis trin 19 bygges (§9) | S11 |
| Dagsvariation | Deterministisk pr. (rytter, dato) med en hemmelig nøgle på serveren, bred og med hukommelse (gode og dårlige perioder), neutral over en sæson. Gælder hele dagen, også løbsdage. Bredde, hukommelse og nøgle ligger i XP-params; uden dem er der ingen variation | B8, Å5, §5.2 |
| Intention på løbsdage | Uændret multiplikator (#6641), men aldrig under løbsdags-gulvet | live, E2 |
| Løbsdags-gulv | På en løbsdag er XP i hver evne mindst en hård træningsdag i løbsdagens evner med rytterens træner og facilitet. Rolletillægget lægges oven i | E2, §4.9 |

I koden: `developmentXp.ts` (`developmentXpAbilityDelta` med gulvet) og `developmentXpVariation.ts` (variationen). `applyDailyTick` ganger variationen og Træn nu-bonussen på hele dagen.

Form og træthed er ikke led i XP (S29). Træthed koster gennem form og skadesrisiko. Belastningsevnen (D1) er neutral i de gældende params og føres ikke med over. Viser kørslen, at de helt unge går for hurtigt, er det et nyt ejer-kort.

### 4.3 Bjælken

- Bjælken gemmes **fortsat som en andel** i `ability_progress`. Vist XP = andel gange prisen for næste point.
- Når et point købes, regnes overskuddet om til den nye pris, så ingen XP går tabt eller opstår. Dagens `bar -= 1` kan ikke genbruges, fordi prisen skifter mellem to point.
- **Intet +1-loft pr. evne pr. dato under XP** (ejer 7/11, #7739): kun prisen bremser. `ability_cap_per_date_enabled` gælder fortsat kurve B og dagens model. Løbsdagens eget loft pr. tick står. Undtagelse: overgangsvinduet i §7.3.
- Fremdrift gemmes altid (S8). Falder en evne ved sæsonskiftet, står andelen uændret.
- XP-tallet skrives i tick-rapporten (`training_rider_ticks.report`), som også kan bære løbsdage. Ny tabel er ikke nødvendig.

### 4.4 Potentiale

Potentialet styrer kun XP pr. dag. Prisen afslører det ikke. Det står fast gennem hele karrieren (B12). Modellen regner i dag på trinene 1-6 i halve trin, og omregningen til 1-99 flytter kun tabellens punkter.

### 4.5 Alder

- Fuld XP til og med 28 år. Ingen ungdomsfaktor, ingen alderstabel.
- XP falder tydeligt fra ca. 29 år. Kurven og vurderingen af den er private (`balance-internals/6110/`).
- Mentale evner vokser længere: deres XP falder senere og langsommere end de fysiskes, og aldrig før dem (B14). Modulet afviser params, hvor det ikke holder. Kurven sættes efter gate X7.
- En variant, hvor XP er uændret og kun sæsonfaldet bremser, udgår med B5.
- Tilbagegangen ved sæsonskiftet (D4) er uændret: intet fald til og med 30, fald fra 31, kun fysiske evner, løbsbremse. Kun D4's "ingen fremgang" på plateauet afløses af det lave XP.

### 4.6 Fokus

Afgjort 6/11 (Å1 = C): en træning giver mest XP i sessionens egne evner og lidt i resten. Resten er ét privat tal, off-fokus-andelen i XP-params.

- Andelen er over nul og under fokus. Den følger intensiteten, så forholdet mellem fokus og resten er det samme på alle dage.
- En restitutionsdag giver stadig kun XP i sessionens egen evne (#3762).
- Manageren kan stå på én session, men bygger kun en hel rytter ved at skifte. Assistentens standardplan (`resolveProgram`) kan blive stående.
- Holdarbejde og Lederskab er i ingen session. De udvikler sig mest gennem løb efter rolle (S21) og lidt gennem off-fokus.
- Kørslen måler standardplanen og en roterende plan, så forskellen kan ses.
- Løbsdage har deres egen andel. Et løb er bredere end en træning (D2: løb slår træning, men er mindre målrettet), og de beholder deres nuværende fordeling.

### 4.7 Rytterens type

- Rolleklassen flytter fra at være et loft til at være **en andel af XP**: evnens XP = sessionens vægt gange klassens andel.
- Andelen er det, der holder typerne adskilt.
- Hvor stort springet mellem signatur og sekundær skal være, er Å4. Bemærk spændingen: ejeren siger "lidt mindre", og dagens rater ligger langt fra hinanden. Gate X4 afgør, hvor lidt det kan være.
- Typen er anlæg og følger ikke med ved omskoling (Å6). En bjergrytter, der trænes til bakkerytter, beholder sin XP-andel, men hans evner og bedste rolle flytter sig.
- Spillerinput 5/11 står åbent ved siden af: en rytter med højere prognose uden for sin type bliver straffet, og ejeren har sagt, at det skal fikses. Å6 afgør, at typen ikke følger med. Hvordan straffen så fjernes, skal ses sammen med Å4.

### 4.8 Mentale evner

Samme prisliste, uden `MENTAL_ABILITY_TAG_CEILING` i XP-stien. De vokser længere end de fysiske (§4.5) og falder fortsat aldrig ved sæsonskiftet (D4). Holdarbejde og Lederskab udvikles efter rolle i løb (S21). Risikoen er, at evner uden fald løber fra de fysiske på lang sigt, derfor gate X7. Holdarbejde og Lederskab er stadig uden for rating-opskriften.

### 4.9 Løbsdage

Reglerne står, oversat til XP: en løbsdag er en hård dag plus et tillæg i etapens evner, vægtet efter rolle (D-059, D3). Træner og facilitet tæller ikke i selve løbsdagen (S13), men **gulvet** gør (ejervalg E2, 7/11, bekræftet 12/11): i hver evne giver en løbsdag mindst det, en hård træningsdag i løbsdagens evner med rytterens træner og facilitet ville give, også når dagens intention er lav. Gulvet løfter kun selve dagen; rolletillægget lægges oven i, så "mere i det, etapen kræver" er det samme for alle roller. Gulvet regnes i tick'ets enhed, så en dato med flere løbsdage deler det som resten af XP'en (#6711). Udgået rytter får basis (S16), fri rolle er halvt af hver (S17). Løb skal fortsat slå træning i etapens evner (D2, G1). Fordi potentialet giver XP, afhænger løbsdagens udbytte af potentialet. Det skal ses sammen med catch-up, når #6950 besluttes.

### 4.10 Uændret

AI-ryttere og frie ryttere udvikler sig ikke (D6). Ét løb eller træning pr. løbsdag. Synlige ratings falder aldrig uden ejerens vidende. Pension. Rating-opskrifterne. Træn nu afregner samme kæde.

## 5. Visning

### 5.1 XP-tallet

- XP vises for **i dag og de sidste 30 dage** (Å2).
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
- Variation dag for dag midles hurtigt væk. Variation med hukommelse (gode og dårlige perioder) skjuler talentet længere ved samme daglige udsving. **Afgjort 7/11 (Å5): bred variation med hukommelse.** Målingen 7/11 viste, at kun den skjuler talentet nogenlunde; bredde og hukommelse sættes, så H6b holder.
- Bygget i `developmentXpVariation.ts`: hvert træk er en HMAC med nøglen, og tilstanden for en dato regnes fra de foregående datoers træk, så intet skal gemmes, og en dato kan regnes om alene. Formen er den samme som kørslens. Nøglen ligger ikke på params-objektet, så params kan logges eller hashes uden at afsløre den.
- Reglen fra 5/11 er, at alt har en ægte årsag. Ren dagslotteri kolliderer med den, og S10 forbyder en faktorforklaring. Kortet til ejeren skal tage stilling til det.

### 5.3 Udviklingsscoren

Afgjort 6/11: ét tal. S22 siger, at scoren er udviklingen, og det opfyldes af XP-tallet selv. Score B's kobling i motoren er overflødig, og dens talent-led passer ikke til det nye spænd. Scorens 1-99-skala og navneskiftet 20/10 udgår. `development_score_v2` forbliver off.

## 6. Skønnet: hvad potentiale-tallet nu viser

Det samlede design 23/10 skønner over "det sande loft". Uden loft findes den størrelse ikke. Tallet er stadig ét skøn med et sikkerhedsord, i ratingens skala, på alle flader (låst 23/10). Det sande tal bliver i stedet **rytterens forventede topniveau**: det niveau, prislisten og hans XP pr. dag fører ham til med en standardkarriere fra hans nuværende evner i hans naturlige rolle.

- Det regnes ét sted, så skøn, prognose og akademi fortsat er én kilde (trin 4).
- Det opdateres ved søndagskørslen (§3.3 i designet 23/10).
- Den bevidste undtagelse fra doktrinen #5490 står: skønnet er visning, motoren regner på det sande potentiale.
- Retning C's bevægelige loft er afløst: loftet er væk, og potentialet står fast (B12). K1's særlinje om ryttere over loftet har intet at beskrive.
- Skønnet vises aldrig under nuværende rating, som hidtil.
- Omregningen 1-6 til 1-99 bygges stadig: ét fast tal pr. rytter. Den kommer, når potentialet er ude af prisen (B15). Motoren og XP-tabellen afhænger ikke af den, for tabellens punkter kan flyttes til den nye skala.
- Potentialet går ud af værdien, og træningshastigheden (XP over tid) går ind. Det løser også #2798 (B15).

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

**Krav før tænding:** Å4 og Å5 afgjort, §8 grøn, frossen golden grøn, ejerens valg af Træn nu-bonus og af, hvordan XP, værdien og omregningen tændes sammen (B15, B16), privat tænd-kort, ejerens ordrette "kør" på netop det skridt, efter at ejeren har set den live tilstand. Hjælp en+da, patch note og Discord-udkast er klar samme dag.

### 7.3 Eksisterende ryttere og data

- **Ingen evne ændres, og ingen rating falder ved tænding.** Der køres ingen massemutation og ingen omregning.
- Bjælken bevarer sin andel. Ingen data skal migreres.
- Evner, der står fast ved det gamle hårde tag eller i klippet lige under et point, begynder at købe point igen. Baren over 1 betales som standard ud straks, til prisen. Overgangsvinduet (#7739): `development_xp_transition_cap_dates` i app_config giver højst +1 pr. evne pr. dato i de første datoer fra startdatoen; mangler nøglen, er der intet loft. Det kræver, at `ability_cap_per_date_enabled` er on. Ejeren vælger værdien før tænding. Gate X6 måler den første uge, så det ikke bliver et spring, spillerne oplever som en fejl.
- **Ingen ny glidende overgang og intet nyt øjebliksbillede.** #7382 og D5 fandtes, fordi evner over et loft ellers ville bremse brat. Uden loft findes gruppen ikke. Tabellen fra #7382 røres ikke.
- Ryttere med lavt potentiale og lave evner får lidt mindre pr. dag, og ryttere over det gamle bløde loft får mere. Kørslen viser hvor meget. Er ændringen synlig for en gruppe, får ejeren et kort før tænding.

### 7.4 Slukning

Off virker fra næste dato (samme regel som tænding). Købte point bliver stående. Bjælken beholder sin andel. Motoren går tilbage til kurve B. Slukning for at stoppe er fint. At tænde igen er ejer-only.

### 7.5 Oprydning bagefter

Først når XP har kørt stabilt, og ejeren har sagt ja: kurve B's kode, #7382-sporet, de bløde lofter, kontakten selv og de gamle tekster fjernes (Til dørs krav 5). `ability_caps` kan ikke fjernes samtidig. Klassifikationen og værdisporet læser dem. Det er sit eget skridt.

## 8. 10-sæsoners-kørslen og gates

**Gate for tænding.** Grundlagets tal er en øvre grænse (hård træning hver dag, ingen løb, ingen træner, små prøver) og er ikke S25-kørslen.

Kørslen er `backend/scripts/dev/tenSeasonSim6110.mjs` (read-only, kopi af prod, assistenten styrer alle hold, S25). Den har en XP-variant på den rigtige pakke: prisliste, XP, alder, type, løbsdage, sæsonskifte og +1 pr. dato. Den køres med standardplanen og en roterende plan. Træn nu måles ved 10, 15 og 25 % med halvdelen af managerholdene som dem, der trykker (#7801). Resultatet er ét privat kort.

| Gate | Krav |
|---|---|
| X1 Milepæle | D1-milepælene og top 27-28 (D-058) |
| X2 Niveau | Lavt potentiale når reelt ikke toppen, topper ender over middeltalenter |
| X3 Veteraner | Etablerede ryttere over ca. 29 år stiger ikke bredt |
| X4 Type | En ren sprinter bliver ikke topklatrer på en hel karriere. En bjergrytter kan blive bakkerytter |
| X5 Aldrig nul | En hel træningsdag giver altid synligt XP (#7757) |
| X6 Tændingen | 0 ratingfald, ingen unormal første uge (med eller uden overgangsvinduet, #7739) |
| X7 Mentale evner | Mentale evner vokser længere end de fysiske, men ingen mental evne løber fra dem. Taktik vurderes særskilt |
| X8 Løb | G1, G2, G6 og G8 fra del 2 holder i XP |
| X9 Talentet | H6b holder på XP-historikken, også mod en spiller, der kender koden (§5.2) |
| X10 Fokus | Hver evne kan udvikles, også med assistentens standardplan |

Foreløbige resultater står kun i `balance-internals/6110/`.

H1, H2, H3 og H6 genkøres mod det nye sande tal (§6). H4 og H5 handler om fladerne og måles, når de er bygget. Fejler en gate, ændres tallene, ikke beslutningerne. To kørsler med samme fejl er et ejer-kort. Ejeren vælger, om en gate må vige.

## 9. #6110-planen: hvad der falder væk

Trinnene er fra §11, §13.1 og §13.2 i designet 23/10. "Falder væk" med stjerne rører et låst valg og kræver stadig ejerens ja.

| Trin | Indhold | Med XP | Hvorfor |
|---|---|---|---|
| 1 | Harness for skøn | Ændres | Genkøres mod nyt sandt tal |
| 2 | Migration: grundtalent, gemte skøn | Ændres | Tabellen til gemte skøn står. Det faste tal 1-99 får plads med trin 12. Der er ikke noget levende talent at gemme (B12) |
| 3 | `potentialEstimate` | Står | Målet skifter, mekanikken står |
| 4 | Én prognose-kilde | Ændres | Prognosen regnes med prisliste og XP |
| 5 | Søndagsjob og skrivning | Står | |
| 6 | Tal og ord på alle flader | Står | Loft-linjer udgår |
| 7 | Udviklingsscore B | **Falder væk** som motorkobling | XP er udviklingen, ét tal (B11) |
| 8 | +1 pr. dato | Står for kurve B | Live. Gælder ikke under XP (#7739) |
| 9 | #7084 kvittering | Står | |
| 10 | Train now hele dagen | Står | Live |
| 11 | #2798 værdien | Ændres, først | Potentialet går ud af værdien, træningshastigheden (XP over tid) går ind (B15) |
| 12 | Omregning til 1-99 | Står, senere | Ét fast tal pr. rytter, når potentialet er ude af prisen (B12, B15). XP afhænger ikke af den |
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
| 24 | Træningssiden og udviklingsplanen | Står | XP skal have plads, for i dag og de sidste 30 dage |
| 25 | Fart-ord pr. evne (S23) | **Falder væk\*** | XP og pris viser det samme, mere præcist |

Uden for de nummererede trin falder også D5's glidende overgang, K3b's personlige loft, K1's særlinje og #7757-forklaringen i PR #7769 væk.

## 10. Afløste beslutninger

| Beslutning | Nu |
|---|---|
| D1b, S2: blødt loft fra potentialet | Afløst af B1, B2, B4 |
| S4: sekundæren har de næsthøjeste lofter | Lofter væk. Sekundæren lever videre som XP-andel |
| S5: kun signaturen når verdenstoppen | Ikke længere en fast regel (B6). Stejl pris og typens andel er bremsen |
| S6: svaghed langsomst | Står, som XP-andel |
| S7: ingen regel mod hyperspecialisering | Står. En lille off-fokus-andel gør det dyrere at bygge bredt, så gabet måles igen |
| S8: dyrere top, fremdrift gemt, ingen mur | Står, nu pr. konstruktion |
| S11: disciplin løfter det reelle loft | Loft-delen afløst |
| S22: scoren er udviklingen | Står, XP er tallet (B11) |
| S23: fem fart-ord | Foreslået afløst af XP |
| D5, K3b, K1: ryttere over loftet | Gruppen findes ikke |
| K3: kalibrering af loftet | Bortfalder, §6 |
| Retning C: det reelle loft flytter sig | Afløst 6/11: loftet er væk, og potentialet står fast (B12). Noten fra 11/10 er dermed afløst |
| D4: "ingen fremgang" på plateauet | Afløst af lavt XP. Faldet efter D4 står |
| #5268: mentalt tag-loft | Afløst i XP-stien (B9) |
| #2472: aftrapning af loftet | Får ny form som XP-fald |
| D-058: top 27-28 og milepælene | **Står,** nu som gate X1 |

GDD, `PROGRESSION_RULES` §0, §1, §3, §4, §11 og `TRAINING_RULES` §2.1b rettes i trin 22, når modellen er låst. Ikke før, for reglerne er sande, indtil kontakten er tændt.

## 11. Byggeplan (små PR'er, alt bag den slukkede kontakt)

Trin 1-3 er merget (#7819, #7843, #7887). Byg-go 12/11: resten bygges hurtigst muligt bag den slukkede kontakt; tændingen kræver stadig §7.2.

| # | PR | Afhænger af |
|---|---|---|
| 1 | Rent modul `developmentXp.ts`: pris, XP pr. dag, køb af point, params-validering, tests, ingen kaldere. **Merget** | - |
| 2 | Kontakt, params, startdato, grenen i `dailyAbilityDelta` og `applyDailyTick`, frossen golden for off. **Merget** | 1 |
| 2b | Motorens rest efter ejervalgene 7/11: dagsvariation med hemmelig nøgle og hukommelse (`developmentXpVariation.ts`, felter i XP-params) og løbsdags-gulvet (E2). **Bygget** | 2 |
| 2c | Intet dagsloft under XP (E4, #7739) | 2 |
| 3 | XP-variant i `tenSeasonSim6110.mjs`, gates X og H, Træn nu ved 10, 15 og 25 %, privat kort. **Merget** | 1 |
| 4 | XP i tick-rapporten, API-felter for egen manager, H4-test | 2 |
| 5 | Visning, tekster, Hjælp en+da, gated på kontakten, preview til ejeren | 4 |
| 6 | Prognose og skøn på nyt sandt tal (trin 3-5) | 2 |
| 7 | Potentialet ud af værdien, træningshastigheden ind (#2798) | 4 |
| 8 | Omregningen 1-6 til 1-99 | 7 |
| 9 | Tænd-kort: gates, billeder, startdato, ejerens "kør". Hvordan XP, værdien og omregningen tændes sammen, afgøres her | Alle |

Assistentens plan kræver intet trin med C. Viser gate X10 andet, er det et ejer-kort.

Verifikation: TIER FULL for 2, 4, 5, 6 og 7. Migrationer er additive og efter #2642. Patch note og Hjælp følger tændingen, ikke merge.

## 12. Kendte risici

1. **Talentet aflæses for hurtigt (§5.2).** Det kan vise sig, at variationen, der skal til, føles tilfældig. Så skal ejeren vælge mellem præcist XP og sent talent.
2. **Toppens timing** skal afgøres med rigtige planer og løb, ikke med en model med daglig hård træning.
3. **Verdensklassen kan flytte sig** for nye generationer. Det ændrer, hvad spillerne ser som toppen, og skal vises for ejeren.
4. **Toppen føles stille.** En evne højt på listen koster mange sæsoner pr. point. XP-tallet forklarer det, men fremgangen er ikke mærkbar.
5. **Off-fokus-andelen kan blive for stor eller for lille.** For stor gør valget af session ligegyldigt. For lille efterlader evner, ingen session træner, og gør ensidige planer dyre. Gate X10 og S7's gab måler det.
6. **`ability_caps` lever videre** som input til klassifikation og værdi, efter at de er holdt op med at betyde noget for træningen. Det skal stå tydeligt i koden, så ingen læser dem som lofter.
