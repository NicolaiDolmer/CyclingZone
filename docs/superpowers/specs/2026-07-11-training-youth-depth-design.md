# Træning & ungdomsudvikling — sammenhængende dybde-opgradering (design-spec)

> Status: design godkendt i retning; ejer-beslutninger runde 1 låst 2026-07-11 (§11). Eksekvering i separate sessions.
> Produktmotorer: **Træning** (#931) + **Ungdomsudvikling** (#1145/#932). Doktrinens to største produktrisici.
> Løser/samler: #1922 (træning trade-offs), #2262 (19-20-årige dødfødte), #1974 (skæv skill-fordeling), #2064 (ongoing influx), #932/#958 (akademi→U23-bue). Bygger oven på #1137 (L0 passiv), #1138/talentspejder (usikkerhed), #1791 (ungdoms-loft), #1308 (akademi-MVP).
> Ingen prod-mutation i denne spec. Migrationer beskrives kun som `.sql`-udkast. Alt balancefølsomt går gennem sim + scorecard + ejer-gate før ship.

---

## 0. Hvorfor dette er kritisk — diagnosen, ikke symptomerne

Doktrinen udpeger træning og ungdom som spillets største risici. De to akutte klager i Discord (thelamba, bekræftet af ejer) er ikke uafhængige bugs — de er **to symptomer på én strukturel svaghed i vækstmodellen**.

### 0.1 "19-20-årige føles dødfødte" (#2262) er et alders-straf-artefakt

Den daglige udvikling er (forenklet, `dailyTraining.dailyAbilityDelta`):

```
delta ∝ gap × growthFractionForAge(age) × youthMultiplier(age) × youthRateForPotential(pot) / daysPerSeason × …
```

Modellen har **to alders-nedtrapninger ganget sammen** oven på gap'et:

- `growthFractionByAge`: `≤19 → 0.35 · 20-22 → 0.28 · 23-25 → 0.18 · 26+ → 0.10`
- `youthMultiplier(age)`: `1.5 ved 16 → 1.0 ved 22`, derefter flad 1.0

En 20-årig får altså både en lavere alders-fraktion **og** en næsten-udløbet ungdoms-multiplikator — samtidig med at hans gap allerede er delvist lukket (han har trænet siden 16). Tre nedadgående kræfter rammer den 20-årige på én gang. Resultatet, ejer-bekræftet: en 20-årig 5½-stjerne får ~3-4 dage/evne = **~7-8 stigninger på en hel sæson** — samme tempo som en 27-årig i peak, på trods af massivt uindfriet potentiale.

**Rod-årsagen: væksten er alders-domineret, ikke afstand-domineret.** Den 20-årige straffes *for at være 20*, ikke for at være tæt på sit loft. Det er præcis bagvendt af hvad der skaber en troværdig udviklingshistorie.

### 0.2 "Kun nogle stats stiger" (#1974) er den samme model set fra en anden vinkel

`signatureFactor(type, ability)`: signatur-evne → `1.0`, neutral → `0.35`, modsat → `0`. Loftet (`abilityCap = baseline + headroom(pot) × signatureFactor`) betyder at en bjergrytters sprint-loft ≈ hans nuværende sprint → gap ≈ 0 → sprint vokser aldrig, uanset fokus. Det er **bevidst** (type-identitet), men **usynligt**, så manageren oplever det som "fokus-valget ignoreres". Interim-signalet (#2335) hjælper, men den egentlige kur er at gøre gap-til-loft legibelt.

### 0.3 "Alt stiger næsten uanset fokus" (#1922) fjerner valgets betydning

`TRAINING_CONFIG`: fokus-evner `×1.15/1.35/1.60`, **off-focus `×0.97`**. 0,97 ≈ 1,0 → alle ikke-fokuserede evner vokser næsten lige så meget. Der er ingen specialiserings-omkostning, og med `unlimitedSlots: true` trænes hele truppen hårdt gratis. Der er ingen trade-off, så der er intet valg — kun administration.

### 0.4 Den forenende indsigt

Alle tre symptomer forsvinder med **én model-ændring: gør væksten primært afstand-drevet (gap-til-loft), gør alder til en mild modulator, og gør fokus til en reel budget-allokering.**

- Gap-drevet vækst er **selv-aftagende** — en rytter tæt på sit loft udvikler sig langsomt uden at vi behøver en stejl alders-straf. Det giver #2082's ønskede aftagende kurve *gratis*.
- En 19-20-årig med stort gap rykker igen (#2262 løst), mens en 20-årig tæt på sit (lave) loft korrekt er "færdigudviklet".
- Loftet pr. evne bliver den legible forklaring på #1974 ("lidt upside tilbage her, meget der").
- Fokus som ægte budget-allokering (ikke `×0.97`) genindfører trade-off (#1922).

Resten af specen bygger denne model ud og binder den til ungdoms-buen.

---

## 1. Design-principper (doktrin → konkret)

Fra *Living World Product Doctrine* §"Design Principles", oversat til denne pakke:

1. **Meningsfulde valg, simpel præsentation.** Motoren er dyb; standard-fladen er ét klik. Dybde er opt-in lag, ikke tvungen administration.
2. **Explainable simulation.** Spilleren skal kunne danne og teste en mental model: *"stort gap + højt potentiale + rigtigt fokus = udvikling; lille gap eller forkert type = ikke".* Loft, gap og form eksponeres (fuzzy hvor de skal være skjulte).
3. **Intet enkelt løst regneark.** Ingen dominant build; trade-offs mellem specialisering/bredde, permanent/form, risiko/sikkerhed, ung/klar-nu.
4. **Skjult men ikke uafkodeligt.** Potentiale er skjult (talentspejder-bånd, aldrig eksakt), men systemets *kausalitet* er synlig. Usikkerheden er spillet, ikke en black box.
5. **Fair competition.** Al dybde er gratis. Cykelnørd-laget giver bedre-*timede* peaks, aldrig stærkere ryttere eller hurtigere netto-udvikling (fair-premium, #1142).

---

## 2. Benchmark: OOTP + Football Manager

Ambitionsbaren er de to bedste udviklings-simulationer i genren. Hvad vi tager, og hvad vi bevidst lader ligge:

| Mekanik | OOTP | Football Manager | CyclingZone (denne spec) |
|---|---|---|---|
| Skjult potentiale-loft | Potential ratings pr. attribut | CA/PA (skjult 1-200), PA kan være **range** (`-X`) → dynamisk loft | Loft pr. evne fra potentiale+anlæg (findes, #1791). Tilføj: **fuzzy PA-agtig range** via talentspejder, kollapser aldrig til 100% |
| Scouting-usikkerhed | Scout-bias; du ser scoutens mening, aldrig sandheden | Star-ranges relativt til trup; knowledge% smalner | Talentspejder (#1543, ejer-låst): staff-person, bånd, rest-usikkerhed ~±0,5★. **Integreres, ikke gen-designes** |
| Udviklings-driver | Aldring mod potential + spilletid + coaching + tilfældighed; bust/breakout | Alder + træning + spilletid + coach-kvalitet + tutoring + personlighed | **Gap-til-loft × mild alders-modulator × træningsvalg × stab/facilitet × stokastik** (§3) |
| Form vs. permanent | Adskilt (in-season stats vs ratings) | Condition/sharpness/morale adskilt fra attributter; intensitet↔skade | `rider_condition` (form/fatigue) findes; **opskalér race-vægt + periodisering** (§4) |
| Skade fra load | Injury proneness (skjult) | Intensitet + condition → skade | `injuryRisk` findes (hard + fatigue≥70); **kalibrér til reel, ikke career-destroying** (§4.3) |
| Dybde-lag | Development lab (opt-in fokus) | General/individuel/rest/match-prep | **Lag 0/1/2** (assistent → fokus → periodisering) (§4.4) |

**Vi tager ikke:** FM's fulde attribut-mangfoldighed (200-skala, dusinvis af skjulte personligheds-tal), OOTP's fulde scout-stab-økonomi. Doktrinen: byg i lag, kræv evidens før dybde.

**Den vigtigste låne-indsigt:** i begge spil er **usikkerheden om potentiale selve motoren for tilknytning**. Du forelsker dig i en prospect *fordi du ikke ved om han bliver stjerne*. CyclingZones talentspejder leverer allerede dette; vores job er at gøre *udviklingsrejsen* lige så troværdig som *talent-gættet*.

---

## 3. Den nye udviklingsmodel (kernen)

### 3.1 Afstand-drevet vækst med mild alders-modulation

Erstat den alders-dominerede rate med en model hvor **gap-til-loft er den primære driver** og alder kun modulerer:

```
newBudgetRate(rider) = potentialRate(pot) × ageModulation(age) × phase(age)
seasonBudget(ability) = gap(ability) × newBudgetRate     // fair sæson-andel
dailyDelta(ability)   = f(seasonBudget, dagens fokus, intensitet, condition, stab, facilitet, stokastik)
```

Ændringer mod nuværende `PROGRESSION_CONFIG` / `dailyTraining`:

- **`potentialRate(pot)`** (erstatter dobbelt-nedtrapningen som primær term): potentiale styrer både loft (uændret, #1791) og rejse-tempo. Kalibreres så et stort talent kumulativt lukker **~50% af sin rejse på 5-7 sæsoner** (ejer-mål fra #2082; matematisk `1-(1-f)^6 ≈ 0.5 → f ≈ 0.11` som ankerpunkt, aftagende variant ejer-godkendt).
- **`ageModulation(age)`** bliver **mild og flad**, ikke straffende: fx `1.15 (16-18) → 1.05 (19-21) → 1.0 (22-27) → aftager efter peak`. En 19-20-årig får ~samme rate pr. gap-enhed som en 22-årig — forskellen i deres udvikling kommer fra **deres gap**, ikke deres alder. Dette er hele fixet for #2262.
- **Selv-aftagende kurve gratis:** fordi `seasonBudget ∝ gap`, aftager væksten naturligt når rytteren nærmer sit loft. Vi behøver ikke den stejle `0.35→0.10` alders-kurve for at få en aftagende bane. Fjern den som *primær* driver; behold en svag rest som alders-modulator.
- **Sæson-budget-loft bevares** (§3.2) som anti-eksplosions-struktur.

**Hvorfor dette løser begge klager på én gang:**

| Rytter | Gap | Alder | Nuværende model | Ny model |
|---|---|---|---|---|
| 16-årig pot-6, frisk | Stort | 16 | Eksploderer (#2082) | Hurtig, men capped af budget-loft ✅ |
| 19-årig pot-5, stort uindfriet | Stort | 19 | "Dødfødt" (#2262) | **Hurtig — gap dominerer** ✅ |
| 20-årig pot-5, næsten ved loft | Lille | 20 | Langsom | Langsom — **korrekt, han er færdig** ✅ |
| 27-årig peak | Lille | 27 | Langsom | Langsom ✅ |

### 3.2 Sæson-budget-loft (mod variabel sæsonlængde)

> ### ⛔ FORÆLDET — ejer afviste retningen 15/7. Slic IKKE dette afsnit som skrevet.
>
> Ejer (15/7, efter [#2437](https://github.com/NicolaiDolmer/CyclingZone/issues/2437)): *"**Der skal som sådan ikke være et loft over hvor meget en rytter kan træne på en sæson, men deres træninger skal bare være så 'lave', at der ikke er brug for et maks.**"*
>
> **Hvorfor det haster:** afsnittet her vil *generalisere* sæson-budget-loftet "fra akademi til hele den daglige model". Præcis den mekanik har **dræbt akademi-træningen i prod** (#2437, verificeret 15/7): budgettet er et éngangs-beløb afkoblet fra sæsonlængde, sæson 1 har `end_date = NULL`, og efter ~10 dage var **18% af alle evne-rækker låst resten af sæsonen** (87% af akademi-rytterne har ≥1 låst evne). Sliced som skrevet ville vi have udbredt problemet fra 570 akademi-ryttere til hele populationen.
>
> **Konflikt med den anden spec:** [`2026-06-11-kernesystemer-design.md`](2026-06-11-kernesystemer-design.md) §5.1 siger det modsatte — *"L0-motorens sæsonvise vækstbudget **omlægges til den daglige strøm**"* — og dét matcher ejerens retning. De to specs skal forliges før slicing.
>
> **Hvad der overlever herfra:** §3.1's gap-drevne rate er stadig rigtig, og pointen om variabel sæsonlængde er reel. Det er **nødbremsen ovenpå**, der skal væk — ikke diagnosen. Åbent design-spørgsmål: er den gap-drevne rate i sig selv lav nok til at et maks er unødvendigt (ejerens krav), eller skal den kalibreres ned? Se også ejerens to øvrige krav: **træningsscore** (`2026-06-11` §5.1) og **kun enkelte evner pr. træning** (§4.1 nedenfor).
>
> Afsnittet bevares som historik + begrundelse — det skal omskrives, ikke slettes.

Kodebasen har **ingen fast sæsonlængde** (#2082-fund: S1 kørte 57+ dage; `daysPerSeason: 28` er en budget-divisor, ikke en kalender). En ren dage-baseret rate over-skyder når en sæson kører længe. Bevar #2082 kandidat-3's **sæson-budget-cap**: den samlede udvikling en rytter kan opnå på én sæson mætter ved sæsonens fair andel af gap'et, uanset hvor mange dage der tikker. Allerede delvist til stede (`computeAcademySeasonCeiling`, `SEASON_FRAC_BY_AGE`) — generaliser fra akademi til hele den daglige model.

Konsekvens der skal accepteres bevidst (fra #2082): ved lav sæson-rate bliver dag-til-dag-fremgangen næsten usynlig. Vi afbøder med den **aftagende kurve** (mere synlig fremgang i sæson 1-2, ejer-godkendt) + **progress-bar pr. evne** (findes, `ability_progress`) så "usynlig i dag" stadig føles som "bevæger sig mod næste point".

### 3.3 Potentiale-usikkerhed — integrér talentspejderen, opfind intet facit

Potentiale-usikkerheden er **allerede ejer-låst** (talentspejder-spec 2026-07-07, #1543). Denne pakke *forbruger* den, den gen-designer den ikke:

- Loftet vises som **fuzzy bånd** (aldrig eksakt, rest ~±0,5★), gælder også egne ryttere.
- **Udviklings-UI knyttes til båndet:** i stedet for "sprint vokser ikke" viser fladen "sprint: begrænset upside (scoutet loft ★★☆)" — #1974's transparens, leveret gennem loft-projektionen (#2100, talentspejder Fase 2).
- **Ingen ny potentiale-visning** opfindes her; hvis loft-projektion mangler et felt, er det et krav *til* #2100, ikke en ny mekanik.

Dette respekterer doktrinens "skjult men ikke uafkodeligt": du kender aldrig det eksakte loft, men du kan *scoute dig til* en handlingsbar tro på det og *teste den* over sæsoner.

### 3.4 Peak & aldring — unified peak bevares (ejer-afvist type-peak, se §11)

I dag: unified `peakAge: 28`, `peakAgeByType: null` (ubrugt hook). Specen anbefalede oprindeligt at aktivere type-afhængigt peak; **ejer afviste 2026-07-11** (§11 beslutning 1). Unified peak 28 bevares; `peakAgeByType` forbliver en dormant hook og røres ikke i denne pakke.

**Pension-transparens** (#1137, bobby-ønske): eksponér et **forventet pensions-vindue** på rytterprofilen (afledt af `retirement.windowStartAge 36 → guaranteedAge 40` + type-peak), så pension ikke overrasker. Fuzzy ("forventes at trække sig om 2-4 sæsoner"), ikke en eksakt dato.

---

## 4. Træning: reelle trade-offs

Mål (#1922): specialisering skal koste bredde; intensitet skal veje permanent gevinst mod form og skade; ét system skal rumme både cykelnørd og casual.

### 4.1 Fokus = ægte budget-allokering (ikke `×0.97`)

Erstat `offFocusMult: 0.97` med en reel prioriterings-omkostning:

- Dagens **fokus** får sæson-budgettet; **off-focus-evner får ~0 daglig vækst** (ikke negativt — ingen straf-atrofi i v1, jf. doktrinens "ingen random career destruction"). Du kan ikke udvikle alt samtidig — du **vælger**.
- **Balanceret program** (bredt fokus) spreder budgettet tyndt → langsom på alt. **Specialiseret program** koncentrerer → hurtig på lidt, intet på resten. Begge er valide builds.
- Dette er adskilt fra type-loftet (§3.3): en bjergrytter *kan* fokusere sprint, men gap-til-sprint-loft er lille → lidt vækst. Fokus = *hvad får budget*; type-loft = *hvor højt kan det nå*. To distinkte, begge legible.

Trade-off skabt: en specialist bliver skarpere men smallere; en all-rounder bredere men uden top. Det er build-diversitet → scorecard B1/B2.

### 4.2 Intensitet: permanent evne vs. form vs. skade

Gør de eksisterende intensiteter til et ægte kryds (i dag er `hard` ~altid bedst):

| Intensitet | Permanent-rate | Fatigue-load | Form-effekt | Skade |
|---|---|---|---|---|
| **Rest** | 0 | −14 (restituerer) | recovery mod sweet-zone | 0 |
| **Easy** | Lav | +4 | bygger form i sweet-zone | 0 |
| **Normal** | Mellem | +9 | neutral/mild | ~0 |
| **Hard** | Høj | +16 | form-dip nu (overload) | risiko ved fatigue≥70 |

Nøgle-trade-off (**periodisering**): en hård blok bygger evne men akkumulerer fatigue → form falder → skal **tapere** (easy/rest) før et mål-løb for at konvertere fatigue → peak-form. Det er FM's model, og det er cyklingens virkelighed (base → build → peak → taper).

**Kritisk forudsætning:** dette er kun en reel trade-off hvis form/fatigue **betyder noget i løb**. I dag er race-vægtene bevidst svage seams (`FORM_RACE_WEIGHT 0.012`, `FATIGUE 0.030` → ~±3%). **Opskalér** (kalibreret i sim) så en veltimet peak er værd ~8-12% race-score — nok til at gøre timing meningsfuld, ikke nok til at overdøve evne eller gøre resultater støjende (scorecard B4). Dette er en af de usikre antagelser (§9).

### 4.3 Load/knaphed via fatigue — ikke hård slot-cap

Doktrinen låser **daglig træning som spillets daglige hook** (amendment 2026-06-11) → vi må ikke fjerne "træn hele truppen dagligt". Men gratis hård træning af alle er intet valg. Løsning: **selvregulerende knaphed via fatigue** frem for en hård slot-cap:

- Intensitets-load er kumulativt. "Alle hårdt hele tiden" → hele truppen i fatigue≥70 → form-kollaps + skadesbølge → dårligere race-resultater. Systemet straffer over-træning *selv*.
- Assistenten (Lag 0) holder fatigue i et sundt bånd automatisk → casual rammer aldrig væggen utilsigtet.
- Stab/facilitet (`staffTrainingBonus`, findes) hæver recovery-kapacitet → større klub kan bære mere load = en blød, reversibel klub-fordel (doktrin-konform), ikke en hård gate.

**Skade kalibreres til reel risiko, ikke career-destroyer:** behold `injuryMaxDays: 5` loft, kun ved bevidst over-træning (hard + fatigue≥70), altid med form-varsel FØR (doktrin: ingen random destruction uden agency). Scorecard B5.

### 4.4 Cykelnørd møder casual — tre lag, ét system

| Lag | Hvem | Interaktion | Belønning |
|---|---|---|---|
| **0 — Assistent (default)** | Casual | Ét dagligt klik ("kør dagens træning", +25% bonus). Assistenten kører rolle-udledte programmer (`smartDefaultFocus` findes), holder fatigue sundt, taperer auto før mål-løb | Nul admin; ryttere udvikler sig troværdigt; enkle anbefalinger |
| **1 — Fokus & intensitet** | Engageret | Pr-rytter fokus + intensitet; blokke ("sprint hård i 2 uger") | Retning på udvikling; specialisering |
| **2 — Periodisering** | Cykelnørd | Trænings-tidslinje (base/build/peak/taper) mod mål-løb; opt-in form/load-visning (CTL/ATL/TSB-agtig); camps | **Bedre-timede peaks** — marginal edge, ikke stærkere ryttere (fair-premium) |

Design-regel: **Lag 0 må aldrig føles ringere fordi Lag 2 findes.** En casual der aldrig rører periodisering skal have troværdig udvikling og konkurrencedygtige ryttere. Cykelnørden vinder på *timing*, ikke på *rå output*. Dette er både fair-premium (#1142) og casual-retention (scorecard/usikkerhed §9).

### 4.5 Reconcilér de to modeller til én

I dag kører to overlappende modeller (fund: `processSeasonStart` kalder `developRidersForSeason` **uden** `trainingSeasonId`/`dailyTrainingEnabled` → sæson-bias er dormant, og anti-double-dip aktiveres ikke ad den vej). Ryd op til én klar ansvarsdeling:

- **Daglig træning** = den **aktive udviklings-motor for menneske-hold** (permanent evne + form). Primær.
- **Sæson-transition** = **aldring, peak-decline, retirement for ALLE** + **passiv vækst for AI-hold og holdløse ryttere** (så verden udvikler sig selv om ingen træner dem).
- **Ingen double-dip:** menneske-hold med daglig træning aktiv → `skipGrowth` i transition (kun aldring/decline/retirement). Wires korrekt i `economyEngine.processSeasonStart` (send `dailyTrainingEnabled` + `trainingSeasonId`).
- Fjern de forældede "3 fokus-slots pr. sæson"-omtaler i help/FAQ (#1922-oprydning) — de beskriver den gated model.

---

## 5. Ungdom & generationsfornyelse — tilknytning på tværs af generationer

Mål (#932/#958/#2064): gør "din egen avl" til en reel, tilbagevendende mekanik der skaber tilknytning og fornyer verden.

### 5.1 Ungdomsrejse-buen (16 → U19 → U23 → senior)

Bind de eksisterende byggeklodser til én synlig bue:

```
16   Intake (svag start, top~15, #1791) · usikkert scoutet potentiale
 ↓   Akademi (8 pladser, daglig træning, ungdoms-mult 1.5, drift 5k/plads)
17-18 U19-fase   · loft-bånd smalner med scouting · gap-drevet vækst
19-22 U23-fase   · nærmer sig loft · "klar-nu vs. udvikle-videre"-beslutning
22   Tvunget valg: promovér (senior-plads+kontrakt) / sælg (auktion) / slip
 ↓
23+  Senior · peak ~26-29 (type-afhængigt) · decline · pension 36-40
```

Faserne findes allerede som alders-tal (`YOUTH_PROGRESSION.loftByPotential`, `GRADUATE_AGE: 22`). Denne spec gør buen **synlig og følelsesladet**: hver fase-overgang er en notifikation + en beslutning, ikke en tavs DB-transition.

### 5.2 Tilknytnings-mekanik

Det der gør spilleren investeret (doktrin: "riders are the emotional protagonists"):

- **DNA-biased intake** (findes): kuldet hælder mod klubbens nation/historiske styrker → "det her er *vores* type talent".
- **To-vejs flyt akademi↔senior** (ejer-ønsket, #932-kommentar): send en akademi-rytter op til at køre løb, eller en ung senior ned i beskyttet udvikling. Kræver promotion-mekanik (`academyGraduation` findes; udvid til ned-flyt).
- **Milestone-notifikationer:** "din akademirytters første sejr", "gennembrud: TT-loft revideret op", "klar til senior". Genbrug notifikations-motoren; fød verdens-feed + recap.
- **Usikkerheds-satsning:** talentspejder-båndet gør at du *satser følelsesmæssigt* på en prospect før du ved om han bliver stjerne — den vigtigste tilknytnings-driver fra OOTP/FM.
- **Verdenshistorik-kobling** (doktrin §History): en legende der startede i *dit* akademi står i klub-museet. Langsigtet dynasty-payoff.

### 5.3 Ongoing rider-influx (#2064)

I dag genereres ryttere kun ved launch + akademi-intake → pool'en tørrer ud efterhånden som ryttere pensioneres. Tilføj en **løbende tilstrømning** til free-agent/transfer-pool'en, adskilt fra akademiet:

- **Trigger:** sæson-transition (deterministisk, idempotent — samme mønster som resten af transition-loopet), volumen population-styret.
- **Volumen kalibreret mod retirement-churn:** influx ≈ pensions-rate, så pool-størrelsen holdes stabil (måles i sim mod alders-fordelingen). Ikke en fast konstant — en funktion af population.
- **Kilde:** genbrug `fictionalRiderGenerator` med **alders-spredning** — de fleste er journeymen/rollespillere (18-26, moderat potentiale), få er sen-opdagede talenter. Ikke en anden akademi-kanal; det er *verdens* fornyelse (nye AI-hold-ryttere + free agents).
- **Interaktion:** må ikke duplikere/konflikte med `starterSquadAllocator` (nye hold) eller `aiTeamGenerator` (AI-rosters) — influx føder pool'en, de andre trækker fra den.
- **Balance-følsomt:** read-only sim før nogen DB-mutation (mønster: `simAiRosterTierWindows.js`). Scorecard: pool-størrelse + alders-fordeling stabil over 12 sæsoner.

### 5.4 Junior/U23-hold & kalendere (#958) — gated, ikke nu

Doktrinen og #958 er eksplicitte: separate Junior/U23-hold + kalendere bygges **først efter** akademi-loop'et beviser brug. Denne spec **designer buen** (§5.1) men **bygger ikke** separate kalendere. Entry-gate (fra #958): managers vælger aktivt intake-kandidater, beholder/udvikler/promoverer, ungdomsauktionen skaber markedsaktivitet. Måles via instrumentering (§7.3) — først når evidensen er der, åbnes #958.

---

## 6. Invariant-respekt (hvad vi IKKE rører)

Fra `GAME_INVARIANTS.md` + `economyConstants.js` — hårde grænser denne pakke skal holde:

- **Salary frossen ved signering (#1309):** udvikling hæver `market_value` men **aldrig** den frosne `salary`. Dette er en *feature* for spilleren: udvikl et billigt-signeret talent → værdien stiger, lønnen forbliver lav. Værdi-recompute (`predictBaseValue`) kører som nu; løn røres ikke.
- **Akademi-caps (#1308):** 8 pladser, drift 5.000/plads/sæson (gold sink — bevares), 16-21 + tvunget valg ved 22, ungdoms-mult 1.5, signing-fee-rate 0.25, akademi-løn-rate = 0.067 (delt SSOT). Ingen ændring af caps eller sinks.
- **Drift/upkeep-sinks:** ingen ny mekanik må omgå de eksisterende gold sinks eller skabe en auto-eskalerende feedback (upkeep er division-tier-skaleret, ikke roster-værdi — bevar).
- **Potentiale server-hidden (#1162):** rå `potentiale` forlader aldrig serveren; al ny UI går gennem inverterbarheds-gaten (`potentialeHiding.routes.test.js`).
- **Determinisme/idempotens:** al vækst/aldring seedes pr. rytter (FNV-1a/murmur3-helpers findes); transition-hooks idempotente via `rider_development_log` UNIQUE.
- **Migrationer:** kun `.sql`-udkast i denne pakke; anvendes **kun** når ejer merger PR'en; aldrig `apply_migration` under implementering; prod-data-migreringer (fx re-kalibrering af eksisterende ryttere) kører ejer selv mod klon → prod efter scorecard-go.

---

## 7. Simulering + scorecards (før-ship, obligatorisk)

Alt balancefølsomt her går gennem sim mod ægte/syntetisk population + scorecard + ejer-review før merge (memory: simulér-før-ship). Genbrug og udvid `previewDailyTraining.js` + `trainingRecalibrationCandidates.js` + `progressionSimHarness.js`. Kør cross-seed (2026/7/42) og cross-sæsonlængde (28/60/90/120 dage) for robusthed.

### 7.1 Scorecard A — "Føles 19-20-årige nu levedygtige?"

| # | Metrik | Mål/gate |
|---|---|---|
| A1 | **Gap-responsivitet.** rate(20-årig, gap=G) / rate(16-årig, gap=G), samme pot | **≥ 0,70** (i dag ~0,3-0,4). Afstand skal dominere alder |
| A2 | **Meningsfuld bane, 19-årig pot-5+, stort gap** | **≥ 15 evne-stigninger i sæson 1** (mod #2262's ~7-8); lukker gap på en bane ~2-3 sæsoner efter en 16-årig, ikke "aldrig" |
| A3 | **Ingen ny eksplosion.** Kumulativ gap-lukning, stort talent | **~9-13%/sæson tidligt, ~50% ved sæson 5-7** (bevar #2082-mål); variance over sæsonlængde-sweep **≤ 5 pct-point** |
| A4 | **Alderslotteri reduceret.** Andel 19-21-årige høj-pot der stadig kan nå top-band ved peak | **≥ 90%** ("dødfødt" ≈ 0% i dag for 20-årige) |
| A5 | **Peak-realisme.** Median peak-alder | **27-28** (bevar #2082 scorecard 1; unified peak, §11 beslutning 1) |

### 7.2 Scorecard B — "Har træning ægte trade-offs?"

| # | Metrik | Mål/gate |
|---|---|---|
| B1 | **Build-diversitet (ingen dominant).** Simulér N ryttere × M strategier (specialist/all-rounder/periodiseret/flad-hård) over parcours-typer. Max andel af parcours-typer hvor én strategi er #1 | **≤ 60%** (en bjerg-vinder skal tabe på sprint/klassiker) |
| B2 | **Off-focus omkostning.** Efter 1 sæson specialiseret vs. balanceret: fokus-evner højere OG off-focus-evner lavere | Målbar forskel (i dag ~0 pga 0,97). Specialisering **koster bredde** |
| B3 | **Intensitets-kryds.** Findes der en dominant intensitet? Hard-hele-tiden vs. periodiseret over en sæson, race-EV | **Periodiseret ≥ hard-altid** (form ukonverteret straffer over-træning); kryds-punkt eksisterer |
| B4 | **Form-timing-værdi.** Veltimet taper-peak vs. utaperet, race-score | **+8-12%** (nok til at time; **ikke > ~15%** → må ikke overdøve evne/blive støj) |
| B5 | **Skade = reel men fair.** Skadesrate under fornuftig træning; skader > injuryMaxDays uden varsel | Rate i acceptabelt bånd; **0** uvarslede lange skader (doktrin: agency) |
| B6 | **"No solved spreadsheet".** Brute-force optimizer vs. simpel rolle-heuristik, race-EV | Optimizer slår heuristik med **≤ ~10%** (ellers ét dominant build → fejl) |

### 7.3 Instrumentering (evidens-gates for §5.4 og doktrin-læring)

Doktrinen kræver at hvert system angiver hvilken adfærd der skal ændre + hvilken evidens der åbner næste lag. Instrumentér:

- **Træning:** Lag 0/1/2-brug (andel der rører fokus/periodisering), plan-revisions-frekvens, D7/D30 for casual- vs. nørd-kohorte.
- **Ungdom:** intake-kandidat-valg (aktivt vs. auto), akademi-retention, promotion/salg/slip-fordeling, ungdomsauktions-aktivitet (menneske-bud), flersæsons-forfølgelse af en prospect.
- **Gate for #958:** åbn separate U23-kalendere **kun** når intake-valg + retention + auktions-aktivitet viser meningsfuld brug (ikke feature-request-volumen alene).

---

## 8. Implementeringsplan

Hver fase = egen PR, egen sim + scorecard hvor markeret. Ingen fase un-gater sig selv uden ejer-go på scorecardet. Rækkefølgen respekterer at #2262/#1974 brænder nu, mens buen (§5) er dybere.

### Fase 1 — Afstand-drevet vækst (løser #2262, forener #2082) 🔴 brænder
- **Filer (ren matematik):** `riderProgression.js` (`PROGRESSION_CONFIG`, `stepAbility`), `dailyTraining.js` (`dailyAbilityDelta`, sæson-budget-loft-generalisering), `academyFlag.js` (rate-kurver).
- **Ændring:** gap primær driver; `potentialRate(pot)` + mild `ageModulation`; bevar sæson-budget-cap.
- **Gate:** Scorecard A (alle metrikker) mod syntetisk + prod-klon-population, cross-seed + cross-sæsonlængde. **Ejer-review før merge.**
- **Ingen prod-mutation.** Hvis eksisterende ryttere skal re-kalibreres: `.sql`-udkast + klon-verify, ejer kører.

### Fase 2 — Fokus som ægte budget + intensitets-trade-off (løser #1922) 🔴 brænder
- **Filer:** `training.js` (`TRAINING_CONFIG`: fjern `offFocusMult 0.97` → budget-allokering; fokus-struktur), `dailyTraining.js`, `riderCondition.js` (form/fatigue-kobling).
- **Ændring:** off-focus ~0 vækst; fokus-koncentration; intensitets-kryds via fatigue.
- **Gate:** Scorecard B1/B2. Help/FAQ-oprydning ("3 slots"-omtale).

### Fase 3 — Opskalér form/fatigue i race + periodiserings-Lag-2 (løser #1922 dybde) 🟡
- **Filer:** `raceSimulator.js` (`FORM_RACE_WEIGHT`/`FATIGUE_RACE_WEIGHT` op, kalibreret), `riderCondition.js`, frontend periodiserings-UI (opt-in), `staffTrainingBonus.js` (recovery-kapacitet).
- **Ændring:** form betyder ~8-12% i løb; taper-mekanik; Lag 2-tidslinje.
- **Gate:** Scorecard B3/B4/B5 + race-resultat-stabilitet (må ikke blive støjende). **Ejer-review** (usikker antagelse §9.2).

### Fase 4 — Reconcilér daglig vs. sæson + pension-transparens 🟡
- **Filer:** `economyEngine.js` (`processSeasonStart`: send `dailyTrainingEnabled`/`trainingSeasonId`, korrekt `skipGrowth`), `developmentProjection.js` (pensions-vindue). *(Type-peak udgået, §11 beslutning 1.)*
- **Gate:** Scorecard A5 (unified peak 27-28); idempotens-regressionstest; ingen double-dip verificeret.

### Fase 5 — Ungdoms-bue synlig + to-vejs flyt + tilknytnings-milestones 🟢
- **Filer:** `academyGraduation.js` (ned-flyt senior→akademi), notifikations-motor, verdens-feed/recap-kobling, frontend rejse-visning.
- **Gate:** Instrumentering (§7.3) live; kvalitativ Discord-feedback.

### Fase 6 — Ongoing rider-influx (#2064) 🟢
- **Filer:** ny influx-modul (genbrug `fictionalRiderGenerator`), `seasonTransition.js`-hook, økonomi/pool-sim.
- **Gate:** pool-størrelse + alders-fordeling stabil over 12 sæsoner; ingen konflikt med starter/AI-allokering. Read-only sim før DB.

### Løbende integration (ikke selvstændig fase)
- **Talentspejder** (#1543): loft-projektion (#2100) føder udviklings-UI'ets gap-visning. Koordinér, gen-design ikke.
- **#958 U23-kalendere:** forbliver lukket indtil §7.3-evidens.

---

## 9. De 3 mest usikre antagelser + evidens-krav

### 9.1 At gap-drevet rate + mild alders-modulation ikke gen-introducerer #2082's for-hurtige ungdom
**Hvorfor usikker:** vi fjerner den stejle alders-straf der (utilsigtet) også bremsede 16-årige. Hvis budget-loftet + pot-raten ikke bærer anti-eksplosionen alene, eksploderer 16-årige igen.
**Evidens-krav:** Scorecard A3 skal holde på tværs af **fuld kohorte (alder 16/19/22 × pot 2-6) OG sæsonlængde-sweep (28/60/90/120)**. Hvis 16-årige over-skyder → juster **budget-loftet**, ikke alders-straffen (ellers er vi tilbage ved #2262). Gate: ejer-godkendt scorecard før Fase 1-merge.

### 9.2 At opskalering af form/fatigue-race-vægt skaber trade-off uden at gøre resultater støjende
**Hvorfor usikker:** spillere hader hvis en veludviklet rytter taber på usynlig form. For lav vægt → intensitet er ligegyldig (hard dominerer, ingen trade-off). For høj → resultater føles vilkårlige og evne devalueres.
**Evidens-krav:** Scorecard B4 (+8-12%, ikke >15%) **plus** en race-resultat-stabilitets-metrik (varians i placering for samme rytter-felt ved fast evne, kun form varieret) **plus** kravet om at form er **synlig FØR løb** (legibility). Efter beta: Discord/interview på "føltes resultatet fair?". Gate: ejer-review i Fase 3.

### 9.3 At casual-spillere bruger den simple flade og ikke føler sig presset ind i periodisering
**Hvorfor usikker:** hele cykelnørd-møder-casual-teorien hviler på at Lag 0 er tilstrækkeligt og usynligt-godt. Hvis Lag 2's eksistens får casual til at føle at de "gør det forkert" ved ikke at periodisere, har vi gjort casual-oplevelsen ringere — stik imod doktrinen.
**Evidens-krav:** Instrumentér Lag 0 vs. Lag 1/2-brug + **D7/D30 for en ren casual-kohorte** (aldrig rørt fokus). Kvalitativ Discord: føler casual sig kompetent? Hvis casual-retention falder eller de rapporterer pres → **Lag 0-assistenten skal gøres stærkere/mere usynlig** (auto-taper, skjul avanceret som helt separat surface), ikke tune balancen. Gate: evidens-review efter Fase 2+5 i beta.

---

## 10. Bevidst ude af scope (nu)

- **Separate Junior/U23-hold + kalendere (#958):** gated bag §7.3-evidens.
- **Fuld CTL/ATL/TSB-fysiologimodel:** Lag 2 giver en *forenklet* form/load-visning, ikke en komplet træningsvidenskabs-sim.
- **Off-focus atrofi/skill-decay før peak:** v1 = off-focus stagnerer (~0), ikke falder. Aktiv atrofi er en senere depth-beslutning (risiko for "random destruction"-følelse).
- **Type-afhængigt peak** (`peakAgeByType`): ejer-afvist 2026-07-11 (§11 beslutning 1). Unified peak 28 bevares.
- **Retraining/respecialisering** (skifte en rytters type): doktrinen markerer det som "senere, langsom, usikker path". Ikke her.
- **Manager-skills der påvirker scouting-præcision** (#1109): post-launch.
- **Camps som selvstændig facilitet-økonomi:** Lag 2 nævner camps konceptuelt; den fulde facilitet-økonomi følger `FACILITIES_ENABLED`-sporet (#1441), ikke denne pakke.

---

## 11. Ejer-beslutninger — runde 1 (2026-07-11, låst)

1. **Type-afhængigt peak: NEJ.** Ejer afviste at aktivere `peakAgeByType`. Unified `peakAge: 28` bevares; hooken forbliver dormant. Konsekvens: Fase 4 slankes (kun reconciliation + pension-transparens); Scorecard A5 måler mod unified 27-28.
2. **Form-vægt i race: mål låst, tal udledes empirisk.** Ejer delegerede til arkitekt-anbefaling ("skal være verdensklasse"). Låst model: veltimet peak vs. neutral form = **+8-12% effektiv race-score**, med tre hårde guardrails der alle er scorecard-gates i Fase 3:
   - **Evne dominerer altid:** en rytter der er ~10 evne-point bedre skal stadig slå fuld form-forskel (form må aldrig invertere kvalitetshierarkiet).
   - **Resultat-stabilitet:** samme felt med kun form varieret må ikke give vilkårlige placeringer (varians-metrik i harness).
   - **Form synlig FØR løbet:** spilleren taber aldrig på noget usynligt (legibility).
   Konstanterne (`FORM_RACE_WEIGHT`/`FATIGUE_RACE_WEIGHT` mv.) udledes i Fase 3-harnesset mod ægte population — aldrig gættet direkte (samme disciplin som tid-som-valuta i økonomien). Rationale: FM's største form-fejl er vilkårligheds-følelse; OOTP's styrke er form der betyder noget uden at overdøve kvalitet. 8-12% er nok til at periodisering lønner sig, uden at en dårlig uge ødelægger en stjernes sæson.

Ingen udestående beslutninger blokerer Fase 1-2. §9's tre usikre antagelser afgøres empirisk (scorecards/instrumentering), ikke ved ejer-valg nu.

---

## Referencer

- Doktrin: `docs/superpowers/specs/2026-06-08-living-world-product-doctrine-design.md` (§Rider development, §Youth and generations)
- Kernesystemer §7 (akademi-MVP): `docs/superpowers/specs/2026-06-11-kernesystemer-design.md`
- Ungdoms-loft: `docs/superpowers/specs/2026-06-23-ungdoms-rytter-evner-rework-design.md` (#1791)
- Talentspejder (usikkerhed): `docs/superpowers/specs/2026-07-07-talentspejder-design.md` (#1543)
- Invarianter: `docs/GAME_INVARIANTS.md` · `backend/lib/economyConstants.js` · `backend/lib/academyFlag.js`
- Motor: `riderProgression.js` · `riderProgressionEngine.js` · `dailyTraining.js` · `dailyTrainingEngine.js` · `training.js` · `riderCondition.js` · `raceSimulator.js` · `academy*.js`
- Issues: #1922 #2262 #1974 #2082 #932 #958 #2064 #1137 #1138 #931 #1145
