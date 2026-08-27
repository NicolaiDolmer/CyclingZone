# Prompt: Sæsonstart — holdudtagelse og planlægning (master-session)

> Skrevet 27/8 2026 som handoff fra planlægnings-sessionen. Kopiér hele blokken under stregen ind som første besked i en frisk session.
> Forarbejde: de 20 spillerrettede issues fra 24.-27/8, `docs/PLANNING_CENTER_RULES.md`, `superpowers/specs/2026-08-25-planning-center-z1-saesonmatrix-design.md`, natsessions-rapporten `docs/audits/2026-08-28-natsession-rapport.md`.
> Verificeret i denne session (brug tallene, gæt ikke nye): #4295's rod-årsag · at #4201's model allerede står i koden · at Z1-aksen er fri.

---

Sæson 3 ruller **fredag 28/8 kl. 11**. Denne session har ét mål: **holdudtagelse og planlægning skal føles færdige når spillerne logger ind** — ikke "der er nogle bugs vi når senere".

De sidste fire dage har 20 spillerrettede issues ramt ind. Tre fjerdedele af dem handler om den samme ting: **manageren kan ikke se eller styre hvem der kører hvad hvornår.** Det er den flade spillet lever af. Vi bygger den færdig nu.

Ambition: overgå forventningerne. Ikke "lappet", men *bedre end før kalender-rebuilden*. Brug **workflows** til at parallelisere sporene. Stil spørgsmål ét ad gangen, med din egen anbefaling i selve spørgsmålet — ejeren svarer hellere på tyve skarpe spørgsmål end på ét færdigt gæt.

## Læs først — ellers genopfinder du noget der findes

1. `docs/PLANNING_CENTER_RULES.md` — **områdets SSOT.** Hard rule 30: citér den, og opdatér den i samme PR som ændringen. §6 lister komponenter der ALDRIG må bygges om. §7 er verificeret UI-gæld. §8 er de fem åbne modsigelser.
2. `docs/superpowers/specs/2026-08-25-planning-center-z1-saesonmatrix-design.md` — Z1-gitteret, ejer-låst 25/8. Fire beslutninger er allerede truffet dér (kladde-modellen, tre linser, ingen kortstak, akse-reglen).
3. `docs/superpowers/specs/2026-08-21-planning-center-fase2-design.md` — IA'en: fire zoom-niveauer, to skinner. Z2/Z3/Z4 er UDEN FOR scope her.
4. `docs/CALENDAR_RULES.md` §0 — de to akser. En løbsdag bor **inde i** én kalenderdag; `game_day` kan aldrig udledes af `scheduled_at`.
5. `docs/design/PAGE_TEMPLATES.md` — bindende. T1/T2/T3, én guld-primær pr. view, hairlines, 5px radius, tabular figures, stroke-ikoner, aldrig emoji.
6. `AGENTS.md` hard rules + `CLAUDE.md` PR-preflight. Frontend/i18n = fuld lokal e2e før push.

## Verificeret virkelighed — brug disse, gæt ikke nye

**#4295 er ikke en fejlet fix. Det er en regel der stadig står.**
`frontend/src/lib/raceSelectionLogic.js:73-79`:

```js
const required = size.max;
const kanFyldeTruppen = !Number.isFinite(availableCount) || availableCount >= required;
if (riderIds.length > required) errors.push("selection_wrong_size");
else if (requireFull && kanFyldeTruppen && riderIds.length !== required) errors.push("selection_wrong_size");
```

`requireFull` er `true` som default, og kalderen sætter `requireFull: !data.selection` — så en **førstegangs**-udtagelse blokeres stadig hvis holdet *kan* fylde. #4175 løsnede kun for hold der *ikke kan* fylde. Backenden (`backend/lib/raceSelection.js:25`) afviser KUN over feltstørrelsen. **Klienten er strengere end serveren uden at nogen har besluttet det.** knud_r_flink vil gemme 6 af 8 med vilje — fx for at spare ryttere til næste dags løb — og det må han ikke.

**#4201 er allerede bygget — den mangler kun at blive skrevet ned og vist.**
- `backend/lib/raceEntryGenerator.js:223` — `eligibleTeams = allTeams.filter(t => !t.is_frozen && !t.user_id)`. Den proaktive sweep rører **ikke** menneskehold. Kommentaren siger det: *"Assistenten er dermed pull, ikke push (#4201)."*
- `backend/lib/raceRunner.js:844` — løbs-tidens autofyld er den sene redning; den springer afmeldte OG ryddede hold over siden #4285 (merged 27/8 05:39).
- Målt i nat: af **24.724** S3-udtagelser ligger **24.615** på AI-hold og kun **109** på 3 menneskehold — alle spiller-initierede.

Modellen er altså **opt-in + sen redning**. Men `PLANNING_CENTER_RULES.md` §4 siger stadig "åben ejer-beslutning", og **intet i UI eller Hjælp fortæller spilleren det.** Der er stadig tre auto-udfyld-indgange (dagsboardet, `PlannerAssistantCard`, `/selection/auto`), og "Ryd" er den eneste måde at sige "jeg møder op med færre" — pr. løb, med bekræftelse.

**Z1-aksen er fri.** #4236 er lukket, og prod-målingen 27/8 kl. 02:10 viser **0 løbsdage over flere datoer**. Spec'ens §3 kan derfor lukkes på dato-udfaldet: **kolonnerne er 31 datoer**, ikke 89 løbsdage. Ingen vandret virtualisering nødvendig. Begge akser vises stadig — dato som ramme, løbsdags-striben som sandhed.

**Prod-hullet i #4299 er én række.** 1 af 24.966 S3-entries mangler `binding_span` OG dag-rækker — samme række. `race_entries.binding_span` er nullable uden default og uden trigger, og `no_rider_double_booking_day` kan kun håndhæve for entries der *har* dag-rækker. To lag med samme hul.

## Sporene

Kør dem parallelt. **Spor A og D skal være merged og live før kl. 11.** B og C må lande efter, men samme døgn.

### Spor A — spærringerne i holdudtagelsen (BLOKERENDE)

- **A1 · #4295** — fjern `requireFull`-gaten. En delvis trup skal kunne gemmes, også første gang, når holdet *kan* fylde. Erstat blokeringen med et **ikke-blokerende varsel** ("6 af 8 pladser besat"). Klient og server skal sige det samme. Hænger sammen med **#4174**: kalenderen kræver op til 29 ryttere, og kun 21 % af holdene kan stille fuldt hold — værst i D4 (2 af 46). Reglen tvinger dem til at møde op med nul.
- **A2 · #4299** — luk hullet i **begge** lag: (1) find skrive-stien der kunne skabe en entry uden `binding_span` og uden dag-rækker (spiller-initieret, `is_auto_filled=false`, 27/8 05:39 UTC), (2) læg et DB-backstop ind så tilstanden er umulig — ikke bare usandsynlig. Den ene prod-række repareres **kun med ejerens GO på netop det skridt**, og migrationen applies først efter merge (#2642-rammer: idempotent + post-verify).
- **A3 · #4201** — ratificér modellen, byg ingen ny mekanik. Konkret: opdatér `PLANNING_CENTER_RULES.md` §4 fra "åben beslutning" til den låste regel · skriv den i Hjælp (en+da) i klar tekst: *hvornår* assistenten udfylder, *hvad* der stopper den, og at "Ryd" er den bevidste "jeg møder op med færre" · én linje på dagsboardet der siger det samme uden at spilleren skal åbne Hjælp. Overvej at samle de tre auto-udfyld-indgange til én — men foreslå det, byg det ikke uden go.

### Spor D — formplanen (BLOKERENDE, samme klasse som A)

- **D1 · #4294** — formplanen er ude af sync med S3: ryttere låst i "no peak", andre fremstår allerede peaket før sæsonen er startet. To uafhængige rapporter på 14 timer. **Formodning der skal verificeres, ikke antages:** peak-vinduerne er stadig ankret til den gamle kalenders løbsdage. Ejeren har offentligt lovet thelamba en fuld reset før sæsonstart (26/8 15:00 UTC) — det tilsagn skal enten **indfries** eller **trækkes tilbage i `#the-roadbook`**. Vælg selv rækkefølgen, men efterlad det ikke tavst.
- **D2 · #4212** — peaks kan ikke fjernes; rytteren defaulter altid til 2. Samme spiller, 24/8.
- **D3 · #4293** — træning: "Skill raises this season" fejler efter D1+D2-slukningen af løbsdags-udviklingen (#4277/#4279). En slukket motor må ikke gøre en visning til en fejl.
- **D4 · #4271** — ejer-direktiv: formpeaks skal være mere forståelige. Mindste ærlige version: spilleren kan se **hvad** et peak gør, **hvornår** det virker, og **hvad** det koster. Ikke en ny flade — læsbarhed på den der findes.

### Spor B — gør overlap læsbart FØR spilleren prøver sig frem

friisisch, 27/8: *"It is hard to understand the races overlapping. It still only says the race day in which the races start ... So its needed to add riders to races to see if they overlap."* Kalender-rebuilden **hævede overlap bevidst**. Uden synligt dagsspænd bliver planlægning til trial-and-error.

- **B1 · #4296** — løbskortet viser hele løbsdags-spændet, ikke kun startdagen, og markerer hvilke løb det deler løbsdag med. Afklar først hvilken flade spilleren taler om (`/races`-kortet, dagsboardet eller udtagelsen) — #4193 rettede én af dem 25/8, og ordet "still" tyder på at de tre ikke siger det samme.
- **B2 · #4259** — ikon pr. rytter i planlægnings-/udtagelseslisten: "kører allerede løb denne løbsdag", med løbsnavn i tooltip. knud_r_flink: *"It takes quite a long time to figure out who has race planned and who doesnt, especially since so many of the names are the same."*
- **B3 · #4245** — `backend/routes/api.js:4444` lægger **etapetal** i et felt der hedder `raceDays`, og chippen i `AvailableRidersPool` viser det som "N løbsdage". Tallet er tilfældigt rigtigt netop nu. Det er en **forudsætning** for belastnings-linsen i spor C.
- **B4 · #4165** — Planlægning fejler på mobil indtil hard-reload; alle andre sider virker. Ez4prebren 23/8.

### Spor C — den nye funktion: Z1-sæsonmatrixen (#1146)

Dette er det spillerne ikke har bedt om men vil mærke mest: **se hele sæsonen på én gang og ret 40 ting ad gangen.** Dagsboardet løser "planlæg denne dag". Gitteret skal løse "find problemet".

Byg efter spec'en — de fire ejer-beslutninger er låst:

- **C1** · `PUT /api/races/selection/bulk` — **atomart**. Hele diffen i ét kald, eller ingenting. Delvis succes findes ikke. Genbrug enkelt-endpointets validering; ingen ny forretningslogik i bulk-vejen. Grunden er konkret: `marketWriteLimiter` tillader 30 skrivninger/60 sek (`backend/lib/rateLimiters.js:64`), og 40 celler ville fejle midt i spillerens arbejde.
- **C2** · `useSelectionDraft.js` — kladden: lokale ændringer, diff mod server, dirty-flag, Gem plan. Unmount-guard som boardets `boardDirty` (UI-gæld fund 1). Matrixen viser **eksplicit** at der er ugemte ændringer og hvor mange — boardet gemmer stadig straks, og forskellen skal være synlig.
- **C3** · `SeasonMatrix.jsx` + `MatrixCell.jsx` + `CellLockPanel.jsx`. Låsepanelet er det vigtigste: **navngivet årsag + ét-kliks-fix** — *"Lozano kører Tour des Émirats, som deler løbsdage med Le Mur de Huy" → "Fjern fra Tour des Émirats"*. Grå og uklikbar frem for en advarsel bagefter.
- **C4** · Tre linser: **udtagelser** · **kun problemer** · **belastning** (efter B3). "Kun problemer" er den eneste linse der finder noget spilleren ikke vidste han skulle lede efter — den regnes i browseren af udtagelser + klassegrænser + binding. Fodnote som live problem-tæller: "Ingen problemer" i grønt, ellers antal.
- **C5** · `?view=`-parameteren. `SeasonView.jsx:202` sletter den i dag og sætter den aldrig (modsigelse 4).

**Byg IKKE:** kortstak, forslags-banner, auto-accept, Z2/Z3/Z4, rytter-inspektøren, modstander-linsen. Rute-match kun ved celle-åbning.

**Åbent punkt du selv skal lukke:** trupgrænserne pr. klasse står kun i kode (`raceAutopick.js:14`) og er ikke skrevet ned. Verificér dem og skriv dem i SSOT'en før "kun problemer"-linsen bruger dem.

## Uden for scope — bevidst

#4278 og #4288 (balance/bånd) · #4270 (S4-kalender) · #4264 scouting · #4262 · #4297 · #4263 · #4177 · backlog-bølgerne · v4-flippet · #4265/#4268. De er ikke glemt; de fylder bare ikke for spillerne lige nu. Rører du dem, siger du det eksplicit og begrunder hvorfor.

## Sådan arbejder du

- **Verificér før du hævder.** Kode, runtime og issue-state — ikke labels. "Er afvigelsen tilsigtet?" Tjek git-log og merged PR'er før du kalder noget en regression.
- **Ét issue pr. PR, branch + PR for feat/fix/refactor.** `Refs #N`. PR-body efter `PULL_REQUEST_TEMPLATE` inkl. Brugerverifikation-sektionen. `pwsh -File scripts/preflight-pr.ps1` FØR push.
- **Frontend/i18n:** build + warning-budget + i18n-keys + `node --test` i `frontend/` + **hele** `npm run test:e2e` (alle 3 playwright-projekter). `npm run lint` før frontend-push — CI's eslint-gate kører ikke i verify-local.
- **UI/layout merges ALDRIG uden ejerens visuelle go.** Vis skærmbilleder eller preview undervejs, ikke "test selv til sidst".
- **Prod-mutationer:** ingen uden ejerens "GO" på netop det skridt. Migrationer applies af dig selv EFTER merge (idempotent + post-verify), aldrig som plan-step før.
- **Patch notes + Hjælp** ved enhver brugerrettet ændring — eller skriv hvorfor ikke. Player-facing copy: **EN først, DA under**, dansk med æøå, ingen em-dash, ingen opfundet indhold.
- **Loop-guard:** 2 CI-fejl på samme symptom → stop og spørg.
- **Postmortem** i `.claude/learnings/<dato>-<slug>.md` ved hver bugfix.

## Hvad "overgår forventningerne" betyder her

Spillerne åbner spillet fredag kl. 11 og opdager tre ting de ikke bad om:

1. De kan **se** hvilke løbsdage et løb spænder over, og hvilke ryttere der allerede er optaget — før de klikker.
2. De kan **gemme den trup de vil have**, også en halv, uden at slås med systemet.
3. De kan **planlægge hele sæsonen på ét gitter** og gemme det hele i ét klik.

Det er målestokken. Ikke antal lukkede issues.
