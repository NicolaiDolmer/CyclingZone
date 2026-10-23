# Udvikling 2.0 samlet: potentiale som ét skønnet tal, Udviklingsscore og de bundtede rettelser

**Status:** design 23/10 2026 (DolmerPC-designsessionen), IKKE bygget. Ingen kode før ejer-go på hele designet (AGENTS 36).
**Epic:** [#6110](https://github.com/NicolaiDolmer/CyclingZone/issues/6110) · **Dele:** [#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564) progressionskæden · [#5490](https://github.com/NicolaiDolmer/CyclingZone/issues/5490) doktrin · [#6666](https://github.com/NicolaiDolmer/CyclingZone/issues/6666) akademi-prognose · [#6210](https://github.com/NicolaiDolmer/CyclingZone/issues/6210)/PR [#7075](https://github.com/NicolaiDolmer/CyclingZone/pull/7075) maks +1 pr. dato · [#7084](https://github.com/NicolaiDolmer/CyclingZone/issues/7084) holdskifte på reserve-stien · [#6461](https://github.com/NicolaiDolmer/CyclingZone/issues/6461)/PR [#7071](https://github.com/NicolaiDolmer/CyclingZone/pull/7071) Train now hele dagen · [#2798](https://github.com/NicolaiDolmer/CyclingZone/issues/2798) prisen må ikke afsløre potentialet
**Forgængere (gælder stadig):** [spec 3/10](2026-10-03-udvikling-2-design.md) (kurve, løb, tilbagegang) · [del 2 catch-up 23/10](2026-10-23-6110-del2-catchup-design.md) (løbsudvikling, kort 1-3) · [#6461-design](2026-10-23-6461-train-now-design.md) (PR #7071) · [Train nu 29/9](2026-09-29-traen-nu-og-prognose-design.md)
**Tal:** privat i `balance-internals/6110/` (hard rule 17). Dette dokument er kvalitativt.

## 0. Kort fortalt

1. **Potentiale vises som ét tal** i ratingens skala, overalt i spillet. Tallet er et **skøn**, ikke facit.
2. Ved siden af tallet står **ét ord for hvor sikkert skønnet er**: Usikker, Rimelig eller Sikker (ejer-valg A 23/10). Intet interval nogen steder.
3. Skønnet bliver mere præcist med **flere kig**, en **bedre scout** og, for egne ryttere, **flere træninger på holdet**. Selv et sikkert skøn kan ramme lidt ved siden af.
4. Skønnet er **stabilt pr. (rytter, hold)**: det hopper ikke ved visning, og det flytter sig kun ved ny viden eller ved søndagskørslen.
5. Alle flader læser **samme skøn fra én kilde**. De tre afvigende prognosemodeller i dag lægges sammen.
6. Træningsscoren bliver **Udviklingsscoren** (variant B fra 11/10) og mister den sidekanal, der i dag kan afsløre talentet.
7. #7075, #7084 og #6461 bygges i samme pakke og tændes samme søndag.

Alt bygges bag slukkede flag, i små PR'er, som PC1 kan merge løbende uden at noget tændes.

## 1. Låst (genåbnes ikke)

| Hvor | Beslutning | Dato |
|---|---|---|
| #6110 | Potentiale vises som ét tal, ikke et interval. Mere præcist jo mere scoutet og jo bedre scout. Kan ramme lidt ved siden af | ejer 23/10 |
| #6110 | Sikkerheden vises som ord ved siden af tallet (A) | ejer 23/10 |
| #6110 | Potentiale 1-6 omregnes til 1-99, rangbevarende, kun toptalent-overskuddet presses ned, fredningsgulve. Dry-run og ejer-go før apply | ejer 11/10 |
| #6110 D1b | Potentialet sætter et blødt loft (fart og højde) | ejer 11/10 |
| #6110 retning C | Levende talent: fast skjult grundtalent + skjult professionalisme; det reelle loft ligger i et bånd om grundtalentet og flytter sig med karrieren; låses gradvist omkring 25 | ejer 11/10 |
| #6110 træningsscore B | Én værdi pr. dag; ungdomsfaktoren væk; mere dagsstøj, så talentet først skiller sig ud efter nogle træninger; 7-dages snit ved siden af | ejer 11/10 |
| #6110 | Søndagens unge: intet potentiale og ingen prognose ved hentning; første skøn efter 5 træninger (samme grænse som salg), skarpere efter ca. 12, sikkert efter ca. 20 | ejer 11/10 |
| #6110 | "Træningsscore" omdøbes til "Udviklingsscore" samme søndag som løbsudviklingen tændes | ejer 20/10 |
| #6110 D7 | Del 2 tændes samlet en søndag i S5. Ingen datopres | ejer 11/10 |
| #6110 | #7075 og #6461 leveres sammen med Udvikling 2.0 | ejer 23/10 |
| #6461 | Train now = hele dagen for alle ryttere (variant B), designet sammen med #6984 | ejer 23/10 |
| #2798 | Potentialet ud af værdien på sigt; gradvis overgang til Udviklingsscoren, når den er rettet | ejer 23/10 |
| Rating-reglen | Synlige ratings falder aldrig uden ejerens vidende | 17/9 |

**Konsekvens af 11/10 og 23/10 sammen:** retning C sagde "spillerne ser ingen tal". Den 23/10 afløser det for potentialet: spilleren ser ét skønnet tal. Professionalismen og grundtalentet forbliver skjulte.

## 2. Hvad der er sandt i dag (kortlægning 23/10)

**Visning (frontend).** Potentialet vises som et interval ("66-82") på rytterprofilens hero, Scouting-fanen, Udvikling-fanen, rytterdatabasen, auktioner, ønskelisten, sammenlign, holdets trup- og udviklingstabel, U23/junior-trupperne, træningssiden, akademiet og Graduation Day. Fælles byggeklods er `ScoutablePotentiale` (`frontend/src/components/rider/ScoutablePotentiale.jsx`) med `PotentialBand` og et stjerne-fallback. Klienten regner aldrig intervallets bredde selv; den kommer fra serveren. Ingen flade lækker den rå værdi til spillere. Scouting Central og rivalholdenes sider viser intet potentiale.

**Data (backend).** Det sande potentiale ligger kun i `riders.potentiale` (1-6 i halve trin, kolonne-privilegier skjuler den for klienten). `rider_derived_abilities.hidden_potential` er afledt (potentiale + ungdom + støj) og er ikke det samme tal. Potentialet ændres aldrig efter fødslen i dag.

**Scouting.** Niveauet = antal kig pr. (hold, rytter), med loft. Spejderens kvalitet afgør, hvor meget hvert niveau snævrer ind, og en middelmådig spejder har et gulv. Afvigelserne er allerede seeded pr. (rytter, hold), og rapporten beregnes live og gemmes aldrig. Niveauer forfalder ikke.

**Tre afvigende prognosemodeller** (forklarer hullet "profilen viser anden prognose end akademiet", #6666):
1. Scouting- og akademiprognosen (`scoutingReport.js` → `riderPrognosis.js`), brugt af estimates, scouting-rapporten og akademiet.
2. Udvikling-fanens gamle loft-projektion (`developmentProjection.js`, faste envelopes fra `ability_caps`, uden potentiale).
3. Stjerne-estimatet (`estimatePotentialRange`), med kalenderalder og uden spejder på akademiets optagssti.

**Motoren** bruger det sande potentiale som farts-rate (`youthRateForPotential`) både direkte og via træningsscoren. Loftet er i dag rollens faste tag, ikke potentialet (afløses af D1b).

**Træningsscoren** gemmer pr. dag sine bidrag, og bidraget fra potentialet kan aflæses særskilt. Det er en sidekanal, der kan afsløre talentet før akademiets kendskabstrin (og før de 5 træninger fra 11/10).

**Prisen** fremskriver med det sande potentiale (karriere-NPV og typefri v6), så markedsværdien afslører potentialet (#2798).

**Baseline (prod 23/10, tal privat):** langt de fleste scoutede (hold, rytter)-par har kun ét kig på laveste niveau; kun en lille del er scoutet dybt eller flere gange. Under en tredjedel af menneskeholdene har en scout ansat. Designet skal derfor give et brugbart skøn ved første kig og lade dyb scouting være en investering.

## 3. Design: skønnet

### 3.1 Hvad skønnet er et skøn over
Det sande tal er rytterens **reelle loft i ratingens skala**: det niveau, det levende talent (grundtalent ± bånd, retning C) i dag peger på, at han kan nå. Det er samme størrelse, som D1b's bløde loft bygger på, og samme størrelse, som omregningen 1-6 → 1-99 lander i. Motoren regner på det sande loft; spilleren ser et skøn over det.

### 3.2 Hvordan skønnet trækkes
- Skøn = sandt loft + **en fast afvigelse pr. (rytter, hold)** × **usikkerheden**.
- Afvigelsen trækkes én gang fra et seed på (rytter, hold, salt). Den er den samme hele livet for parret og er klippet, så skønnet aldrig ryger helt ved siden af.
- **Usikkerheden** falder med viden: antal kig, scoutens niveau ved det bedste kig, og for egne ryttere antal træninger på holdet og trænerstab/facilitet (som i akademiets kendskabstrin i dag). Den når aldrig nul, så selv et sikkert skøn kan ramme lidt ved siden af (ejerkravet).
- Fordi afvigelsen er fast og kun usikkerheden skrumper, **glider skønnet mod sandheden**, når man ved mere. Det springer ikke til et nyt tilfældigt tal. Nyt kig kan derfor aldrig gøre skønnet mindre sikkert.
- To hold, der ser på samme rytter, får forskellige skøn (forskellige seeds). Det er meningen: ens viden er ens egen.
- Skønnet vises aldrig under rytterens nuværende rating (han har allerede nået det niveau).
- Værn mod omvendt beregning: afvigelsen afhænger ikke af niveauet, og usikkerheden er en tabel pr. vidensniveau, så to kig med forskellig scout ikke kan bruges til at regne sandheden ud. Den eksisterende inversion-harness udvides til skønnet.

### 3.3 Hvornår skønnet opdateres
Skønnet **gemmes** pr. (rytter, hold) og vises fra den gemte værdi. Det skrives kun ved:
1. **Ny viden:** et nyt kig fuldføres, eller en bedre scout scouter rytteren.
2. **Søndagskørslen:** for egne ryttere (flere træninger, talentet har flyttet sig) og for fremmede ryttere, hvis det sande loft har flyttet sig (levende talent). Det følger #6403-reglen: værdier ændres kun ved søndagskørslen.
3. **Holdskifte:** når en rytter kommer til et nyt hold, overtager det nye hold sit eget skøn (eget seed), med den viden holdet havde i forvejen.

Ellers står tallet stille. **Teknisk valg: gemt skøn** frem for live-beregning. Fordel: tallet hopper ikke, når motoren flytter det sande loft dagligt; billigt at læse; giver "ændret siden sidst" en kilde. Pris: en tabel og en søndagsjob. Alternativ: deterministisk live-beregning; fravalgt, fordi det sande loft bevæger sig hver dag med retning C.

### 3.4 Sikkerhed som ord
- Tre ord: **Usikker, Rimelig, Sikker** (EN: Uncertain, Fair, Confident; endelig copy via `TONE_OF_VOICE.md`). Ordet afledes af usikkerheden i trin.
- Grænserne kalibreres, så ordet holder, hvad det lover: "Sikker" rammer tæt på i langt de fleste tilfælde (harness-gate H1).
- Fremmed rytter uden kig: intet tal, kun "Ikke scoutet" + scout-knap (som i dag).
- Egen ungdomsrytter før 5 træninger: intet tal, "Læres · x af 5 træninger".

### 3.5 Doktrinen #5490
Doktrinen siger: det spilleren ser, er det spillet regner på. Potentialet er den **ene bevidste undtagelse**, fordi ejeren har besluttet, at det skal være et skøn (23/10). Undtagelsen afgrænses:
- Skønnet er en **visning af holdets viden**, ikke en værdi, motoren bruger. Motoren regner på det sande loft.
- Ingen anden mekanik må regne på det sande loft på en måde, spilleren kan aflæse: ikke prisen (§6), ikke sortering, ikke filtre, ikke Udviklingsscorens bidrag (§5), ikke API-svar til andre hold.
- Undtagelsen skrives ind i GDD ved siden af doktrinen, når designet godkendes.

### 3.6 Fladerne (mockups: [`docs/design/mockups-6110-potentiale-2026-10-23/foer-efter.png`](../../design/mockups-6110-potentiale-2026-10-23/foer-efter.png))
Alle flader fra kortlægningen skifter fra interval til tal + ord via én ny komponent, der afløser `ScoutablePotentiale`/`PotentialBand`/stjernerne:
- **Rytterprofil, hero (T3):** "Potentiale 74 · Usikker" og under det "Scoutet 1 gang". Loft-linjen forsvinder (D1b gør loftet til potentialet).
- **Scouting-fanen:** stort tal + ord + tretrins-måler, "bygger på" (antal kig, scoutens navn og niveau), "endnu et kig gør skønnet mere sikkert", scout igen-knap (sekundær). Én linje: "Et skøn, ikke et facit."
- **Udvikling-fanen:** grafen viser kurven mod skønnet (én linje), ikke et bånd. Prognosen bruger samme motor som alt andet (de tre modeller bliver én).
- **Akademi, trupper, træning, holdets udvikling, Graduation Day:** samme tal + ord. Ungdom før 5 træninger: "Læres · x af 5".
- **Database, auktion, ønskeliste, sammenlign:** tal + ord i én celle; sortering efter skønnet (eget hold), aldrig efter det sande.
- Tooltips og help.json om "Rollens loft" skrives om samme dag (krav fra #6110-kommentaren 20/10).

## 4. Omregningen 1-6 → 1-99 (#3564 trin 1, låst 11/10)
- Rangbevarende omregning af `riders.potentiale` til et grundtalent 1-99; kun toptalent-overskuddet presses ned; fredningsgulve.
- Ny skjult egenskab: professionalisme. Begge skjult med kolonne-privilegier som i dag.
- Det reelle loft (levende talent) beregnes fra grundtalent + karriere og gemmes, så motor, skøn og harness læser samme tal.
- `hidden_potential` er ikke grundtalentet (lav sammenhæng med `potentiale` i prod) og bruges ikke som kilde.
- Dry-run med friske tal → privat kort → ejer-go → apply (destruktivt for skalaen: ejer-gated, backup først).

## 5. Udviklingsscoren (træningsscore B + omdøbning)
- Én værdi pr. dag af intensitet, fokus-match, kondition, træner, facilitet og talent (grundtalent + professionalisme). Ungdomsfaktoren fjernes. Dagsstøjen hæves, så talentet først skiller sig ud efter nogle træninger. 7-dages snit vises ved siden af.
- **Sidekanalen lukkes:** talent vises aldrig som eget bidrag i "hvad trak op/ned". Det indgår i støjen og i totalen.
- Løbsdage får et tal på samme skala efter del 2 (kort 1-3 i del 2-spec'en afgøres der).
- Navnet skifter til Udviklingsscore samme søndag (alle sprog, help.json, patch note).
- **Kobling til skønnet:** egne træninger er det, der gør skønnet mere sikkert for egne ryttere. Tælleren er den samme som salgsgrænsen på 5 træninger.

## 6. Prisen (#2798)
**Ejer-retning 23/10:** potentialet skal på sigt ud af værdien. Når Udviklingsscoren er rettet (§5), overgår værdiens fremadrettede del **gradvist** fra potentialet til **Udviklingsscoren** (det rytteren faktisk har vist i træning og løb). Slutmålet er et værdisystem helt uden potentiale.

Konsekvenser for designet:
- Udviklingsscore B kommer **før** prisskiftet. Værdien må først læne sig på scoren, når scoren måler det rigtige.
- Overgangen er glidende: potentialets vægt i værdien aftager, scorens vokser. Ingen engangs-omregning af alle værdier.
- Værdien bruger rytterens **historik** af Udviklingsscore (fx et glidende snit over en periode), ikke dagens tal, så støjen fra B ikke slår igennem på prisen.
- Ryttere uden nok historik (nye unge før de første træninger) prissættes uden fremadrettet del; de første træninger flytter prisen.
- Under overgangen findes der stadig en rest af sidekanalen. Harnessen måler, hvor meget potentialet kan aflæses af værdien, og overgangens tempo kalibreres efter det. Tal privat.
- Omregningen 1-6 → 1-99 (§4) må ikke ramme prod, før potentialets vægt i værdien er nede på et niveau, hvor omregningen ikke flytter priserne synligt (låst 11/10: #2798 før omregningen).

## 7. De bundtede rettelser

| Hvad | Indhold | I pakken |
|---|---|---|
| **#7075** maks +1 pr. evne pr. dato | Fælles værn lige før skrivningen; klippet point bæres videre | PR'en rebases og lægges bag et eget slukket flag, der tændes samme søndag. Ingen ændring af indholdet |
| **#7084** holdskifte på reserve-stien | En rytter, der skifter hold samme dato, kan få +1 to gange, når dato-kvitteringerne er slukket | Rytter-nøglet gevinstkvittering, der skrives uanset sti. Teknisk design: en lille tabel eller et indeks på eksisterende rytter-ticks; vælges i PR'en efter målt baseline |
| **#6461** Train now = hele dagen | **Ejer-valg B 23/10: hele dagen for alle.** Klikket afregner datoens træning for alle ryttere, også dem med løb samme dag; løbet lægges på som egen linje, når det er kørt. Løbet køres stadig på datoens starttilstand (29/9, beslutning 3). Reglen "træthed og form skrives én gang pr. dato" (I4 fra 29/9) revideres | Designes og bygges sammen med form og træthed 2.0 (#6984), så træthed og form ikke bygges om to gange. Efter skiftet 25/10, bag flag. Klikket tæller som træning til de 5 træninger og respekterer +1 pr. dato |

## 8. Flag
Ét paraply-flag for visningen (`potential_single_number`) og de eksisterende/nye flag for motoren. Alle **fail-safe off, bit-identisk off**: med flaget slukket ser spillet ud og regner præcis som i dag. Tænding sker samlet en søndag i S5 efter harness-kort og ejer-go (D7).

## 9. Harness og gates (før tænding)

| Gate | Krav |
|---|---|
| H1 Præcision pr. ord | Fejlen pr. ord holder, hvad ordet lover |
| H2 Stabilitet | Samme (rytter, hold) uden ny viden: samme tal over 30 dage |
| H3 Monotoni | Mere viden flytter aldrig skønnet væk fra sandheden og gør aldrig ordet mindre sikkert |
| H4 Ingen lækage | Pris, sortering, Udviklingsscorens bidrag og API-svar indeholder hverken sandt loft eller afvigelse |
| H5 Konsistens | Alle flader viser samme tal for samme (rytter, hold) samme dag |
| H6 Inversion | To kig med forskellig scout kan ikke regne sandheden ud |
| Del 2 G1-G8 | Som i del 2-spec'en |

Tal og målbånd: privat i `balance-internals/6110/`.

## 10. Rækkefølge og migrationsbehov
Se byggeplanen (§11). Migrationer er additive og idempotente: tabel til gemte skøn, kolonner til grundtalent og professionalisme (skjulte), rytter-nøglet gevinstkvittering (#7084). Apply efter merge via auto-migrate (#2642). Omregningen af eksisterende ryttere (§4) og backfill af skøn er data-skridt med dry-run og ejer-go.

## 11. Byggeplan (små PR'er, alle bag slukket flag)

| # | PR | Afhænger af | Rører spillet før tænding? |
|---|---|---|---|
| 1 | Harness: skøn (H1-H6) + omregning dry-run, kun SELECT, output privat | - | Nej |
| 2 | Migration: skjult grundtalent + professionalisme, tabel til gemte skøn, kolonne-privilegier | - | Nej (additiv) |
| 3 | `potentialEstimate`-lib: seed, usikkerhed, ord, monotoni + tests | 2 | Nej |
| 4 | Én prognose-kilde: estimates, scouting-rapport, akademi og Udvikling-fanen læser samme lib (bag flag) | 3 | Nej |
| 5 | Søndagsjob + skrivning ved nyt kig og holdskifte | 3 | Nej |
| 6 | Frontend: én komponent for tal + ord på alle flader fra §3.6, i18n en+da, help.json | 4 | Nej |
| 7 | Udviklingsscore B + lukket sidekanal (navneskiftet ligger i del 2-pakken) | - | Nej |
| 8 | #7075 rebased bag eget flag | - | Nej |
| 9 | #7084 rytter-nøglet kvittering | 8 | Nej |
| 10 | #6461 Train now hele dagen for alle (B): teknisk design + målt baseline sammen med #6984 først, derefter byg | 8, #6984 | Nej |
| 11 | #2798 værdi: glidende overgang fra potentiale til Udviklingsscore-historik, harness for rest-lækage | 7 | Nej |
| 12 | Omregning 1-6 → 1-99: script, dry-run, privat kort | 1, 11 | Nej (apply ejer-gated) |
| 13 | Tænd-kort: harness-resultater + preview-billeder → ejer-go → samlet tænding søndag | alle | Ja, efter go |

Højst 2-3 spor parallelt. 1, 2, 7 og 8 kan starte samtidig. Verifikation: TIER FULL for 3-7 og 9-12 (motor, delte libs, i18n); ejeren ser preview (desktop og Android-bredde) før merge af 6.

## 12. Åbne ejer-kort (ét ad gangen, i denne rækkefølge)
1. ~~Sikkerhed som ord~~ besluttet A 23/10.
2. ~~#6461: Train now variant A eller B~~ besluttet B 23/10 (hele dagen for alle, med #6984).
3. ~~#2798: hvordan prisen regnes~~ besluttet 23/10: potentialet ud af værdien, glidende overgang til Udviklingsscoren, når den er rettet.
4. Godkendelse af hele designet (denne spec + mockups + §13) før første kode-PR.
5. Senere: tænd-kortet med harness-tal (privat).

## 13. Samlet gennemgang 23/10: ejerens svar S1-S21

Gennemgangen dækkede GDD, PROGRESSION_RULES, TRAINING_RULES, YOUTH_RULES, specs og alle relaterede issues. Kort: `pr-screens/6110-gennemgang/` (lokalt). Svarene her afløser modstridende tekst tidligere i denne spec (fx skjult professionalisme i §1, forklaringslinjen i §5).

| # | Emne | Ejerens svar |
|---|---|---|
| S1 | Hvad potentiale-tallet måler | Potentiale og ryttertype skabes først; den naturlige type er dér, hvor rytteren kan nå sin bedste rating på sigt. Tallet = potentialet i den naturlige rolle, som pr. konstruktion er det højeste (#5764) |
| S2 | Potentiale og evnernes lofter | Potentialet sætter niveauet, rolleklassen fordeler det: blødt loft pr. evne (højt i signaturen, lavt i svagheden), skaleret af potentialet. Ingen hårde mure, ingen synlige lofter |
| S3 | Når et skøn ændrer sig | Én samlet indbakke-besked søndag (fald og stigninger, årsag som kort udsagn) + én linje på rytterprofilen |
| S4 | Sekundær ryttertype | Bliver et medfødt anlæg. Lofterne bliver bløde og skaleres af potentialet, og sekundærens nøgleevner får altid de næsthøjeste lofter (#3813) |
| S5 | Klatrerens punch (D-050) | Mellemting: klatrere er gode i bakker, men ingen rytter kan være verdensbedst i to områder. Kun signaturen når verdenstoppen. Puncheur-klatrere har punch i sekundær-klassen, andre klatrere i en mellemklasse |
| S6 | Svaghedernes fart (#4765) | Farten stiger med klassen; svagheden er langsomst, men kan løftes over nogle sæsoner |
| S7 | Hyperspecialisering | Ingen ekstra regel. Lofter, signatur-princippet og den dyrere top er bremsen. Harnessen måler gabet |
| S8 | Tæt på toppen (#5275) | Blødt og bevaret: hvert point dyrere, fremdriften gemmes altid, ingen mur |
| S9 | Løbsdage i Udviklingsscoren | Løbsdage får et tal på samme skala; snit og værdi bygger på hele historikken |
| S10 | Hvad står under scoren | Kun tallet og 7-dages snittet. Ingen faktorforklaring (lukker også talent-sidekanalen) |
| S11 | Professionalisme og træningsdisciplin (#6190) | Én synlig mental evne: træningsdisciplin ER professionalismen og løfter både dagens udbytte og det reelle loft over tid. Ingen skjult professionalisme |
| S12 | Træningsformerne (#7103, #5319) | Version 3: hver ryttertype har to hårde sessioner med hver sin styrke og pris; ingen session giver alt. Nye: Lange stigninger, Lead-out, Korte enkeltstarter, Lange enkeltstarter, Brostensklassiker. Ændrede: Bjergintervaller (før VO2max klatring), VO2max (punch), Spurt, Tærskel. Enkeltstart og Tempo trænes aldrig i samme session. Katalog med vægte på kort før byg |
| S13 | Træner og facilitet på løbsdage (del 2 kort 1) | Faciliteter forbedrer kun træning, aldrig løb. Træneren forbedrer også kun træningsdage. Løbsdagens udvikling er ens for alle hold (catch-up-kanalen). Gate G2: ingen rytter får mindre ud af en løbsdag end i dag |
| S14 | Passende sværhed (del 2 kort 2) | D, "lær af afgørelsen": ekstra udbytte i etapens evner for ryttere med i afgørelsen, mellem for dem der faldt fra i finalen; hjælpere der arbejder i finalen tæller med (D3). Plus en bred bonus omkring eget niveau og et lidt stærkere felt, aldrig under fuldt udbytte, ingen bonus ved et alt for hårdt felt. Kræver afgørelses-data fra løbsmotoren |
| S15 | D1's ekstra løbsdage (del 2 kort 3) | Ingen ny regel; træthed 2.0 (#6984) er bremsen; harnessen måler |
| S16 | Udgået rytter | Kun basis (som en hård dag), ikke løbets ekstra |
| S17 | Fri rolle | Halvt som kaptajn, halvt som hjælper |
| S18 | Grænsen på 5 træninger | 5 rigtige datoer på holdet, hvor træningen er afregnet (Train now-klik eller automatisk træning) |
| S19 | Scout-viden | Forfalder ikke |
| S20 | Doktrinen #5490 | Besluttet. Skrives i GDD. Potentialet (skjult grundtalent, vist som skøn + ord) er den eneste bevidste undtagelse |
| S21 | Holdarbejde og Lederskab | Udvikles gennem løb efter rolle (hjælper: Holdarbejde, kaptajn: Lederskab), samlet udbytte uændret. Holdarbejde i løbsmotoren (#5348) designes først i en egen session senere og bygges, når designet er endeligt (ejer 23/10, rettet samme dag) |

### 13.1 Tilføjelser til byggeplanen (§11)

| # | PR | Bag flag |
|---|---|---|
| 14 | Bløde lofter pr. evne: potentiale × rolleklasse, sekundær altid næsthøjest, signatur-princippet, klatrerens punch (S2, S4, S5) | ja |
| 15 | Fart pr. klasse og fremdrift uden mur (S6, S8) | ja |
| 16 | Træningskataloget version 3 (S12), vægte fra harness og ejer-kort før byg | ja |
| 17 | Løbsdagen: træner/facilitet kun på træningsdage (S13), afgørelses-bonus og niveau-bonus (S14), DNF (S16), fri rolle (S17), mentale evner efter rolle (S21) | ja |
| 18 | Søndagsbesked om ændrede skøn + profil-linje (S3) | ja |
| 19 | Træningsdisciplin som mental evne (S11, #6190) | ja |
| 20 | Tæller for 5 afregnede datoer (S18) | ja |
| 21 | Holdarbejde i motoren (#5348): eget design først, ikke nu | `teamwork_in_engine` |
| 22 | SSOT og GDD: D-061 og frem for 11/10, 20/10 og 23/10; PROGRESSION_RULES §0/§3/§4/§11, TRAINING_RULES §13, YOUTH_RULES §2.5/§7 rettes | docs |
