# Næste session — S3-blockers frem mod fredag 28/8 kl. 11

> Skrevet ved close-out 25/8 efter en workflow-session der diagnosticerede alle 11 blockers read-only og byggede et katalog over de sidste 7 dages bevidste ændringer. **Læs "Faldgruber" først** — den er ikke generisk, den er skrevet på baggrund af en konkret fejl jeg lavede i denne session.

---

## START HER — tre spørgsmål før du bygger noget

Ejeren har bedt om at få disse stillet i denne session. Stil dem **ét ad gangen**, med tal og kontekst inde i selve spørgsmålet, og med din anbefaling. Byg ikke på et gæt.

**1. Stage-mix.** Ejer-beslutningen 23/8 satte ITT 10 %, brosten 5 %, højbjerg 12 %, tolerance ±2 point. Målt mod prod 25/8 er højbjergs-målet brudt i **alle fire divisioner**: D1 7,7 % · D2 5,6 % · D3 9,7 % · D4 16,1 %. D2 ligger under halvdelen af målet, D4 langt over. Kalenderen blev genereret forfra 25/8 under #4218, og #4140's komposition fulgte ikke med.

> Gælder målet stadig for sæson 3, eller ophævede #4218 det? Gælder det → kompositionen skal køres om før fredag kl. 11. Ophævet → SSOT'en skal have en note om at S3 bevidst afviger.

**2. #4174 — hvor højt fyldes de inaktive trupper?** Prod-tal: D3 har 97 hold, hvoraf 75 ikke har været logget ind i 7 dage, og der er **nul AI-hold i D1–D3**. Kalenderen kræver op til 29 ryttere i D1 på løbsdag 21, 26 og 29.

**3. GT-etapeantal.** Ejeren 25/8: *"Det er meningen at gt'erne er 17-18 etaper lange. Vi bør nok lande på et fast tal i stedet, sådan det er mere ensartet."* I dag: Giro 18, Hexagone 17, Vuelta 17.

> Hvilket fast tal? Det ændrer ikke S3's kalender med mindre den skal regenereres; det låser reglen for S4 og frem. Husk at §3's regnestykke (*"6 dage × 4 etaper = 24 pladser. En GT på 21 etaper + 3 hviledage = 24"*) stadig hviler på 21 og skal regnes om.

---

## Hvor vi står

Sæson 3 starter **fredag 28/8 kl. 11**, udskudt fra tirsdag 25/8 (#4218) fordi holdudtagelsen ikke virkede. Kalenderen er genereret forfra: 28/8 → søn 27/9, 31 løbsdage, løb hver dag i alle fire divisioner, 531 løb. `stage_scheduler_enabled` og `auto_entry_generator_enabled` står **off** i prod. Alle spillere udtager forfra.

Rækkefølgen er ejer-låst og står i `docs/MASTERPLAN.md`. Rør ikke: v4 live-flip · #4203/#4209 · Planning Center P1–P3-resten · backlog-bølgerne.

## Faldgruber — læs disse før du konkluderer noget

**1. Tjek ALTID om en ændring er bevidst, før du kalder den en fejl.**
Jeg målte at D1's grand tours har 17-18 etaper, så `CALENDAR_RULES.md:115` siger *"GT'ens 21 er ejer-bekræftet"*, og rapporterede en regression. Forkert. Komprimeringen var besluttet 24/8 under #4176 og udført i PR #4121 (*"Giro 11 → 6 dage"*). SSOT'en var bare aldrig opdateret. Ejeren måtte rette mig.

Metoden der virker: `git log --oneline --since="<dato>"` + `gh pr list --state merged` + søg i `docs/MASTERPLAN.md`-historikken, **før** du skriver at noget er gået i stykker.

**2. SSOT'erne er 24 regler bagud.** 12 i kalenderen (#4176), 12 udenfor (#4254). En SSOT der er bagud er værre end ingen SSOT, fordi den læses som sandhed. Stol ikke på en SSOT-linje uden at krydstjekke mod koden og prod.

**3. Skil "målt af mig" fra "påstået af en agent" i hver eneste konklusion.** Fase 1-agenterne leverede solidt arbejde, men to af dem påstod at `league-size-invariant-audit` blokerer merge på `database/**`-PR'er. Den er ikke i branch protections required-liste — den bliver rød, men stopper ingenting. Havde jeg ikke tjekket, var byggerækkefølgen blevet forkert.

**4. Disse løsninger er allerede prøvet og afvist — foreslå dem ikke igen:**
- `game_day := (scheduled_at) − startdato`. Prøvet i #4155, brød TIER_OVERLAP_CAP i alle fire divisioner. Prøvet igen i #4158 23/8, afvist som fejlklasse. `CALENDAR_RULES.md` §0 advarer mod den med versaler.
- Monument-byttet (#4203/#4208): merged 24/8, rullet tilbage 5 timer senere i `b8f83d128` fordi det brød #4075. Direktivet *"monumenter hører ikke til under GT'er"* står stadig som gældende ejer-vilje, men kan ikke opfyldes i S3 — der er kun 6 D1-løbsdage uden for et GT-vindue, og der skal bruges fire.
- Fuld regenerering af kalenderen for at flytte den afsluttende mandag — afvist i #4133, erstattet af en minimal patch.

Der er i alt 17 rollbacks i de sidste 7 dage. Kataloget ligger i denne sessions workflow-journal; spørg hvis du skal bruge det.

## De 11 blockers — status efter fase 1

Alle 11 er stadig virkelige, men **otte har skiftet karakter**: symptomet i issue-teksten er lukket, og noget andet står tilbage. Citér aldrig issue-teksten som bevis; genmål.

| # | Hvad der FAKTISK står tilbage | Rodårsag |
|---|---|---|
| **4236** | **Roden.** Én løbsdag spænder op til 9 kalenderdage — D1 løbsdag 15 dækker 5/9, 10/9 og 13/9. Bindingen lyver, så felter ikke kan fyldes lovligt. D1 25/89, D3 21/47; D2/D4 rene. *Verificeret selv mod prod.* | `raceCalendarLanePacker.js:1005` — `real_day` udledes af slot-positionen, `game_day` bæres fra eventet; intet binder dem sammen |
| **4183 = 4233** | **Ét bug, to numre.** Trimmen vælger AI-hold i id-orden; har det første et transfertilbud, kaster hele oprydningen. D4-A står på 25 hold. | `aiTeamGenerator.js:403` |
| **4200** | Overskrivningen er lukket (#4222). Rest: delvise trupper toppes ikke op af nogen, og fladen lover ordret *"assistenten stiller resten når løbet køres. Ingen straf."* | `raceRunner.js:812` — springer hold med ≥1 entry over |
| **4174** | Genmålt: D2/D3/D4 rene efter regenereringen. D1 kræver stadig 29 ryttere på løbsdag 21, 26 og 29. | `calendarOverlapInvariant.js:44` — loftet tæller kørte dage, bindingen er spændet |
| **4217** | Selve bruddet er lukket. Rest: låse-guarden matcher kørte dage, ikke spændet → rå HTTP 500 i stedet for en forklaring. | `2026-08-24-4173-rider-binding-per-game-day.sql:440` |
| **4229** | Nedbruddet er lukket. Rest: fail-gaten tæller kun invarianter med præfiks `calendar_`, så `exactly_one_active_season` kan være brudt mens jobbet melder grønt. | `.github/workflows/calendar-invariant-audit.yml:222` |
| **4215** | Scorecardet kører, men måler 162 løb mod prods 168. | `calendarScorecard4218.mjs:70` |
| **4219** | Realisme-scorecardet genskaber ruterne in-memory og ser aldrig i basen → kan kun melde falsk grønt. | `raceRouteRealismScorecard.js:75` |
| **4123** | Invarianterne findes som kørbart gate med exit-kode; intet CI-job kalder dem. Diff-værktøjet er dødt på en hardkodet dato. | `calendarScorecard4218.mjs:254` |
| **4211** | 5 af 6 "brud" er fejl i audit-scriptet selv; ét er ægte og vokset fra 1 til 4 ryttere. | `verify-invariants.js:146` |

**#4123 er forudsætning, ikke oprydning.** `calendarDryRunLocal.mjs` og `calendarDiffDump.mjs` kaster begge på en hardkodet `2026-08-25`. Uden dem kan ingen se hvad en kalender-ændring flytter — og det var præcis dét, der udskød sæsonen.

## Afgjort af ejeren i denne session

**#4201 — assistenten:** sen udfyldning. Assistenten rører kun trupper der stadig står tomme **1 time** før løbet. Sweep-kadencen sættes fra 60 til **15 minutter**, fordi vinduet ellers er lige så langt som ét sweep-interval.

Vigtigt forbehold: i dag kører sweepen hele sæsonen igennem ved hvert tick (`raceEntryGeneratorSweep.js:28`, intet tidsfilter). Gøres den tids-bevidst, bliver 15-minutters-kadencen **billigere** end i dag. Mål det, før du bygger.

Bemærk også at udgangspunktet er **fuld opt-in**, ikke fuld auto-fill: `raceEntryGenerator.js:223` filtrerer på `!t.user_id`, så spillerhold røres slet ikke. Fixet genindfører altså bevidst udfyldning for menneskehold — snævert. Prod-tal: 75 af D3's 97 hold er inaktive i 7+ dage, og der er **nul AI-hold i D1–D3**.

## Afventer ejer-svar — spørg, byg ikke

1. **Stage-mix (#4103):** højbjergs-målet er brudt i alle fire divisioner (5,6–16,1 % mod 12 ±2). Gælder ejer-beslutningen fra 23/8 stadig for S3, eller ophævede #4218 den?
2. **#4174:** hvor højt fyldes de inaktive trupper?
3. **GT-etapeantal (#4176):** ejeren vil have ét fast tal i stedet for 18/17/17. Hvilket?

## PR'er klar til merge — foreslået rækkefølge

Rækkefølgen er bestemt af fil-overlap, ikke af fornemmelse.

1. **#4251** — security, CodeQL format string, 4 filer, alt grønt. Først fordi #4250 rører samme `backend/routes/api.js`.
2. **#4242** — preflight-advarsel ved push, 3 filer. Ingen overlap.
3. **#4237** — CI clock-drift-detektor, 4 filer. Ingen overlap.
4. **#4253** — branch-låsen (denne session). Ingen overlap.
5. **#4249** — forum-synlighed på dashboardet, 24 filer. **Kræver dit visuelle go.**
6. **#4250** — forum opbakning + citer-svar, 11 filer. **Kræver dit visuelle go.** Sidst, fordi den rører `api.js` efter #4251 og `patchNotes.js` efter #4249.

`audit`-checken på #4250 fejler, men **det er ikke PR'ens skyld** — jobbet kører mod prod og fejler på D4-A's 25 hold (#4183/#4233). Den er ikke en required check.

#3512 er draft og har konflikter; den hører til spor B, ikke fredags-sporet.

## Arbejdsregler for denne session

- **Branch-låsen** (PR #4253) låser hovedmappen til `main`. Arbejd i worktrees: `pwsh -File scripts/new-worktree.ps1 -Branch <navn> -FromBranch origin/main`.
- Commit kun bag `bash scripts/guard-commit-branch.sh <branch>` og med `git commit -F <fil>`.
- Ingen prod-mutation uden ejerens GO på netop dét skridt. Gen-tænding af `stage_scheduler_enabled` og `auto_entry_generator_enabled` er **ejerens kald alene**.
- Hard rule 30: ændrer du en regel, opdaterer du SSOT'en i **samme** PR.
- `docs/MASTERPLAN.md` ligger på 1.620 tokens mod budgettets 1.500. Der er ikke plads til mere ny information uden at noget gammelt tages ud — det er et ejer-valg.

## Foreslået start

Start med **#4236**. Den er roden, den er den eneste af de elleve der beskadiger selve sæsonen fra dag 1, og hver af de 31 løbsdage brænder problemet fast i resultater der ikke kan køres om. Men læs `CALENDAR_RULES.md` §0 og faldgrube 4 ovenfor først — den oplagte løsning er afvist to gange.

Overvej at tage **#4123** som allerførste skridt, så du kan se hvad #4236-fixet flytter, før du anvender det.
