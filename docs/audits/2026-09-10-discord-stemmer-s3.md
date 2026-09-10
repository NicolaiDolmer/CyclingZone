# Discord-stemmer, sæson 3 (25/8 - 10/9 2026)

Kilde: daglige Discord-sweeps (`.sweep-daily-2026-08-25.md` til `.sweep-daily-2026-09-10.md`), krydstjekket mod `docs/MASTERPLAN.md`, 40 nyeste åbne issues og `frontend/dist/patch-notes.json`. Alle spillere er anonymiseret til "en spiller" / "en anden spiller" osv., da repoet er offentligt. Ejerens egne ord er hans egne og citeres direkte.

## 1. Sammenfatning

Perioden dækker sæson 3-start (udskudt fra 25/8 til fredag 28/8 pga. holdudtagelses-bugs) frem til i dag. Det fylder mest: **træningssystemet** (evne-loft vs. scouting, brosten/aggression svær at træne, hele trænings-roadmappet ejeren lagde ud 2/9) med opbakning fra mindst 8 forskellige spillere hen over hele perioden, og en tilbagevendende **rytterværdi-står-stille**-bug der er lukket to gange (29/8 og 6/9) men stadig blev nævnt 9/9. Feedbacken kommer i høj grad fra en fast kerne på fire erfarne spillere udnævnt til uofficielle "CZ Advisor"-rådgivere 26/8, plus en bredere gruppe af mere lejlighedsvise stemmer. Ejeren selv sagde 25/8: "Jeg forventer i sæson 3, at der kommer nyt om både nationer... Og en større ændring til bestyrelsens ui og lidt i motoren bagved" og lovede 8/9 en admin-kategori-flyt-funktion "senest 10/9" (altså i dag). Tonen er generelt positiv og samarbejdende, med et enkelt reelt frafaldssignal 8/9 om mobiloplevelsen.

## 2. Temaer (rangeret efter antal forskellige spillere)

**Træningssystemet** (loft vs. scouting-uklarhed, brosten/aggression svært at træne, træningslejr-forslag, hele roadmappet) - ca. 8 distinkte spillere, 25/8-9/9. Delvist filet: #4874 (brosten/aggression, åben), #5063 (træningslejr, åben). Står i **MASTERPLAN Bane 1** (#4850-pakken, "Træning pr. løbsdag").

**Form-peaks og løbsplanlægning** (kan ikke fjerne peaks, peaks nulstilles ved kalenderombygning, ønske om peak pr. etape-lokation, formdyk efter peak forklares ingen steder) - 5-6 distinkte spillere gennem hele perioden. Filet 9/9: #5074, #5076 (begge åbne). **Ikke i MASTERPLAN endnu** (for nye).

**Etapetype-visning og mobil-UX** (sprint vs. bølget ikoner, stage-profil synlig ved holdudtagelse, sticky kolonner, trænings-side-redesign) - 6 distinkte spillere. Filet og lukket: #4748, #4747. Ny regression efter fix: #4982 (åben). Sticky rytternavn på mobil: #5060 (åben). Står i **MASTERPLAN Bane 3** (design-rest, #4622).

**Division/liga-struktur og inaktive hold** (skala ved vækst, superliga-idé, hvad sker med inaktive holds pladser, skift division i sæsonpause) - 6 distinkte spillere. Filet: #4592 (inaktive, åben), #5062 (divisionsskift, åben). Står i **MASTERPLAN Bane 1** (cutover-pakken).

**Auto-bud/auktionsmodulet** (sortering af højeste bud, manglende overbudt-besked, fortryd bud inden for en time, ryd overbudte auktioner fra overblik) - 4 distinkte spillere. Kun overbudt-delen filet: #4981 (åben, men Discord-DM-delen ser ud til at være leveret ifølge patch notes). **Ikke nævnt i MASTERPLAN**, falder under bane 3 "spillerfund".

**Sponsor/kontrakt-fairness** (aftale prissat til forkert division efter oprykning, flerårsaftale låst til gammel sats) - 3-4 distinkte spillere. Filet: #4376 (åben). Står i **MASTERPLAN Bane 1** ("#4376 base ved oprykning").

**Assistent/indbakke-UX** (auto-udtagelse for aggressiv, gruppér enslydende beskeder, handl direkte fra indbakken) - 5 distinkte spillere. Ældste del lukket (#4200), nyere del filet: #4984, #4985 (åbne). Står i **MASTERPLAN Bane 2** (ejerens egne bestillinger).

**Rytterdatabase/scouting/watchlist** (kan ikke sortere på rating, uklar "scouted vs. followed"-sprogbrug, flere nationaliteter ønsket) - 2-3 distinkte spillere. Sortering allerede lukket (#4035). Resten **ikke filet**. Berører løst **venteliste**-punkt 3 (rytterudvikling).

**Rytterværdi står stille trods udvikling** (gentagende bug, ikke et "tema" folk aktivt foreslår, men et klagepunkt der dukker op igen og igen) - 3 distinkte spillere, 4 separate rapporter 29/8-9/9. Lukket to gange: #4417, #4872. Står i **MASTERPLAN Bane 3** ("#4872 værdi står stille").

## 3. Bugs meldt i perioden

| Dato | Symptom | Issue | Stadig åben? |
|---|---|---|---|
| 24-25/8 | Assistent overskriver ryddede trupper, kan ikke gemme delvis trup | #4200 | Nej, lukket |
| 25/8 | Finanshistorik viser rå kode/placeholder i stedet for tekst | ikke filet | Ukendt |
| 25/8 | Rytteralder mangler på oversigt/holdside/rytterside | ikke filet | Ukendt |
| 25-26/8 | Kalender viser kun løbsdag 1, ikke fuld span, giver falske overlap | ikke filet | Ukendt |
| 26/8 | Købshistorik viser samme rytterkøb dobbelt (kun trukket én gang) | ikke filet | Ukendt |
| 26/8 | "Løb vundet" i 3/5-års bestyrelsesplan tæller forkert | ikke filet | Ukendt |
| 29/8 | Achievement-tekst krævede forkert beløbsgrænse | #4414 | Nej, lukket |
| 29/8, 31/8, 6/9, 9/9 | Rytterværdi står stille trods udvikling | #4417, #4872 | Lukket to gange, men nævnt igen 9/9 |
| 30/8 | 26-årige ryttere vist i ungdomskategorien | ikke filet | Ukendt |
| 30/8 | Mekanisk udgang gav altid skade | #4520 | Nej, lukket |
| 31/8 | Bestyrelsens planforslag byttet automatisk uden bekræft/afvis | ikke filet | Ukendt |
| 31/8 | To identiske etaper i samme løb | hotfixet samme dag | Nej |
| 31/8 | Skadet/udgået rytter kunne stadig redigeres i etape-taktik | #4538 | Nej, lukket |
| 1/9 | Kommentarbobler mangler på sidste etaper i lange etapeløb | ikke filet | Ukendt (root cause fundet, fix lovet) |
| 1/9 | Fejl ved indgang til auktionsside på PC/Edge | ikke filet | Ukendt |
| 2/9 | Assistentens forslag kunne ikke accepteres (checkbokse virkede ikke) | ikke filet | Ukendt |
| 2/9 | Skadet rytter kunne ikke vælges igen efter at være helet | ikke filet | Ukendt (ejer lovede fix) |
| 3/9 | Udbrudsjæger vist forkert på holdudtagelse | #4746 | Nej, lukket |
| 3/9 | Akademi-optag fik +2 i evne uden træning | ikke filet | Ukendt |
| 6/9 | Ingen overbudt-notifikation ved autobud | #4981 | Formelt åben, men Discord-DM-fix ser leveret ud |
| 6/9 | 0 "skarpe" træningsdage på flere ryttere i ugevis | ikke filet | Ukendt (rod-årsag bekræftet af ejer) |
| 7/9 | Puncheur er højeste potentiale for ca. halvdelen af alle ryttere | #5030 | Ja |
| 8/9 | Taktik-ordre-felt kunne ikke gemmes | hotfixet samme dag | Nej |
| 8/9 | Mobil: rytternavn-kolonne følger ikke med ved vandret scroll | #5060 | Ja |
| 9/9 | Pensionsvarsel ændrer sig midt i sæsonen | #5073 | Ja |

## 4. Ejerens egne udsagn og løfter

- **25/8**: "Jeg forventer i sæson 3, at der kommer nyt om både nationer, frivillighed angående nationer - Og en større ændring til bestyrelsens ui og lidt i motoren bagved." Delvist leveret (bestyrelses-rework i gang, se 2/9).
- **26/8**: "De ekstra ting angående løb i stedet for træning, regner jeg pt. med at rulle tilbage i løbet af idag/i morgen." **Leveret** samme uge.
- **27/8**: Om kalender-genopbygning, 812 nulstillede peak-planer: "I am sorry about that, especially if you already put the work in." **Leveret** med samme dags patch.
- **27/8**: Om knap til at anmelde en handel: "på sigt, så tror jeg, at jeg laver en knap direkte på den enkelte handel." **Ikke leveret** (#4346 stadig åben, 14 dage efter).
- **31/8**: Om forkert sponsordivision: "You were right, and I should have said so earlier instead of letting the thread argue it out." Fulgt op af faktisk rettelse.
- **2/9**: "3 års planen bliver slettet" (bestyrelses-rework). **I gang, ikke bekræftet færdig endnu.**
- **2/9**: Om spildt træning på max'ede evner: "Det håber jeg på at få ind i spillet.. Indenfor en månedstid, cirka." Deadline ca. starten af oktober, **ikke leveret endnu**.
- **6/9**: Om brosten/aggression-træning: "100% valid - Will make sure to prioritize as well(Y)." Filet som #4874, **ikke løst endnu**.
- **6/9**: "Det er på vej (Y)" (besked i indbakken ved finanskorrektion). Sandsynligvis leveret (indbakke-udvidelser ses i patch notes).
- **6/9**: Om U23/junior-løb: "Between tomorrow and 26/10-2026 i believe." Deadline ikke nået endnu, værd at følge op på.
- **8/9**: "Jeg vil have en feature til at kunne flytte forum indlægs kategori som admin, senest 10/9." **Deadline er i dag** - bør tjekkes konkret.
- **9/9**, om pensionsvarsel-bug: "Forvent ikke at jeg har noget færdigt idag. Det ligger umiddelbart ikke i kortene." Eksplicit forventningsafstemning, ikke et løfte, #5073 stadig åben.

## 5. Stemning

Perioden starter presset: sæson 3 blev udskudt på selve startdagen (25/8) pga. holdudtagelses-bugs, men spillerne reagerede forstående, ikke vredt ("Sad that season start has to be postponed, but clearly the correct decision"). Herfra stiger stemningen støt gennem den nye kalender (27/8), season matrix-lanceringen (31/8) og trænings-roadmap-afsløringen (2/9), som alle blev mødt med begejstring og høj frivillig fejlrapportering (én spiller producerede selv et helt Word-dokument med fund). Toppen ligger omkring 31/8-4/9, hvor flere spillere direkte kalder spillet "afhængighedsskabende". Perioden holder sig varm frem til 7-8/9, men slutter på et lidt lavere niveau: 8/9 kom det klareste frafaldssignal i hele perioden ("det er sååå omstændigt, at jeg til tider næsten ikke gider åbne spillet" om mobil-UX), og 9-10/9 kom det første egentlige tillidsrids: to spillere siger direkte, at de ikke kan stole på pensionsvarslet ved sæsonstart, og at det gør planlægning umulig. Ingen spiller har i hele perioden skrevet, at de overvejer at stoppe eller holde pause, men to konkrete disengagement-signaler (mobil-UX 8/9, tillid til pensionsvarsel 9/9) er værd at holde øje med fremadrettet.

## 6. Anbefalet fokus

1. **Saml træningssystemet i én sammenhængende leverance** (loft/scouting-uklarhed, brosten/aggression, camps) i stedet for punktvise fixes. Kilde: 8 distinkte spillere over hele perioden, allerede Bane 1.
2. **Luk værdi-står-stille-bugklassen for godt** med en rod-årsagsanalyse i stedet for endnu en punktrettelse. Kilde: 3 spillere, 4 separate rapporter, lukket to gange og stadig set 9/9.
3. **Mobil-UX på trænings- og holdsider** (sticky kolonner, redesign). Kilde: 3 spillere, inkl. det klareste "gider næsten ikke åbne spillet"-signal i perioden (8/9).
4. **Indfri de to konkrete løfter der hænger**: anmeld-handel-knap (#4346, lovet 27/8) og forum-kategori-flyt (lovet med deadline i dag, 10/9).
5. **Saml auto-bud/auktionsmodulet** (sortering, overbudt-flow, fortryd-vindue). Kilde: 4 spillere på tværs af perioden.
6. **Genskab tilliden til pensionsvarslet** (#5073) direkte, da det er det første eksplicitte "kan ikke stole på beskederne"-signal i perioden. Kilde: 2 spillere, 9/9.
