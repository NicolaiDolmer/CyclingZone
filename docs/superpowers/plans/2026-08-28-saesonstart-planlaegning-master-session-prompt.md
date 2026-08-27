# Prompt: Sæsonstart — holdudtagelse og planlægning (workflow-master-session)

> Skrevet 27/8 2026 som handoff fra planlægnings-sessionen, udvidet efter ejer-input samme dag: **spor A og B kører i samme session**, **UI/UX bygges og designes her**, og sessionen skal være en **workflow-session der kører flere spor parallelt**.
> Forarbejde: de 20 spillerrettede issues 24.-27/8 · `docs/PLANNING_CENTER_RULES.md` · `superpowers/specs/2026-08-25-planning-center-z1-saesonmatrix-design.md` · `docs/audits/2026-08-28-natsession-rapport.md`.
> Alle tal og kodelinjer nedenfor er **verificeret** i forarbejdet. Brug dem; gæt ikke nye.

---

Sæson 3 ruller **fredag 28/8 kl. 11**. Denne session har ét mål:

**Holdudtagelse og planlægning skal føles færdige — og bedre end før kalender-rebuilden — når spillerne logger ind.**

De sidste fire dage har 20 spillerrettede issues ramt ind. Tre fjerdedele handler om det samme: **manageren kan ikke se eller styre hvem der kører hvad hvornår.** Det er den flade spillet lever af, og lige nu tvinger den ham til at gætte, prøve sig frem og slås med systemet.

Det retter vi. Ikke ved at lappe. Ved at gøre fladen **verdensklasse** — på niveau med de bedste managerspil, med vores eget udtryk.

## Sådan skal denne session arbejde

**Kør det som en workflow-session.** Sporene nedenfor er uafhængige nok til at parallelisere, og designarbejdet skal have et rigtigt panel, ikke ét gæt.

Mønstret der passer:

```
Fase 1  Kortlæg      — parallelle læsere: én pr. spor, mod kode + SSOT + issue-tråd
Fase 2  Design       — 2-3 UAFHÆNGIGE forslag pr. flade, hver med sin linse
                       (mindste tilføjelse · mest læsbar ved 30 ryttere · mobil først)
Fase 3  Dommerpanel  — scorer mod PAGE_TEMPLATES + anti-AI-slop-kriterierne nedenfor
Fase 4  Byg          — vinderen, med det bedste fra runners-up grafted ind
Fase 5  Verificér    — adversarisk: agenter der forsøger at REFUTERE at fladen er klar
```

Brug `pipeline()` mellem faserne, ikke barrierer — spor B's designpanel skal ikke vente på at spor A's build er færdig. Barriere er kun rigtigt der hvor et spor faktisk skal se hele det forrige sæt (dommerpanelet).

**Sessionens størrelses-guideline står i /config.** Overskrid den kun hvis du siger det højt og begrunder det.

Stil spørgsmål **ét ad gangen**, med din anbefaling og de relevante tal **inde i selve spørgsmålet** — ejeren ser ikke altid prosaen før kortet.

## Læs først — ellers genopfinder du noget der findes

1. `docs/PLANNING_CENTER_RULES.md` — **områdets SSOT.** Hard rule 30: citér den, opdatér den i samme PR. §6 = komponenter der ALDRIG bygges om. §7 = verificeret UI-gæld. §8 = fem åbne modsigelser.
2. `docs/design/PAGE_TEMPLATES.md` — **bindende.** T1/T2/T3, én guld-primær pr. view, hairlines uden skygger, 5px radius, tabular figures, stroke-ikoner, `text-2xs`=11px / `text-3xs`=10px og intet derunder. Artboards i `docs/design/design_handoff_page_templates/`.
3. `docs/superpowers/specs/2026-08-25-planning-center-z1-saesonmatrix-design.md` — Z1-gitteret, fire ejer-beslutninger låst 25/8.
4. `docs/superpowers/specs/2026-08-21-planning-center-fase2-design.md` — IA'en. Z2/Z3/Z4 er uden for scope.
5. `docs/CALENDAR_RULES.md` §0 — de to akser. En løbsdag bor **inde i** én kalenderdag; `game_day` udledes aldrig af `scheduled_at`.
6. `frontend/public/race-planning-preview.html` — vores egen preview fra 20/8, som en spiller byggede videre på 25/8. Læs `.claude/learnings/2026-08-25-spillerprototype-afsloerede-to-brudte-kalender-invarianter.md` før du "opfinder" gitteret.

## Verificeret virkelighed

### #4295 er ikke en fejlet fix — det er en regel ingen har besluttet

`frontend/src/lib/raceSelectionLogic.js:73-79`:

```js
const required = size.max;
const kanFyldeTruppen = !Number.isFinite(availableCount) || availableCount >= required;
if (riderIds.length > required) errors.push("selection_wrong_size");
else if (requireFull && kanFyldeTruppen && riderIds.length !== required) errors.push("selection_wrong_size");
```

`requireFull` defaulter til `true`, og kalderen sætter `requireFull: !data.selection` — en **førstegangs**-udtagelse blokeres derfor stadig hvis holdet *kan* fylde. #4175 løsnede kun for hold der *ikke kan*. Backenden (`backend/lib/raceSelection.js:25`) afviser KUN over feltstørrelsen. **Klienten er strengere end serveren, uden at nogen har truffet det valg.**

Og #4174: kalenderen kræver op til **29 ryttere**, kun **21 %** af holdene kan stille fuldt hold — i D4 er det **2 af 46**. Reglen tvinger dem til at møde op med nul.

### #4201 er allerede bygget — den mangler at blive skrevet ned og vist

- `backend/lib/raceEntryGenerator.js:223` — `eligibleTeams = allTeams.filter(t => !t.is_frozen && !t.user_id)`. Den proaktive sweep rører **ikke** menneskehold. Kommentaren siger det selv: *"Assistenten er dermed pull, ikke push (#4201)."*
- `backend/lib/raceRunner.js:844` — løbs-tidens autofyld er den sene redning, og springer afmeldte OG ryddede hold over siden #4285 (merged 27/8 05:39).
- Målt i nat: af **24.724** S3-udtagelser ligger **24.615** på AI-hold, kun **109** på 3 menneskehold — alle spiller-initierede.

Modellen er altså **opt-in + sen redning**, og ejeren bekræftede den 27/8. Men `PLANNING_CENTER_RULES.md` §4 kalder den stadig en åben beslutning, og **ingen spiller er blevet fortalt det.** Tre auto-udfyld-indgange findes stadig (dagsboardet, `PlannerAssistantCard`, `/selection/auto`), og "Ryd" er den eneste måde at sige "jeg møder op med færre" — pr. løb, med bekræftelse.

### Z1-aksen er fri

#4236 er lukket, og prod-målingen 27/8 kl. 02:10 viser **0 løbsdage over flere datoer**. Spec'ens §3 lukkes derfor på dato-udfaldet: **kolonnerne er 31 datoer**. Ingen vandret virtualisering. Begge akser vises stadig — dato som ramme, løbsdags-striben som sandhed.

### #4299 er én række

1 af 24.966 S3-entries mangler `binding_span` OG dag-rækker — samme række. `race_entries.binding_span` er nullable uden default og uden trigger, og `no_rider_double_booking_day` kan kun håndhæve for entries der *har* dag-rækker. To lag, samme hul.

---

# Designbriefen

Dette er sessionens tyngdepunkt. Læs den før du rører en `.jsx`.

## Det ene princip

> **Vis konflikten før klikket, ikke efter.**

Spilleren skal aldrig opdage et overlap ved at prøve. friisisch, 27/8: *"It is hard to understand the races overlapping ... So its needed to add riders to races to see if they overlap."* Og kalender-rebuilden **hævede overlap bevidst** (bobby2106, `#staff-chat` 26/8: *"Jeg hæver antallet af overlap"*). Uden synligt dagsspænd er planlægning ren trial-and-error.

I praksis: **grå og uklikbar med navngivet årsag** slår **klikbar plus advarsel bagefter**. Aldrig en toast der fortæller hvad der lige gik galt.

## Anti-AI-slop — det her er en hård gate

Fladen skal have vores eget feel og høj detaljetæthed. Forbudt: `rounded-2xl`, glows, gradient-blobs, emoji som ikoner, dekorative illustrationer, "friendly" mikrocopy. Foretrukket: editorial tæthed, ægte cykel-data, Bebas kun hvor spec'en siger det, hairlines, tabular figures, stroke-ikoner.

Guld er **rationeret**: én primær-knap pr. view, plus fører-markører. Konflikt er ikke guld. Fravær af signal er det roligste signal — tegn ikke et ikon for "alt er fint".

## Komponenterne — udgangspunkt, ikke hellig skrift

Angrib dem. De er skrevet for at give panelet noget at slå på.

### 1 · `RaceDaySpan` — dagsspændet på løbskortet (#4296)

Løbskortet viser i dag kun startdagen. Det skal vise **hele det spænd løbet binder rytteren i**, og hvilke løb det kolliderer med.

- Meta-linje: `text-3xs` uppercase `--text-3` "LØBSDAGE" + værdien i data-font tabular: `3–6`.
- Under den: en **4px mini-stribe** på sæsonens akse, hvor løbets egne løbsdage er fyldte segmenter. Ren geometri, ingen farve når der ikke er konflikt.
- **Konflikt-tilstand:** de segmenter der deles med et løb hvor holdet allerede har ryttere, får `--danger` hairline, og under striben står én `text-2xs`-linje: *"Deler dag 4-5 med Le Mur de Huy"* — med løbsnavnet som quiet action der hopper derhen.
- Afklar FØRST hvilken flade spilleren taler om. #4193 rettede én af dem 25/8, og ordet *"still"* tyder på at `/races`-kortet, dagsboardet og udtagelsen ikke siger det samme. **Alle tre skal enes.**

### 2 · `RiderDayStatus` — glyffen pr. rytter (#4259)

knud_r_flink: *"It takes quite a long time to figure out who has race planned and who doesnt, especially since so many of the names are the same."*

Tre tilstande, stroke-ikoner, samme kolonne hele vejen ned så øjet kan scanne **lodret**:

| Tilstand | Signal | Tooltip |
|---|---|---|
| Fri | **ingen glyf** | — |
| Kører løb denne løbsdag | stroke-ikon, `--text-3` | løbsnavn + løbsdag |
| Utilgængelig (skade / akademi / afmeldt) | samme plads, `--danger-t` | årsagen, i klar tekst |

Navnekollisionen er hele pointen — glyffen må aldrig hoppe vandret afhængigt af navnelængde.

### 3 · `SelectionCountBar` — erstatter blokeringen (#4295)

- `6 / 8 pladser` i tabular figures, hairline-meter under.
- Under fuldt hold er **`--text-3`, ikke rød.** Det er et valg, ikke en fejl.
- **Gem er aldrig disabled på grund af antal.** Kun manglende kaptajn og over-max blokerer — præcis som serveren.
- Kan holdet ikke fylde, står grunden som `text-2xs`: *"3 ryttere er bundet i Tour des Émirats"*, med ét-kliks-hop derhen.

### 4 · `ConflictPanel` — navngivet årsag + ét-kliks-fix

Deles af dagsboardet og Z1 — byg den én gang. Mønstret er taget fra spillerprototypen og er allerede ejer-godkendt i Z1-spec'ens §10:

> *"Lozano kører Tour des Émirats, som deler løbsdage med Le Mur de Huy"* → **"Fjern fra Tour des Émirats"**

Aldrig "denne rytter er ikke tilgængelig". Altid **hvem, hvilket løb, hvilke dage, og hvad du kan gøre**.

### 5 · Symmetriske kontroller

I dag er "Ryd dag / Ryd sæson" fremhævet, fordi assistenten var push. Nu hvor den er pull, skal parret være symmetrisk: **"Udfyld dag / Udfyld sæson"** skal stå lige så tilgængeligt. Det er ordret hvad knud_r_flink bad om: *"focus on auto-fill day or season for the players that dont care, rather than clear day and clear all for the players who actually do."*

### 6 · Mobil er ikke en efterbehandling

`#4165` (Planlægning fejler på mobil indtil hard-reload) skal fikses **først** — ellers kan mobil-designet ikke verificeres. Derefter 375px-tæthedstest mod `planner/MobileLanes.jsx`-mønstret (tap-mål ≥24px) **før** noget bygges færdigt.

## Gode funktioner til spillerne her og nu

Ud over fejlrettelserne. Alle bygger på noget der allerede findes — ingen af dem kræver ny data fra serveren.

1. **Sæson-stribe pr. rytter** i rytterlisten: 31 små segmenter der viser hvilke løbsdage rytteren allerede er booket. Gør "hvem er ledig i næste uge?" til ét blik i stedet for en udredning. `lib/seasonTimeline.js` har allerede matematikken (11 rene funktioner).
2. **"Kun problemer"-linsen — også på dagsboardet**, ikke kun i Z1. Det er den eneste linse der finder noget spilleren ikke vidste han skulle lede efter.
3. **Live problem-tæller i fodnoten**: *"Ingen problemer"* i grønt, ellers antallet. Konstant, uden at man skal filtrere.
4. **Ét-kliks-fix** overalt hvor vi i dag bare siger nej.
5. **Assistenten forklaret ét sted**, i klar tekst: hvornår den udfylder, hvad der stopper den, og at "Ryd" er den bevidste *"jeg møder op med færre"*. Hjælp (en+da) **og** én linje på boardet, så spilleren ikke skal lede.

## Verifikations-gaten for design

**UI/layout merges ALDRIG uden ejerens visuelle go.** Og vis undervejs, ikke til sidst:

- Preview-server tidligt, ELLER `show_widget`-mockup **før** du beder om feedback på en beslutning.
- Vedhæft **rigtige skærmbilleder** — ikke beskrivelser. Ejeren skal kunne se det uden at åbne noget.
- Kan noget ikke ses på preview (gated feature, manglende seed-data), så skriv eksplicit *"ikke synlig på preview fordi X"* i stedet for at lade det stå.
- Kør ALLE 3 playwright-projekter ved visuelle ændringer — CI fejler ellers på mobile.

---

# Sporene

**Bølge 1 = A + B + D, parallelt.** A og D skal være merged og live **før kl. 11**; B lander samme døgn. **Bølge 2 = C**, i samme session når bølge 1 er grøn.

## Spor A · Spærringerne i holdudtagelsen

- **A1 · #4295** — fjern `requireFull`-gaten. Delvis trup skal kunne gemmes, også første gang. `SelectionCountBar` erstatter blokeringen. Klient og server siger det samme.
- **A2 · #4299** — luk hullet i **begge** lag: (1) find skrive-stien der kunne skabe en entry uden `binding_span` og uden dag-rækker (spiller-initieret, `is_auto_filled=false`, 27/8 05:39 UTC), (2) læg et DB-backstop ind så tilstanden er **umulig**, ikke bare usandsynlig. Den ene prod-række repareres **kun med ejerens GO på netop det skridt**; migrationen applies efter merge under #2642-rammer (idempotent + post-verify).
- **A3 · #4201** — ratificér modellen, byg ingen ny mekanik: `PLANNING_CENTER_RULES.md` §4 fra "åben beslutning" til låst regel · Hjælp (en+da) · én linje på boardet · symmetriske kontroller (komponent 5). **Foreslå** at samle de tre auto-udfyld-indgange til én — byg det ikke uden go.

## Spor B · Overlap-læsbarhed (sessionens største designopgave)

- **B1 · #4296** — `RaceDaySpan` på alle tre flader, som ét enigt signal.
- **B2 · #4259** — `RiderDayStatus` i planlægnings- og udtagelseslisten.
- **B3 · #4245** — `backend/routes/api.js:4444` lægger **etapetal** i et felt der hedder `raceDays`, og chippen i `AvailableRidersPool` viser det som "N løbsdage". Tallet er tilfældigt rigtigt netop nu. **Forudsætning for belastnings-linsen.** Accept: et løb med to etaper på samme løbsdag giver 1, ikke 2 — med en test der ville have fanget forskellen.
- **B4 · #4165** — mobil-fejlen. Først, af hensyn til B1/B2's mobilverifikation.

## Spor D · Formplanen

Den anden ting spillerne planlægger med. Blokerende sammen med A.

- **D1 · #4294** — formplanen er ude af sync: ryttere låst i "no peak", andre fremstår allerede peaket før sæsonstart. To uafhængige rapporter på 14 timer. **Formodning der skal verificeres, ikke antages:** peak-vinduerne er stadig ankret til den gamle kalenders løbsdage. Ejeren lovede thelamba en fuld reset offentligt (26/8 15:00 UTC) — **indfri det eller træk det tilbage i `#the-roadbook`.** Efterlad det ikke tavst.
- **D2 · #4212** — peaks kan ikke fjernes; rytteren defaulter altid til 2.
- **D3 · #4293** — træning: "Skill raises this season" fejler efter D1+D2-slukningen af løbsdags-udviklingen (#4277/#4279). En slukket motor må ikke gøre en visning til en fejl.
- **D4 · #4271** — ejer-direktiv: formpeaks mere forståelige. Mindste ærlige version: spilleren kan se **hvad** et peak gør, **hvornår** det virker, og **hvad** det koster. Læsbarhed på den flade der findes, ikke en ny flade.

## Spor C · Z1-sæsonmatrixen (#1146) — bølge 2

Det spillerne ikke har bedt om, men vil mærke mest: **se hele sæsonen på én gang og ret 40 ting ad gangen.** Dagsboardet løser "planlæg denne dag". Gitteret skal løse "find problemet".

- **C1** · `PUT /api/races/selection/bulk` — **atomart**. Hele diffen i ét kald, eller ingenting. Genbrug enkelt-endpointets validering; ingen ny forretningslogik. Grunden: `marketWriteLimiter` tillader 30 skrivninger/60 sek (`backend/lib/rateLimiters.js:64`), og 40 celler ville fejle midt i spillerens arbejde.
- **C2** · `useSelectionDraft.js` — kladde, diff, dirty-flag, Gem plan. Unmount-guard som boardets `boardDirty` (UI-gæld fund 1). Matrixen viser **eksplicit** hvor mange ugemte ændringer der er; boardet gemmer stadig straks, og forskellen skal være synlig.
- **C3** · `SeasonMatrix.jsx` + `MatrixCell.jsx` + `CellLockPanel.jsx` (= `ConflictPanel`). Grå og uklikbar frem for advarsel bagefter.
- **C4** · Tre linser: udtagelser · **kun problemer** · belastning (efter B3). Fodnote som live problem-tæller.
- **C5** · `?view=`-parameteren. `SeasonView.jsx:202` sletter den i dag og sætter den aldrig (modsigelse 4).

**Byg IKKE:** kortstak, forslags-banner, auto-accept, Z2/Z3/Z4, rytter-inspektør, modstander-linse. Rute-match kun ved celle-åbning.

**Åbent punkt du selv lukker:** trupgrænserne pr. klasse står kun i kode (`raceAutopick.js:14` — GT 8, Monument+WT 7, ProSeries/Class 6, default 6-8) og er ikke skrevet ned. Verificér og skriv dem i SSOT'en før "kun problemer"-linsen bruger dem.

## Uden for scope — bevidst

#4278 · #4288 (balance/bånd) · #4270 (S4-kalender) · #4264 scouting · #4262 · #4297 · #4263 · #4177 · backlog-bølgerne · v4-flippet · #4265-#4269. Ikke glemt — de fylder bare ikke for spillerne lige nu. Rører du dem, siger du det eksplicit og begrunder hvorfor.

---

## Arbejdsregler

- **Verificér før du hævder.** Kode, runtime og issue-state — ikke labels. "Er afvigelsen tilsigtet?" Tjek git-log og merged PR'er før du kalder noget en regression.
- **Ét issue pr. PR**, branch + PR for feat/fix/refactor. `Refs #N`. PR-body efter `PULL_REQUEST_TEMPLATE` inkl. Brugerverifikation. `pwsh -File scripts/preflight-pr.ps1` FØR push.
- **Frontend/i18n:** build + warning-budget + i18n-keys + `node --test` i `frontend/` + **hele** `npm run test:e2e` (alle 3 projekter) + `npm run lint` (CI's eslint-gate kører ikke i verify-local). Orkestratoren ejer e2e-slottet — workers kører ikke fuld suite hver.
- **Workers:** commit pr. delfix, push hvert 30. minut. 45 minutters tavshed → status-krav.
- **Prod-mutationer:** ingen uden ejerens "GO" på netop det skridt. Migrationer applies af dig EFTER merge, aldrig som plan-step før.
- **Patch notes + Hjælp** ved enhver brugerrettet ændring — eller skriv hvorfor ikke. Player-facing copy: **EN først, DA under**, dansk med æøå, ingen em-dash, intet opfundet indhold.
- **Loop-guard:** 2 CI-fejl på samme symptom → stop og spørg.
- **Postmortem** i `.claude/learnings/<dato>-<slug>.md` ved hver bugfix.
- **Opfølgninger ejer du selv** — fund bliver til issue + egen worker i sessionen. Ingen chips til ejeren.

## Hvad "verdensklasse" betyder her

Spillerne åbner spillet fredag kl. 11 og opdager fem ting de ikke bad om:

1. De kan **se** hvilke løbsdage et løb spænder over — og hvilke løb det kolliderer med — før de klikker.
2. De kan **scanne** rytterlisten lodret og se hvem der allerede kører.
3. De kan **gemme den trup de vil have**, også en halv, uden at slås med systemet.
4. Når noget ikke kan lade sig gøre, får de **hvem, hvilket løb, hvilke dage — og en knap der løser det**.
5. De kan **planlægge hele sæsonen på ét gitter** og gemme det hele i ét klik.

Det er målestokken. Ikke antal lukkede issues.
