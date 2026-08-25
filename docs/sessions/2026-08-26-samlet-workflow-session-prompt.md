# Samlet session — S3-blockers frem mod fredag 28/8 kl. 11 + forum-sporet

> Sammensmeltning af to parallelle sessioner fra 25/8: **S3-blocker-diagnosen** (11 blockers gennemgået read-only, katalog over 7 dages bevidste ændringer) og **forum-løftet** (kildeindsamling fra fire kilder, L1 merged, to PR'er åbne).
>
> **Læs "Fælles faldgruber" før du konkluderer noget.** Den er ikke generisk. Hvert punkt koster os allerede tid i dag, i én af de to sessioner.

---

## 0 · Tre spørgsmål før du bygger — stil dem ét ad gangen

Ejeren har bedt om at få dem stillet. Læg tal og kontekst **inde i selve spørgsmålet** — han ser ikke altid prosaen før et beslutningskort — og giv din anbefaling. Byg ikke på et gæt.

**1 · Stage-mix (#4103).** Ejer-beslutningen 23/8: ITT 10 %, brosten 5 %, højbjerg 12 %, tolerance ±2 point. Målt mod prod 25/8 er højbjergs-målet brudt i alle fire divisioner: **D1 7,7 % · D2 5,6 % · D3 9,7 % · D4 16,1 %**. Kalenderen blev genereret forfra 25/8 under #4218, og #4140's komposition fulgte ikke med.
> Gælder målet stadig for S3, eller ophævede #4218 det? Gælder det → kompositionen skal køres om før fredag kl. 11. Ophævet → SSOT'en skal have en note om, at S3 bevidst afviger.

**2 · #4174 — hvor højt fyldes de inaktive trupper?** D3 har 97 hold, hvoraf **75 ikke har været logget ind i 7 dage**, og der er **nul AI-hold i D1–D3**. Kalenderen kræver op til 29 ryttere i D1 på løbsdag 21, 26 og 29.

**3 · GT-etapeantal (#4176).** Ejeren 25/8: *"Det er meningen at gt'erne er 17-18 etaper lange. Vi bør nok lande på et fast tal i stedet, sådan det er mere ensartet."* I dag: Giro 18, Hexagone 17, Vuelta 17.
> Hvilket fast tal? Det ændrer ikke S3 medmindre kalenderen regenereres; det låser reglen for S4 og frem. `CALENDAR_RULES.md` §3's regnestykke (*"6 dage × 4 etaper = 24 pladser. En GT på 21 etaper + 3 hviledage = 24"*) hviler stadig på 21 og skal regnes om.

Forum-sporet har ingen blokerende spørgsmål — dets ene åbne beslutning aflæses **15/9** (#4235), ikke nu.

---

## 1 · Hvor vi står

**Sæson 3 starter fredag 28/8 kl. 11**, udskudt fra 25/8 (#4218) fordi holdudtagelsen ikke virkede. Kalenderen er genereret forfra: 28/8 → søn 27/9, 31 løbsdage, løb hver dag i alle fire divisioner, 531 løb. `stage_scheduler_enabled` og `auto_entry_generator_enabled` står **off** i prod. Alle spillere udtager forfra.

**Forummet:** L1 "puls" er merged og live (#4238, patch v7.192) — aktivitets-sortering, ulæst pr. tråd + gul prik i nav, svar-notifikation med dedupe, påkrævet rapport-begrundelse. Begge migrationer kørt i prod med post-verify. To PR'er venter på ejerens visuelle go.

Rækkefølgen er ejer-låst i `docs/MASTERPLAN.md`. **Rør ikke:** v4 live-flip · #4203/#4209 · Planning Center P1–P3-resten · backlog-bølgerne.

---

## 2 · Fælles faldgruber — begge sessioner blev bidt

**Det gennemgående mønster: en påstand føles som evidens.** Begge sessioner tabte tid på præcis dét, i hver sin form.

**1 · Tjek ALTID om en ændring er bevidst, før du kalder den en fejl.** S3-sessionen målte at D1's grand tours har 17-18 etaper, så `CALENDAR_RULES.md:115` siger *"GT'ens 21 er ejer-bekræftet"* — og rapporterede en regression. Forkert: komprimeringen var besluttet 24/8 under #4176 og udført i PR #4121. SSOT'en var bare aldrig opdateret. Ejeren måtte rette den.
> Metoden der virker: `git log --oneline --since="<dato>"` + `gh pr list --state merged` + søg i `MASTERPLAN.md`-historikken, **før** du skriver at noget er gået i stykker.

**2 · SSOT'erne er 24 regler bagud.** 12 i kalenderen (#4176), 12 udenfor (#4254). En SSOT der er bagud er værre end ingen SSOT, fordi den læses som sandhed. Krydstjek mod kode og prod.

**3 · Skil "målt af mig" fra "påstået af en agent" i hver eneste konklusion.** To fase-1-agenter påstod at `league-size-invariant-audit` blokerer merge på `database/**`-PR'er. Den er ikke i required-listen — den bliver rød, men stopper ingenting. Havde ingen tjekket, var byggerækkefølgen blevet forkert.

**4 · Grøn verifikation beviser kun det, verifikationen måler.** Forum-sessionen meldte #4238 færdig med fem grønne kommandoer — 7.149 backend-tests, 2.342 frontend-tests, 561 e2e, lint, preflight. Alle sande. Alle blinde for en `TypeError`, der kastede ved **hver eneste mount** for hver spiller (#4244, 17 ramt), fordi **ingen test lytter på `pageerror`** (#4248). En CodeQL-taint slap igennem samme PR (#4251).
> Tilføjer opgaven effekt-kode — abonnement, interval, timer — så navngiv den test der ville fange, at effekten kaster. Findes den ikke, er den en del af opgaven.

**5 · Kun ÉN worker må have `FULL` e2e-verifikation ad gangen.** Suiten tager ~23 min; to samtidige sulter hinanden på samme maskine. Reglen fandtes allerede og blev brudt alligevel, fordi spawn-prompten blev skrevet uden at slå den op. Tjeklisten er nu mekanisk: **"Fire spørgsmål FØR spawn"** i `docs/PARALLEL_WORKTREE_ORCHESTRATION.md`.

**6 · Giv workers eksplicit ret til at committe rod.** En worker stod 66 minutter med **190 linjers færdigt arbejde ucommitted**, fordi den ventede på at være "færdig nok" til en pæn commit. Skriv ordret i prompten: *"også ufærdigt arbejde — en `wip(...)`-commit er uendeligt meget bedre end ucommitted arbejde."*
> `pwsh -File scripts/worker-status.ps1` viser alle worktrees med minutter siden sidste commit, **antal ucommitted filer**, upushede commits og åben PR. UCOMMIT-kolonnen er den tilstand, en tavs worker aldrig selv rapporterer.

**7 · Disse løsninger er prøvet og afvist — foreslå dem ikke igen:**
- `game_day := (scheduled_at) − startdato`. Prøvet i #4155, brød TIER_OVERLAP_CAP i alle fire divisioner. Prøvet igen i #4158 23/8, afvist som fejlklasse. `CALENDAR_RULES.md` §0 advarer med versaler.
- Monument-byttet (#4203/#4208): merged 24/8, rullet tilbage 5 timer senere i `b8f83d128` fordi det brød #4075. Direktivet *"monumenter hører ikke til under GT'er"* står stadig som ejer-vilje, men kan ikke opfyldes i S3 — der er kun 6 D1-løbsdage uden for et GT-vindue, og der skal bruges fire.
- Fuld regenerering af kalenderen for at flytte den afsluttende mandag — afvist i #4133, erstattet af en minimal patch.
- **Nye dashboard-moduler i fuld bredde.** Der ER et to-kolonne-grid (`DashboardPage.jsx:1261`). Fuld bredde kræver en grund der kan skrives ned. Se `docs/DASHBOARD_RULES.md`.

Der er **17 rollbacks** i de sidste 7 dage. Kataloget ligger i S3-sessionens workflow-journal.

---

## 3 · De 11 S3-blockers — status efter fase 1

Alle 11 er stadig virkelige, men **otte har skiftet karakter**: symptomet i issue-teksten er lukket, og noget andet står tilbage. **Citér aldrig issue-teksten som bevis; genmål.**

| # | Hvad der FAKTISK står tilbage | Rodårsag |
|---|---|---|
| **4236** | **Roden.** Én løbsdag spænder op til 9 kalenderdage — D1 løbsdag 15 dækker 5/9, 10/9 og 13/9. Bindingen lyver, så felter ikke kan fyldes lovligt. D1 25/89, D3 21/47; D2/D4 rene. *Verificeret direkte mod prod.* | `raceCalendarLanePacker.js:1005` — `real_day` udledes af slot-positionen, `game_day` bæres fra eventet; intet binder dem |
| **4183 = 4233** | **Ét bug, to numre.** Trimmen vælger AI-hold i id-orden; har det første et transfertilbud, kaster hele oprydningen. D4-A står på 25 hold | `aiTeamGenerator.js:403` |
| **4200** | Overskrivningen er lukket (#4222). Rest: delvise trupper toppes ikke op af nogen, og fladen lover ordret *"assistenten stiller resten når løbet køres. Ingen straf."* | `raceRunner.js:812` — springer hold med ≥1 entry over |
| **4174** | Genmålt: D2/D3/D4 rene efter regenereringen. D1 kræver stadig 29 ryttere på løbsdag 21, 26 og 29 | `calendarOverlapInvariant.js:44` — loftet tæller kørte dage, bindingen er spændet |
| **4217** | Selve bruddet er lukket. Rest: låse-guarden matcher kørte dage, ikke spændet → rå HTTP 500 i stedet for en forklaring | `2026-08-24-4173-rider-binding-per-game-day.sql:440` |
| **4229** | Nedbruddet er lukket. Rest: fail-gaten tæller kun invarianter med præfiks `calendar_`, så `exactly_one_active_season` kan være brudt mens jobbet melder grønt | `.github/workflows/calendar-invariant-audit.yml:222` |
| **4215** | Scorecardet kører, men måler 162 løb mod prods 168 | `calendarScorecard4218.mjs:70` |
| **4219** | Realisme-scorecardet genskaber ruterne in-memory og ser aldrig i basen → kan kun melde falsk grønt | `raceRouteRealismScorecard.js:75` |
| **4123** | Invarianterne findes som kørbart gate med exit-kode; **intet CI-job kalder dem.** Diff-værktøjet er dødt på en hardkodet dato | `calendarScorecard4218.mjs:254` |
| **4211** | 5 af 6 "brud" er fejl i audit-scriptet selv; ét er ægte og vokset fra 1 til 4 ryttere | `verify-invariants.js:146` |

**#4123 er forudsætning, ikke oprydning.** `calendarDryRunLocal.mjs` og `calendarDiffDump.mjs` kaster begge på en hardkodet `2026-08-25`. Uden dem kan ingen se hvad en kalender-ændring flytter — og det var præcis dét, der udskød sæsonen.

**Afgjort i sessionen — #4201, assistenten:** sen udfyldning. Assistenten rører kun trupper der stadig står tomme **1 time** før løbet; sweep-kadencen fra 60 til **15 minutter**, fordi vinduet ellers er lige så langt som ét sweep-interval.
> Forbehold: i dag kører sweepen hele sæsonen igennem ved hvert tick (`raceEntryGeneratorSweep.js:28`, intet tidsfilter). Gøres den tids-bevidst, bliver 15-minutters-kadencen **billigere** end i dag. Mål det, før du bygger. Udgangspunktet er **fuld opt-in**, ikke fuld auto-fill: `raceEntryGenerator.js:223` filtrerer på `!t.user_id`, så spillerhold røres slet ikke i dag. Fixet genindfører bevidst udfyldning for menneskehold — snævert.

---

## 4 · Forum- og dashboard-sporet

**Merged og live:** #4238 (L1 puls). To regressioner fulgte med og blev fikset samme dag — #4244/#4247 (realtime) og #4251 (CodeQL). Begge er beskrevet i `docs/FEATURE_STATUS.md`.

**Åbne PR'er:** #4249 (dashboard-kort + layout-omlægning) og #4250 (opbakning + citér-svar). Begge kræver ejerens visuelle godkendelse.

**Efter #4250 er merged:** kør `database/2026-08-25-3517-forum-reactions.sql` (idempotent, post-verify som ved #4238), og **fjern derefter `schema-columns-ok`-kommentaren** i `backend/lib/forum.js` samt opdatér `database/schema-snapshot.json`. Undtagelsen findes kun, fordi `quoted_reply_id` ikke er i prod endnu.

**Åbne opgaver, prioriteret:**
1. **#4252** — holdnavnet i sidebaren har **470 døde klik mod 123 virksomme** på 7 dage; det mest fejlklikkede element i appen. Få linjers fix, største enkeltstående friktion på fladen.
2. **#4248** — `pageerror`-guard i Playwright. Ville have fanget #4244 før merge. Start i rapporterende tilstand, allowlist bevidst.
3. **#4255** — forum-mock-data findes to steder (preview-mock og e2e-fixture) og kan drive fra hinanden. Vigtigst er punkt 3 i issuet: en test der fejler når de to lag svarer forskelligt. Uden den driver de fra hinanden igen.
4. **#4235** — måleaflæsning **15/9**, før sæsonen slutter 27/9. Baseline og tærskler ligger i issuet.
5. **#3451** — forum-søgning, bevidst udskudt til efter #4235: med 12 tråde er der ikke noget at søge i.

**SSOT:** `docs/FORUM_RULES.md` og `docs/DASHBOARD_RULES.md` er nye (25/8). Læs dem før du rører forummet eller flytter noget på dashboardet.

---

## 5 · PR'er klar til merge — verificeret rækkefølge

Rækkefølgen er bestemt af **fil-overlap**, ikke fornemmelse.

| Rækkefølge | PR | Hvorfor her |
|---|---|---|
| 1 | **#4251** | Security, CodeQL format string, 4 filer. Først fordi #4250 rører samme `backend/routes/api.js` |
| 2 | **#4242** | Preflight-advarsel ved push, 3 filer. Intet overlap |
| 3 | **#4237** | CI clock-drift-detektor, 4 filer. Intet overlap |
| 4 | **#4253** | Branch-lås af hoved-checkoutet. Intet overlap. *(Branchen hedder `chore/4252-…`, men issuet er #4016 — navnet er tastet forkert, harmløst)* |
| 5 | **#4249** | Forum-synlighed, 24 filer. **Kræver ejerens visuelle go** |
| 6 | **#4250** | Forum opbakning + citér, 11 filer. **Kræver ejerens visuelle go.** Sidst: rører `api.js` efter #4251 og `patchNotes.js` efter #4249 |

`audit`-checken på #4250 fejler, men **det er ikke PR'ens skyld** — jobbet kører mod prod og fejler på D4-A's 25 hold (#4183/#4233). Den er ikke en required check.

#3512 er draft med konflikter; den hører til spor B, ikke fredags-sporet.

---

## 6 · Foreslået workflow-struktur

Fasedelt, fordi afhængighederne er reelle. **Kun én agent må have `FULL` e2e ad gangen** — orkestratoren ejer det slot.

**Fase 0 · Ejer-spørgsmål (blokerende, ikke parallelt).** De tre spørgsmål i §0. Stil dem ét ad gangen. Byg intet kalender-relateret før svar 1 og 3 foreligger.

**Fase 1 · Måleværktøjet først (#4123).** Sekventiel, ingen fan-out. Uden `calendarDryRunLocal.mjs` og `calendarDiffDump.mjs` kan ingen se, hvad et #4236-fix flytter. Tag den som allerførste kodeskridt.

**Fase 2 · Roden (#4236).** Sekventiel, høj risiko, én agent med fuld opmærksomhed. Læs `CALENDAR_RULES.md` §0 og faldgrube 7 først — den oplagte løsning er afvist to gange. Verificér med fase 1-værktøjet før og efter.

**Fase 3 · Parallelt, uafhængige fixes.** Fan-out er forsvarlig her, fordi filerne ikke overlapper: #4183/#4233 (`aiTeamGenerator.js`) · #4200 (`raceRunner.js`) · #4229 (workflow-yaml) · #4215 + #4219 (scorecards) · #4211 (audit-script). Giv hver agent `TARGETED` verifikation; orkestratoren kører den fulde suite én gang til sidst.

**Fase 4 · Forum-sporet.** Uafhængigt af 1-3 og kan køre parallelt: merge-kæden i §5, migrationen efter #4250, derefter #4252 og #4248.

**Fase 5 · SSOT + verifikation.** Hard rule 30: hver regel-ændring opdaterer sin SSOT i **samme** PR. De 24 efterslæbende regler (#4176, #4254) lukkes her, ikke undervejs.

**Adversarisk krav gennem alle faser:** enhver agent-påstand om prod-tilstand, CI-gates eller branch protections skal verificeres af orkestratoren med et selvstændigt kald, før den bruges til at træffe en beslutning. Begge sessioner blev bidt af det modsatte.

---

## 7 · Arbejdsregler

- **Branch-låsen (#4253)** låser hoved-checkoutet til `main`. Arbejd i worktrees: `pwsh -File scripts/new-worktree.ps1 -Branch <navn> -FromBranch origin/main`.
- Commit kun bag `bash scripts/guard-commit-branch.sh <branch>`, og altid med `git commit -F <fil>` — aldrig heredoc.
- **Ingen prod-mutation uden ejerens GO på netop dét skridt.** Gen-tænding af `stage_scheduler_enabled` og `auto_entry_generator_enabled` er **ejerens kald alene**.
- Migrationer skrives i PR'en, men køres først **efter merge**, idempotent og med post-verify.
- UI-PR'er merges aldrig uden ejerens visuelle godkendelse. Vis skærmbilleder eller en mockup **før** du beder om en beslutning.
- Hard rule 30: ændrer du en regel, opdaterer du SSOT'en i samme PR.
- `docs/MASTERPLAN.md` ligger på **1.620 tokens mod budgettets 1.500**. Der er ikke plads til ny information uden at noget gammelt tages ud — det er et ejer-valg, ikke et frit valg.
- `MEMORY.md` ligger på 3.164 tokens mod fail-grænsen 3.200. Næste tilføjelse vælter den; demotér til `MEMORY_REFERENCE.md` først.

---

## 8 · Løs ende ved close-out

Worktreet `fix/4x-forum-realtime-return` stod ved sessionens slutning med **13 ucommitted filer og ~2,5 time uden commit**. PR #4247 derfra er allerede merged, så det er nyt, usikret arbejde. Red det med en `wip`-commit, før nogen rydder op i worktrees.

---

## 9 · Foreslået start

**#4123 → #4236.** Måleværktøjet først, så roden. #4236 er den eneste af de elleve, der beskadiger selve sæsonen fra dag 1, og hver af de 31 løbsdage brænder problemet fast i resultater, der ikke kan køres om.

Forum-sporet kan køre parallelt fra start — det deler ingen filer med kalender-sporet.
