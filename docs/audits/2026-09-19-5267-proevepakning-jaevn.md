# #5267 prøvepakning, måde B: 5 løbsdage på HVER kalenderdato

> Read-only dry-run mod prod-kataloget for sæson 4: 28 løbsdatoer, første løbsdag 28/9.
> Intet er skrevet, intet `--apply`, sæson 3 er ikke rørt. Løbsnavne er udeladt — repoet er
> offentligt — så løbene hedder A, B, C … i den rækkefølge de optræder, præcis som i
> 18/9- og 19/9-rapporterne. Hele prøvekalenderen ligger maskinlæsbart i
> [`2026-09-19-5267-proevepakning-jaevn/`](2026-09-19-5267-proevepakning-jaevn/)
> (`d1.json` … `d4.json`), og scriptet der laver den er
> [`backend/scripts/dev/proevepakning5267.mjs`](../../backend/scripts/dev/proevepakning5267.mjs).
>
> **VALGT 20/9.** Da rapporten blev skrevet 19/9 var dette et alternativ til
> [måde A](2026-09-19-5267-proevepakning.md). Ejeren valgte den 20/9, og den er nu pakkerens
> ENESTE vej: måde A og R13's synkroniserede blokke er fjernet fra koden. Tallene nedenfor er
> **genkørt 20/9** efter fjernelsen og efter at `main` var merget ind — de er uændrede.
> Ordlyden i §3 er godkendt og står nu i `docs/CALENDAR_RULES.md` §1d/§1e-b. Loftet
> `MAX_DATES_WITHOUT_TRAINING_DAY` er samtidig strammet fra 24 til 2, så en regression
> tilbage til måde A's klumpning går rødt.

## 0. Kort svar

**Det virker, og det koster ingenting i kalenderen.**

Alle fire divisioner får **præcis 5 løbsdage på hver eneste kalenderdato** — 140 i alt, som
du besluttede 15/9. Løbene, etaperne, datoerne og overlappet er **nøjagtig de samme tal som
i dag**. Ikke et eneste løb flytter sig.

Prisen er ikke et tal i kalenderen. Den er **én regel der skal have en ny ordlyd**, og du
skal godkende ordlyden. I dag siger reglen at en tom løbsdag kun må ligge dér hvor intet løb
er i gang. Under måde B må den også ligge **inde i** et etapeløbs forløb — og på sådan en dag
**hviler de ryttere der kører det etapeløb, mens alle andre træner**. Den præcise nye ordlyd
står i §3.

Den anden ting du skal vide: **træningens side er ikke klar til det endnu.** Kalenderen kan
levere det i dag; træningsmotoren kan ikke endnu skelne "denne rytter er bundet" fra "denne
rytter træner". Det er §5, og det er ikke bygget i denne omgang.

## 1. Hvad måde B gør, i tre sætninger

1. Pakkeren finder **først** den naturlige kalender — præcis den samme søgning som i dag.
2. Bagefter fyldes **hver kalenderdato** op til 5 løbsdage med tomme løbsdage.
3. Inde på en dato lægges de ekstra dage **først** dér hvor intet løb er i gang, og **først
   derefter** inde i et løbs forløb — og de fordeles mellem dagens løbsdage i stedet for at
   ligge som én klump.

Løbene rører den ikke. Det er ikke en hensigt, det er en konstruktion: der er tre tests der
hævder at løbenes indbyrdes placering, etaperne pr. kalenderdato og overlappet er bit-for-bit
de samme som uden målet.

## 2. Resultatet pr. division (mål 140)

| | D1 | D2 | D3 | D4 |
|---|--:|--:|--:|--:|
| Løbsdage i alt | **140** | **140** | **140** | **140** |
| **Løbsdage pr. kalenderdato** | **5–5** | **5–5** | **5–5** | **5–5** |
| … heraf med løb | 80 | 56 | 56 | 56 |
| … heraf rene træningsdage | 60 | 84 | 84 | 84 |
| Træningsdage inde i et etapeløbs forløb | 53 (**88 %**) | 75 (**89 %**) | 76 (**91 %**) | 66 (**79 %**) |
| Løbsdage med mindst 2 løb | 56,3 % | 78,6 % | 50,0 % | 50,0 % |
| … gulvet (§1/#3329) | 45 % | 55 % | 40 % | 40 % |
| Etaper pr. kalenderdato (min–maks) | 5–5 | 4–4 | 3–3 | 3–3 |
| Længste stime uden en træningsdag | **1** | **0** | **0** | **0** |

De fire midterste rækker er **identiske med måde A og med kalenderen helt uden målet**. Det
er hele pointen. De to fede rækker er forskellen: rytmen bliver jævn, og prisen er at langt
de fleste træningsdage ligger inde i et løbsforløb.

Til sammenligning, samme kørsel med måde A:

| | D1 | D2 | D3 | D4 |
|---|--:|--:|--:|--:|
| Løbsdage pr. kalenderdato | 2–19 | 2–19 | **2–35** | 2–18 |
| Træningsdage inde i et forløb | 0 | 0 | 0 | 0 |
| Længste stime uden en træningsdag | 16 | 11 | **23** | 11 |

D3 under måde A: én kalenderdato bærer 35 løbsdage, og der går 23 datoer i træk uden en
eneste træningsdag. Under måde B har hver dato 5, og der går aldrig mere end én dato uden.

### Alle gates, kørt med det rigtige kalender-scorecard (`scoreCalendarPlan`)

| Gate | D1 | D2 | D3 | D4 |
|---|:-:|:-:|:-:|:-:|
| §1b kvote eksakt 100 % | 🟢 | 🟢 | 🟢 | 🟢 |
| §1 mindste-overlap (#3329) | 🟢 | 🟢 | 🟢 | 🟢 |
| §1d lige mange løbsdage (#4845) | 🟢 | 🟢 | 🟢 | 🟢 |
| §1e træningsrytme (#5267) | 🟢 | 🟢 | 🟢 | 🟢 |
| §2 løb hver kalenderdag | 🟢 | 🟢 | 🟢 | 🟢 |
| §3 plan-invarianter (GT-rygrad, whitelist, dedup) | 🟢 | 🟢 | 🟢 | 🟢 |
| §4 monument ikke i Grand Tours forløb (#4203) | 🟢 | — | — | — |
| §5 dækning + rolling-bånd | 🟢 | 🟢 | 🟢 | 🟢 |
| §6 komposition | 🟢 | 🟢 | 🟢 | 🟢 |
| §7 etaperækkefølge | 🟢 | 🟢 | 🟢 | 🟢 |
| §7b finale-bånd pr. division | 🟢 | 🟢 | 🟢 | 🟢 |
| #4270 etaper pr. rigtig dag | 🟢 | 🟢 | 🟢 | 🟢 |
| §6b uniformt mål | 🔴 | 🟢 | 🔴 | 🟢 |

**De to røde er ikke måde B's.** §6b (uniformt mål) og sæsonens finale-bånd-aggregat er
**præcis lige så røde i måde A og i kalenderen helt uden mål** — de handler om hvilke løb
katalogets etapeprofiler giver, ikke om hvor på aksen løbene ligger, og prøvepakningen
flytter ikke et løb. De er kendt drift i #4103/#4272's egne spor.

Denne kørsel har også vurderet §5, §6, §7 og §7b — de blev stående som "uvurderede" i
måde A-rapporten. Etapeprofilerne genereres nu ad samme seed-vej som skrive-stien
(#3347/#4104), så gates der måler på profiler faktisk bliver kørt. De er grønne pr. division
i alle fire divisioner i **begge** måder.

## 3. Reglen der får en ny ordlyd — det er dén du skal godkende

Måde B kan ikke gennemføres uden at én sætning ændrer betydning. Den svækkes ikke i det
stille; her er den gamle og den nye, ord for ord.

### 3a. Ejer-reglen 25/8 om løbsdage i træk

**Gammel ordlyd (CALENDAR_RULES §1d):** *"Hvis et løb har fire etaper, skal løbsdagene ligge
i træk. Ligesom i virkeligheden. Løbsdag 4-5-6-7."*

**Ny ordlyd under måde B:** *Et løbs etaper ligger i træk blandt de løbsdage der BÆRER et
løb. En tom løbsdag — en ren træningsdag — bryder ikke rækken: den er ikke en løbsdag med
løb, og løbet kører stadig sine fire etaper uden at nogen anden løbsdag med løb kommer
imellem.*

Det svarer til virkeligheden set fra rytteren: han kører etape 1, 2, 3, 4 i træk, og de
andre ryttere i divisionen fik en træningsdag imellem. Fra rytterens stol er der ingen
hviledag. Fra holdets stol er der en dag hvor de rene træningsryttere udviklede sig.

*(20/9: ordlyden er godkendt og er nu den eneste — måde A findes ikke længere i koden.)*

### 3b. "En tom løbsdag må aldrig ligge inde i et løbs forløb"

**Gammel ordlyd (CALENDAR_RULES §1d + §1e):** *En tom løbsdag må kun ligge dér hvor intet løb
er i gang. Ellers ville den blive en hviledag midt i et etapeløb, og kun Grand Tours har
hviledage.*

**Ny ordlyd under måde B:** *En tom løbsdag må ligge inde i et etapeløbs forløb. Den er ikke
en hviledag i løbet — løbet har ikke fået en etape mere eller mindre. Den er en løbsdag hvor
DE RYTTERE DER KØRER DET LØB er bundet og derfor hviler, mens alle andre ryttere i divisionen
træner.*

Bindingen findes allerede i databasen og siger præcis det: `race_entry_days` binder rytteren
på **hele** forløbet fra første til sidste etape, ikke kun på de dage han kører (#4173 →
#4217 → din beslutning 3/9 i #4209). En indsat tom løbsdag inde i forløbet får derfor
automatisk sin bindingsrække, uden at nogen skal ændre noget.

### 3c. Gates og tests der bygger på den gamle ordlyd

De blev fundet og navngivet 19/9, og **lukket 20/9** da ordlyden blev valgt:

| Hvor | Hvad den antog | Status 20/9 |
|---|---|---|
| `raceCalendarLanePackerRaceDayTarget.test.js` → *"en tom løbsdag ligger ALDRIG inde i et løbs spænd"* | den gamle ordlyd, ordret | **Erstattet** af en test på at hver tom løbsdag er enten en indsat træningsdag eller en GT-hviledag. |
| `raceCalendarLanePackerRaceDayTarget.test.js` → *"etapeløbenes løbsdage ligger stadig i TRÆK"* | huller måles på de rå løbsdags-numre | **Flyttet** til `…EvenTrainingDays.test.js`, hvor samme krav måles på **rangen blandt løbsdage med løb**. |
| `raceCalendarLanePackerInvariants.test.js` → *"en hviledag optager løbsdagen, men fylder ikke en plads"* | en løbsdag inde i en Grand Tours forløb er aldrig tom | Urørt og stadig grøn: den måler den NATURLIGE pakning, uden mål. |
| `solveContiguousStarts` R5 (`aktive.length === 0` ved dato-slut) | søgningen må ikke efterlade en tom løbsdag | **Urørt og skal forblive urørt.** Det er den naturlige pakning. Padding lægger dagene bagefter, uden for søgningen. |
| `padAxisWithTrainingDays`' frie-positioner-regel | en tom løbsdag kun uden for alle forløb | **Fjernet.** Frie positioner bruges stadig FØRST inden for en dato, men de er ikke et krav længere. |

Der er **ingen** produktions-gate (ikke i `calendarPlacementGates.js`, ikke i scorecardet,
ikke i `verify-invariants`) der måler kontiguitet på de rå løbsdags-numre. Kravet levede kun
i pakkerens konstruktion og i de tre tests ovenfor. Det er derfor måde B kan bygges uden at
svække en eneste kørende gate.

## 4. D1 i detaljer (du spurgte specifikt)

D1 er den eneste division hvor nogen kalenderdato allerede har 5 løbsdage af sig selv.

| Naturlige løbsdage på datoen | Antal datoer | Ekstra dage datoen skal have |
|---|--:|--:|
| 2 | 15 | 3 |
| 3 | 5 | 2 |
| 4 | 5 | 1 |
| **5** | **3** | **0** |

- **3 datoer har allerede 5 løbsdage** og får ingen ekstra. Det er derfor D1's længste stime
  uden en træningsdag er **1** og ikke 0 — og de tre datoer ligger ikke ved siden af hinanden.
- **Ingen dato har MERE end 5.** Det kan den heller ikke: hver løbsdag bærer mindst én etape,
  og en kalenderdato har præcis sine 5 etaper, så en dato kan højst have 5 løbsdage. 5-5 kan
  altså altid holde, og der er ingen afvigelse at foreslå.
- D2, D3 og D4 har **præcis 2 naturlige løbsdage på hver eneste dato**, så de får 3 ekstra
  hver eneste dag. Deres stime uden træningsdag bliver 0.

## 5. Træningens side — læst, ikke bygget

Spørgsmålet er: kan "den bundne rytter hviler, alle andre træner" faktisk holde?
Svaret er **ja på data, nej på motoren endnu.** Tre ting, i rækkefølge:

**1. Bindingen er der allerede, og den er rigtig.** `race_entry_days_rebuild()` skriver én
række pr. (løb, rytter, løbsdag) for **hele** forløbet fra første til sidste etape. En tom
løbsdag inde i forløbet får derfor sin række automatisk. Ingen migration, ingen ændring.
Spørgsmålet "er denne rytter bundet på løbsdag *g*?" kan besvares med ét opslag i dag.

**2. Træningens tick kan ikke se en tom løbsdag endnu.** Opslaget der finder holdets
aktuelle løbsdag læser `race_stage_schedule`, og en løbsdag uden løb har ingen række der. Den
er derfor usynlig. Det er en kendt og dokumenteret begrænsning i fase B2; udløseren
"løbsdagen lukker", som også dækker tomme løbsdage, er **fase B4**. Uden den ville måde B's
ekstra træningsdage slet ikke udløse træning.

**3. Ticket er pr. HOLD, ikke pr. rytter.** Træningsdagen reserveres på (hold, sæson,
løbsdag), og der er ingen rytter-gate der spørger om rytteren er bundet. Under måde A gør det
ingen forskel — dér ligger **nul** træningsdage inde i et forløb, så ingen rytter er nogensinde
bundet på en træningsdag. Under måde B ligger **79–91 %** af træningsdagene inde i et forløb,
så den gate holder op med at være et særtilfælde: den afgør træningen på næsten hver eneste
træningsdag.

**Hvad der skal til (ikke bygget her):**

- Fase B4's udløser skal drives af **løbsdags-aksen** (140 dage), ikke af hvilke løbsdage der
  har rækker i `race_stage_schedule`.
- Sweepen skal have et rytter-filter: rytteren træner på løbsdag *g* medmindre der findes en
  `race_entry_days`-række for (rytter, sæson, *g*). Den regel skal deles af motoren og
  visningen, ellers driver de fra hinanden — samme fejlklasse som
  `.claude/learnings/2026-08-27-guard-og-haandhaevelse-skal-dele-maengde-semantik.md`.
- Spillerens ugeprogram (7 ugedage × 5 løbsdage) skal kunne vise "denne celle blev ikke kørt,
  rytteren var i løb", ellers ligner en bundet rytters manglende udvikling en fejl.

## 6. Metode

- `buildTierMaterializationPlan` mod den committede prod-katalog-fixture
  (`backend/lib/__fixtures__/racePoolCatalog.prod.json`), 28 kalenderdatoer, første løbsdag
  28/9, kvoter efter §1b. Én repræsentativ pulje pr. division; alle puljer i en division er
  ens (#2276).
- Gatene er kørt med det rigtige kalender-scorecard (`scoreCalendarPlan`) — samme kode som CI
  og `buildSeasonCalendar.js` — ikke med en håndskrevet tælling.
- Etapeprofilerne genereres ad samme seed-vej som skrive-stien (#3347/#4104), så §5/§6/§7/§7b
  faktisk bliver vurderet.
- Overlap måles som andelen af løbsdage MED løb der bærer mindst to forskellige løb, altså på
  den naturlige pakning. Tomme løbsdage indgår ikke og kan derfor ikke pynte tallet.
- "Inde i et forløb" = løbsdagen ligger strengt mellem et etapeløbs første og sidste etape.
- Kørslen kan gentages: `node backend/scripts/dev/proevepakning5267.mjs`. Den læser ingen
  database og skriver kun JSON-filerne under `docs/audits/` når `--write=<mappe>` gives.
  (Frem til 20/9 tog scriptet et `--placement`-valg; det er væk sammen med måde A.)
- Ingen `--apply`, ingen skrivning, ingen migration. PR #5169 er ikke merget.

## 7. Dom

**bekræftet: 5 løbsdage på hver kalenderdato holder i alle fire divisioner, uden at en
eneste gate falder · lukket 20/9: ordlyden i §3 er godkendt og står nu i CALENDAR_RULES
§1d/§1e-b · ikke bygget: træningens rytter-gate (§5)**
