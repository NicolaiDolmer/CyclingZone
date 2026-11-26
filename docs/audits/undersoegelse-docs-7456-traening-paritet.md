# Træning R5: paritetsgennemgang af I dag, Program, Udvikling og Rapport (#7456)

Dato 23/11 2026. Undersøgelsesspor (kind: investigate, #5220), kun læsning. Ingen produktkode ændret.

**Ejerens regel (23/11, ordret):** "Siderne må ikke være dårligere end tidligere eller nuværende sider på nogen punkter, medmindre vi aftaler afvigelserne/manglerne. Siden må kun blive det samme, eller bedre."

## Metode og kilder

- **Kode på `origin/main` 235e0966e:** `frontend/src/pages/TrainingPage.jsx` (den gamle side = grenen når `training_page_r5` er off), `components/training/r5/TodayR5.tsx`, `ProgramR5.tsx`, `ProgramR5Phone.tsx`, `reportXp/XpToday.tsx`, `XpMonth.tsx`, `DevelopmentTabXp.tsx` (+ model-filerne) og `public/locales/*/trainingR5.json`.
- **Krav og wireframes:** kravspec `docs/audits/2026-11-16-7947-traening-kravspec.md` §1 (paritetslisten), dommer-scenarierne `docs/audits/7456-program-dommer-scenarier.md`, de lukkede skitse-PR'er #8248 (samlet design), #8506 (R5 Program) og #8507 (R5 I dag, "de fem afvigelser"), `docs/design/TASTE.md` og `PAGE_TEMPLATES.md` (T2).
- **Billeder:** eksisterende preview-mock-billeder i repoet (1440 og 390), set side om side: `pr-screens/7947/r5-idag/before-1440.png` mod `after-1440.png`, `pr-screens/7947/rapport-1440.png`, `pr-screens/7947-udvikling/before-1440-lys.png` mod `20-11-xp-1440-standard.png`, `pr-screens/8547/*` (Program telefon). **Der er ikke taget nye billeder i dette spor:** billedstationen (`scripts/pr-shots.mjs`) kræver ejerens login og et build, og sporet kører kun i forgrunden inden for 60 minutter. De nye side-om-side-billeder pr. DÅRLIGERE-punkt er trin 1 i fix-planen nedenfor.
- **Ikke gentaget (kendte spor):** #8601 ugeblokke, #8624/#8625 rotation, #8622 programvalg, #8592 dagsvælger B.

Status: `=` samme, `bedre`, `ændret (aftalt)` = afvigelse ejeren har godkendt (kilde angivet), `DÅRLIGERE` eller `mangler` = punkt til ejeren.

## 1. I dag

| Funktion/info | Gammel side | R5 nu | Wireframe | Status |
|---|---|---|---|---|
| Overblik (mangler plan / løb / træner / trætte), filtrerer ved tryk | Fire tal-kort med navne | Én tekstlinje "6 training · 2 racing · 2 tired · 6 no program" (`overviewCounts`, `matchesOverview`) | #8507: tal-linje | = (mindre plads, samme filter) |
| Træthedsgrænsen som én linje | Under tallene | Øverst, med Edit | Samme | = |
| Dagens beslutning (1-3 forslag, Use) | Ja | Ja (`DailyDecision`) | Ja, plus "Use all" | = |
| Assistentens bud pr. rytter ("Agrees" / "Use assistant pick") | Egen kolonne i hver række | Kun knappen "Assistant" (panel) + Dagens beslutning (1-3 ryttere) | #8507: flyttet til Dagens beslutning | **DÅRLIGERE**: man ser ikke længere for hver rytter, om assistenten er enig |
| Træthed i aften (~xx) | Kolonne "Fatigue now / tonight" | Kun "Fatigue now" + "Day load" (ord + pil) | Afvigelse 3 i #8507; billedets note "owner 20/11" | ændret (aftalt 20/11) |
| Dage på 70+ | Egen kolonne | Mærke i rækkens status + rytterkortet (`card.days70`) | Afvigelse 3 | ændret (aftalt) |
| Type og alder | Under navnet | Egne kolonner Type og Age | Ejer 17/11 (navnecelle = kun navn) | bedre |
| Dagsvalg | Dropdown pr. rytter + Apply | Træningsvælger + Rest/Easy/Medium/Hard i rækken, gemmer straks | R5 | bedre |
| "Trains … · Fits type" ved sessionsvalget | I fokus-/dagspanelet | Samlet i kortet (`onPickSession` åbner panelet) | Afvigelse 4 | ændret (aftalt) |
| Træningsscore 1-99 | Kolonne i holdtabel B (`training_score_visible` on) | Findes ikke på I dag (`r5Today` sender ikke `trainingScore`) | Ejer 20/11 fjernede den i XP-rapporten; intet om I dag | **mangler** (eller skriv afvigelsen ind) |
| Sæsonens evne-fremgang pr. rytter | I rækken (telefon) / kvittering | Ikke i R5-rækken (`todayGainsByRider` sendes ikke) | Flyttet til Udvikling 1/10 (#6025) | ændret (aftalt) |
| Masse-dag (alle / valgte, gruppér efter type, Set for group) | "Set today's day for … Apply" | Holdlinje "Whole team today" / "N selected" | Afvigelse 1 | ændret (aftalt) |
| Sortering, gruppér efter type | Dropdown "Sort by" + checkbox | Sorterbare overskrifter + "Group by type" + filtre (alder, grupper, type) | R5 | bedre |
| Tilbage til holdets program | "Back to team program" | Samme tekst "Back to team program" | – | = på I dag, **men se Program punkt P1**: holdets program kan ikke længere ses eller rettes |
| Mærker: skade, skaderisiko, U23/JR, akademi | Under navnet | Under navnet + kortet | Ja | = |
| Løbsmærke på løbsdag | "Race"-mærke ved vælgeren | "Race · <løb>" i I dag-cellen | Ja | = |
| Rytterkort folder ud, profil-link | Ja | Ja (`renderCard`) | Ja | = |
| Tom / indlæser / fejl, Saved, tour, hjælpelink | Ja | Ja | Ja | = |
| Telefon: ét tryk Hvile/Restitution/Program | Ja | Valgknapper i rækken (#8563) | Afvigelse 5 (to tryk) blev rullet tilbage til ét tryk | = |
| Telefon: "Hvile for flere", sortering | Ja | Markering + sorteringsliste | Ja | = |

**#8586 (to værdier i én celle) på I dag:** Type-cellen viser to typer stablet ("Sprinter / Rouleur") i én kolonne; navnecellen bærer også statusmærker ("High injury risk", "2 days at 70+"); I dag-cellen bærer vælger + indsats + linjen "Your day …". Type-cellen er den mest sandsynlige kandidat til ejerens billede (samme mønster står på Udvikling).

## 2. Program

| Funktion/info | Gammel side | R5 nu | Wireframe | Status |
|---|---|---|---|---|
| Underfaner Plan / Programs / Fatigue limit med `?sub=` | Ja | Én flade: bibliotek til venstre, uge til højre; grænsen åbnes som panel (`request.kind = "limit"`) | #8506 | ændret (aftalt) |
| **Holdets ugerytme (plan for hele holdet)** | "Plan for: holdet", kladde + gem | **Findes ikke**: emner er kun gruppe eller rytter (`onSubject({kind:"group"})`, `rider:`), intet hold-emne | #8506: "et program sættes kun på en gruppe eller en rytter" | **DÅRLIGERE (P1)**: ryttere med "No program" følger stadig holdets gemte plan i motoren, og I dag skriver "Back to team program", men planen kan hverken ses eller rettes nogen steder i R5 |
| 35 felter (7 dage × 5), etapefelt i dag låst | Ja | Ja, løbsfelter grå + flag, lås-ikon på i dag | Ja | = |
| Markering af overstyret felt (manuelt felt vinder) | Markeret i cellen | Ingen markering fundet i `ProgramR5.tsx` | K4 i kravspec: "felterne viser altid, hvad der faktisk trænes" | **mangler**: bekræft på billede |
| Rytterens egen plan vinder, vist som chips | Chips | "Own plan: <navn>" i biblioteket | Ja | = |
| Kopiér en dag; kopiér til ryttere | Kopiér dag | Kopiér dag, kopiér alt, "Copy to riders" | Ja | bedre |
| Programkatalog (22, filtreret efter type), tildeling = kopi | Ja | Bibliotek "All programs / Fewer programs" | Ja | = |
| Træningsgrupper, "Følg gruppen", gruppens træthedsundtagelser | Ja | Ja (`GroupFatigueExceptions`, team/own/off) | Ja | = |
| Træthedsprognose for ugen / træthed i aften | Ja | Ja (`FatigueForecast`) | Ja | = |
| Gem / ugemt / kassér | Gem | Guldknap "Save plan" i sidehovedet, "N unsaved", Kassér | Ja | bedre |
| Tom / indlæser / fejl | Delvist | Ja (#8561) | Ja | bedre |
| Telefon | Samme flade, smal | Dag/Uge-skifter, Gem fast i bunden (#8547) | #8506 A/B | bedre |
| Dommer-scenarier ROT-*, WB-*, UGE-* | – | Ligger i #8624/#8601/#8592 (ikke gentaget) | – | uden for dette spor |

## 3. Udvikling (bag `development_xp_model`)

| Funktion/info | Gammel side | R5 nu (XP) | Wireframe | Status |
|---|---|---|---|---|
| Sæsonoverblik pr. evne (%, dato, "DONE" ved loft) | Kort øverst | Evnerne som underrække med XP-bjælke "x / y XP", lås ved loft | Retning 5 (ejer 19/11) | bedre |
| Potentiale (tal + ord), akademi-prognose | Interval + loft pr. rytter | Kolonne "Potential 75 Confident", akademi-celle | Delt komponent #7686 | = |
| Skift fokus | Dropdown direkte i rækken | I fold-ud (`onChangeFocus`, #8562) | #8562 | ændret (aftalt), ét tryk mere |
| Udviklingsglyf | Ja | Ikke fundet i XP-fanen | – | **mangler** (lille; bekræft om aftalt) |
| Rating og sæsonændring, XP i dag / 30 dage, næste point | – | Ja | Ja | bedre |
| Kolonnevælger (natural/rolle/rating30) | – | Ja | Ja | bedre |

**#8586 på Udvikling:** "Natural type" viser to typer stablet i én celle (samme mønster som I dag).

## 4. Rapport (bag `development_xp_model`)

| Funktion/info | Gammel side | R5 nu (XP) | Wireframe | Status |
|---|---|---|---|---|
| Dagskvittering for hele datoen, løbets andel | Ja | Ja, med dagspile og 7-dages strip | Ja | bedre |
| 30 dage | Historik + træningsscore-graf | XP pr. dag (træning/løb), tryk åbner dagen | Ja | = (graf skiftet) |
| Træningsscore i rapporten | Ja | Fjernet | Ejer 20/11 (kommentar i `XpToday.tsx:174`) | ændret (aftalt) |
| Dagens øjeblik | Ja | Ja (`TrainingMoment` uændret) | Ja | = |
| Rytternavn | Fuldt navn | Afkortet midt i efternavnet på 1440 (mock-ryttere) | TASTE: navnet brydes aldrig inde i et ord | **DÅRLIGERE** |
| Type | Fuld | Afkortet ("Time-trial…", "Cobbles s…", "GC conte…") | TASTE | **DÅRLIGERE** |

**#8586 på Rapport:** Fatigue-cellen viser to værdier ("54 ↑6": nu + ændring), Rating-cellen to ("60 › 61"), Form i panelet to ("91 › 90").

## Top 10 punkter til ejeren (DÅRLIGERE eller mangler)

1. **P1 Program:** holdets ugeplan kan ikke ses eller rettes i R5, men styrer stadig ryttere uden program, og I dag skriver "Back to team program". Valg: (A) vis holdet som første emne i biblioteket, eller (B) aftal at holdplanen udgår og skift teksten til "Back to no program" + datareparation.
2. **I dag:** assistentens dom pr. rytter (enig / brug forslag) er væk fra rækken; kun 1-3 ryttere i Dagens beslutning.
3. **I dag:** træningsscoren er væk uden en aftalt afvigelse for I dag (kun aftalt for Rapport).
4. **Program:** et manuelt overstyret felt er ikke markeret i ugen.
5. **Rapport:** rytternavne afkortes midt i navnet på 1440.
6. **Rapport:** typen afkortes.
7. **#8586:** Type/Natural type viser to typer i én celle (I dag og Udvikling).
8. **#8586:** Rapportens Fatigue og Rating viser to værdier i én celle.
9. **#8586:** I dag-navnecellen bærer også statusmærker (navnecelle = kun navn, ejer 17/11).
10. **Udvikling:** udviklingsglyfen findes ikke i XP-fanen.

## Fix-plan

1. **Billeder (før/efter side om side), 1440 + 390:** `node scripts/pr-shots.mjs shoot` på main med flag-mocken (`training_page_r5`, `training_groups`, `training_week_forecast`, `training_effort_levels`, `development_xp_model`) under `verify-lock.ps1 -Max 2`, gemt i `pr-screens/traening-paritet/`, ét billede pr. punkt 1-10. Kræver ejerens login i billedstationen (Dolmer PC). Risiko: ingen (kun billeder).
2. **Ejer-beslutning pr. punkt** (ét spørgsmål ad gangen, med billede): punkt 1, 2, 3 og 10 er "bygges eller aftales som afvigelse".
3. **Byg (efter ja), små PR'er bag `training_page_r5`:**
   - P1: `ProgramR5.tsx` + `programR5Model.ts` (hold-emne i `subjectsFor`, gemmer via eksisterende `setWeekPlan`), eller tekst + data hvis holdplanen udgår. Risiko: mellem (motorens lag, TRAINING_RULES §4; dommer-scenarie ROT-9).
   - Assistent pr. rytter: én linje i `TodayR5.tsx` StatusLine fra `smartDefaultFocus`. Risiko: lav.
   - Træningsscore: send `trainingScore` i `r5Today` og vis i kortet eller som kolonne. Risiko: lav.
   - Overstyret felt: markering i `ProgramR5.tsx` weekCells. Risiko: lav.
   - Rapport-afkortning: `reportXp/XpToday.tsx` `ROW_GRID` + `RiderNameCell` (kort navn som på telefon i stedet for midter-afkortning), type på to linjer. Risiko: lav (kun præsentation).
   - #8586: delte celler i `TodayR5.tsx`, `DevelopmentTabXp.tsx`, `XpToday.tsx`. Afvent ejerens billede fra #8586 for at vælge præcis celle. Risiko: lav.
4. **Verifikation:** `npm run lint`, `node --test`, build, `verify-affected.mjs`; billeder før merge (UI-PR = ejer-go på billede).

bekraeftet + fix-plan
