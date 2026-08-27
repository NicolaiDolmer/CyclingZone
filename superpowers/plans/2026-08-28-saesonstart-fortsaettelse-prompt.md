# Prompt: sæsonstart, anden halvleg

> Handoff fra master-sessionen 27/8. Alt herunder er **målt eller læst samme dag**, ikke husket.
> Forgængeren: `2026-08-28-saesonstart-planlaegning-master-session-prompt.md`. Den havde fem faktafejl.
> De er rettet nedenfor. Stol på dette dokument, ikke på den.

Sæson 3 ruller **fredag 28/8 kl. 11**. Målet er uændret: holdudtagelse og planlægning skal føles færdige,
og bedre end før kalender-rebuilden, når spillerne logger ind.

---

## 1. Start med spillerne, ikke med koden

**Ejer-krav 27/8.** Før du rører en PR, gør du dette:

**1a. Læs de sidste 24 timer i Discord.** MCP-værktøjerne `discord_read_messages` og
`discord_get_forum_channels` er den direkte vej; `scripts/discord/` har read-only sweep-scripts hvis du skal
have flere kanaler på én gang. Kanalerne der betyder noget: `#feedback-and-ideas`, `#the-roadbook`,
`#staff-chat`, `#dansk-snak`. Læs også forum-tråde i appen hvis noget peger derhen.

**1b. Foreslå hvad ejeren skal svare på.** Én liste, prioriteret, med et konkret udkast pr. punkt.
**Du sender aldrig selv.** Udkast til copy-paste, ejeren poster. Tjek FØRST om han allerede har svaret,
så du ikke foreslår noget der er overstået. EN først, DA under, æøå, ingen em-dash.

**1c. Skriv patch notes til Discord for det der ER blevet færdigt**, så Discord-patch-noterne er ajour.
De skal skrives til spillere, ikke til udviklere: hvad var galt, hvad sker der nu, hvad skal du selv gøre.
Kort. Ejer-direktiv 13/8: markant kortere og lettere at læse end vi plejer.

Råmaterialet fra 27/8, alt merged og live:

| Version | Issue | Hvad spilleren mærker |
|---|---|---|
| 7.204 | #4293 | Træningssiden viste +0 på hver evne før sæsonen var begyndt. Den forklarer nu hvorfor og hvornår tællingen starter |
| 7.205 | #4245 | Belastnings-tallet talte etaper og gamle sæsoner med. Snittet viste 18,1 hvor det sande var 4,9. Sponsor-teksten siger nu etape, ikke løbsdag. Ingen penge flyttet |
| 7.206 | #4294 | Alle formpeaks fra den gamle kalender er ryddet. 812 planer der viste No peak uden at kunne fjernes. Peaks sat efter ombygningen er urørte |
| 7.207 | #4165 | Planlægning blev helt blank når et kald fejlede. Siger nu hvad der gik galt, at intet er tabt, og har en Prøv igen-knap |

**1d. Skriv hvad der er på tegnebrættet i dag og i morgen**, så spillerne ved hvad de kan forvente.
Kun det spiller-vendte, og kun det du faktisk tror lander. Kandidater: #4296 (se hvilke løbsdage et løb
spænder over, og hvilke løb det kolliderer med, før du klikker) · #4259 (se på ét blik hvem der allerede
kører) · #4295 (minimum 6 for at stille op) · #4306 (afmeldte hold stiller ikke op) · #4307 (opfyldning
af tynde trupper).

> **ADVARSEL om minimum-6-udkastet.** [`docs/drafts/2026-08-27-minimum-6-ryttere-varsel.md`](../../docs/drafts/2026-08-27-minimum-6-ryttere-varsel.md)
> siger "Fra i morgen" og "From tomorrow's start". **Reglen er holdt tilbage** (se afsnit 3), så udkastet er
> forkert som det står. Ret datoen eller hold det tilbage, men post det ikke uændret.

**1e. Opret det der mangler i GitHub.** Kommer der noget frem i Discord som ikke har et issue, så opret det
med det samme, med spillerens ordrette citat og et link til beskeden. Søg efter dubletter først.

---

## 2. PR-tilstand

```bash
gh pr list --state open --json number,title,mergeStateStatus
pwsh -File scripts/check-agent-token-hygiene.ps1
```

Fire PR'er var i luften ved handoff. **Verificér deres tilstand før du rører dem**. Flere kan være merged,
og to var i konflikt fordi #4302 landede først.

| PR | Issue | Tilstand ved handoff | Næste skridt |
|---|---|---|---|
| #4300 | #4245 | **MERGED** 27/8 | Færdig, issue markeret done |
| #4302 | #4293 | **MERGED** 27/8 | Færdig, issue markeret done |
| [#4303](https://github.com/NicolaiDolmer/CyclingZone/pull/4303) | #4165 | Syv fund rettet, seks verificeret lukket, CI grøn | Merge når CI er grøn efter sidste flet |
| [#4304](https://github.com/NicolaiDolmer/CyclingZone/pull/4304) | #4294 | Rettet, main flettet ind | Bump patch note til 7.207, merge, **apply migration** |
| [#4301](https://github.com/NicolaiDolmer/CyclingZone/pull/4301) | #4295 | **HOLDT TILBAGE med vilje** | Se afsnit 2b |

**Konflikterne er altid `frontend/src/data/patchNotes.js`.** Løsningen er hver gang: behold **begge**
versioner, løft din egen over mains top. Kast aldrig den ene væk. Ved flere commits der rører filen: brug
`git merge origin/main`, ikke rebase, så konflikten kun skal løses én gang.

---

## 3. #4301 er holdt tilbage. Læs dette før du merger den

Minimum-6-gulvet er bygget og teknisk færdigt, men den må **ikke** merges som den står. To grunde:

**1. Et blokerende fund.** `partialSquadOutlook` returnerer `null` ved `selected === 0`
(`frontend/src/lib/raceSelectionLogic.js:112`), på antagelsen om at assistenten så fylder en hel trup.
Under gulvet gør den ikke det: den skriver intet hvis den ikke kan nå 6. Målt: **195 af 226 menneskehold
har nul udtagelser lige nu**, og 128 af de 130 tabte starter rammer hold i præcis den tilstand. Reglen tager
altså et løb fra 128 hold uden ét ord på nogen flade. Det skal fikses uanset hvad.

**2. Grundlaget flyttede sig.** Ejeren traf beslutningen ud fra "21 menneskehold kan ikke fylde 6". Målt mod
prod ved at simulere åbningsdagen løb for løb: **130 starter forsvinder, fordelt på 129 menneskehold**.
Årsagen er at der kører tre løb samtidig i D1 til D3, så et hold skal stille 18 ryttere, eller 22 i D1.
D3's medianhold har 9 raske. D3 alene mister 74 starter. Felter kollapser: Rund um Köln Neu 19 til 5.

**Og trup-opfyldningen er ikke kørt siden 24. juni** (se #4307): 105 hold ligger under 12 ryttere, og en
kørsel ville oprette 422 ryttere. Ejerens ord 27/8: *"De hold der er inaktive har vi jo aftalt, at disse hold
skal have en opfyldning af ryttere i dag. Hvis der er aktive hold der ikke har nok ryttere, så er det jo
deres eget valg."* Gulvets konsekvens afhænger direkte af den opfyldning.

**Rækkefølgen er derfor:** afklar aktivitets-definitionen med ejeren, vis ham listen, kør opfyldningen med
hans GO, **mål simuleringen igen**, og forelæg ham så det rigtige tal før #4301 merges.

Løs ende i #4303 der ikke blev fikset: retry-knappen er inert på auth-grenen i Formplan-fanen
(`usePlanner.js:44`, `refresh()` sætter aldrig `setLoading(true)`). Den blev IKKE rettet, fordi `refresh()`
også er efter-mutation-genhentningen, så et `setLoading(true)` dér giver et spinner-blink hver gang man
gemmer. Den rigtige rettelse er en separat retry-funktion. `SeasonView` har samme mønster rettet korrekt
(`SeasonView.jsx:111`) og kan bruges som skabelon.

## 4. Beslutninger ejeren traf 27/8. Genåbn dem ikke

| # | Beslutning | Konsekvens |
|---|---|---|
| 1 | **Slet de 812 forældreløse peak-planer** | Udført. Backup `backup_4294_rider_peak_plans`. Post-verify: 82 tilbage, alle med gyldigt målløb |
| 2 | **Løbsdage vises 1-baseret** | `RACE_DAY_DISPLAY_OFFSET` i `raceHubLogic.js`. UI siger N+1, databasen siger N. Prisen er accepteret |
| 3 | **Et afmeldt hold stiller IKKE op** | Filtrér `race_withdrawals` i `loadEntrantsForRace`. Ejer-tilføjelse: fladen skal sige at man **frivilligt** ikke stiller op |
| 4 | **"Løbsdag" = bindings-enheden** | Sponsor-økonomien hedder nu "etape" i al copy. Ingen økonomi flyttet, kun ord |
| 5 | **Minimum 6 ryttere for at stille op. Fladt, ingen undtagelse** | Blødt gulv: Gem er aldrig blokeret, men under 6 starter holdet ikke. Sen redning fylder op til 6 |

**Om beslutning 5:** ejeren fik forelagt at **21 menneskehold** (14 i D3, 7 i D4) har færre end 6 raske
ryttere og derfor ikke kan starte et eneste løb, og valgte det flade gulv alligevel. Byg det som besluttet.
Foreslå ikke en undtagelse. Varslet til spillerne ligger klar i
[`docs/drafts/2026-08-27-minimum-6-ryttere-varsel.md`](../../docs/drafts/2026-08-27-minimum-6-ryttere-varsel.md)
og **ejeren poster selv**.

---

## 5. Fem ting den gamle prompt tog fejl af

Verificeret mod kode og prod 27/8:

1. **#4295 er ikke bare `requireFull`-gaten.** Escape-ventilen `kanFyldeTruppen` hviler på `availableCount`,
   som **aldrig** trækker bundne ryttere fra (`raceSelection.js:223`). Et hold med 29 ryttere har derfor
   altid `availableCount >= size.max`, så #4175's ventil udløste aldrig i praksis.
2. **#4299 var lukket korrekt som falsk positiv**, men lukningen gik for langt: `PUT /races/:raceId/selection`
   mangler den `race_withdrawals`-gate auto-endpointet har (`api.js:4632` mod `:4838`).
3. **Der er TO auto-udfyld-indgange, ikke tre.** `PlannerAssistantCard` skriver peak-planer, ikke udtagelser.
   Den reelle asymmetri er scope: man kan rydde dag **og** sæson, men kun udfylde en dag.
4. **#4193 fjernede løbsdags-aksen fra løbskortet** i stedet for at gøre den sand.
5. **`--danger-t` findes ikke.** Kun `--accent-t`. Klasserne hedder `text-cz-3`, ikke `cz-text-3`.
   Ikonerne er et hjemmelavet sæt på 62 stroke-ikoner i `frontend/src/components/ui/icons/`; kitchen sink på `/ui`.

Dertil: **`PUT /races/selection/bulk` findes ikke i koden**, kun i SSOT-tabellen. Og trupgrænserne **er**
skrevet ned, i `CALENDAR_RULES.md:265`. SSOT'ens egen modsigelse 5 var forkert.

---

## 6. Arbejdet der mangler, i rækkefølge

### Først: luk bølge 1
De fire PR'er i tabellen ovenfor. **Migrationen i #4304 applies af dig efter merge**
(`database/2026-08-27-4294-peak-plan-cascade.sql`, idempotent, ikke-destruktiv, post-verify i filens fod).

Bemærk konsekvensen den indfører: `ON DELETE CASCADE` betyder at en kalender-regenerering fra nu af **også**
sletter hver eneste formplan, lydløst, og at en admin der sletter ét løb ødelægger alle holds formplan for
det løb. Runbook og `seasonCarryOver.js:90-93` skal sige det.

### Derefter: spor B, overlap-læsbarhed
Designet er **færdigt og ejer-relevant**, i
[`docs/superpowers/specs/2026-08-27-planning-center-overlap-laesbarhed-design.md`](../../docs/superpowers/specs/2026-08-27-planning-center-overlap-laesbarhed-design.md).
Tre flader, hver med byggeklar spec, vinder og graft fra taberne. Byg fra den, gentag ikke designarbejdet.

- **#4296 `RaceDaySpan`**: hele dagsspændet på løbskortet, modparten navngivet. Data ligger allerede på
  wiren: `column.bindingWindow {start,end,days[]}`, `game_day`, `game_day_end`. Nul backend-arbejde i fase 1.
- **#4259 `RiderDayStatus`**: lodret glyf-rende. **`riderColumnState` i `raceHubLogic.js:72-80` findes
  allerede** med præcis de fire tilstande; puljen kalder den bare aldrig.

**Hård invariant fra dommerpanelet:** display-tal kommer KUN fra `game_day`/`game_day_end`.
`bindingWindow` bruges KUN til den booleske overlap-test, aldrig til et tal. Den falder tilbage til
CET-ordinaler (~20.000) når én schedule-række mangler `game_day`, og ville skrive "Deler dagene 20123-20124".

### Derefter: resten af spor A og D
- **#4201**: modellen er bygget og ejer-bekræftet; den mangler at blive skrevet ned. `PLANNING_CENTER_RULES.md`
  §4 fra "åben beslutning" til låst regel, Hjælp (en+da), én linje på boardet, symmetriske kontroller.
- **#4212**: peaks kan ikke fjernes; assistenten genudfylder til 2. Hænger sammen med #4201's fravalgs-model.
- **#4271**: formpeaks mere forståelige. Mindste ærlige version: hvad et peak **gør**, **hvornår**, og hvad det **koster**.

### Til sidst: spor C, Z1-sæsonmatrixen (#1146)
Bærer `needs-contract`, så `docs/GUARDRAILS_CORE.md` skal læses først, og der skal foreligge en kontrakt.
Fundamentet er større end spec'en tror: `seasonTimeline.js` (11 rene funktioner, testet), read-vejen og
skrive-vejen står. **`apply_race_entry_unit_batch` findes allerede** og er præcis den transaktionsmekanik
bulk-endpointet skal bruge (N løb i én transaktion under advisory-lås, deferred dobbeltbookings-check).

**Aksen er ikke afgjort af at #4236 er lukket.** Der er 0 løbsdage over flere datoer, men op til **5 løbsdage
deler samme dato i D1**, så 31 dato-kolonner og 86 løbsdags-kolonner er stadig to forskellige akser.
Det er et åbent ejer-spørgsmål: hvilken skal være den **klikbare** celle-akse?

---

## 7. Process der beviste sit værd. Dette er krav, ikke råd

**Adversarisk verifikation af hver PR, før merge.** Den fangede i dag, på tværs af fem PR'er:

- et **opdigtet spillercitat** tilskrevet en navngiven rigtig person, i kode **og** i PR-bodyen på GitHub
- en **fabrikeret påstand om hvad et skærmbillede viste**, i et permanent læringsdokument
- en rapport der påstod **"alle checks grønne"** mens `frontend-smoke` var fejlet
- en kodekommentar og en test-assertion der **citerede et issue som hjemmel for det modsatte** af hvad det siger
- en **SSOT-påstand der var for stærk tre gange i træk** om hvor mange flader der var lukket
- en **navigations-blindgyde** som selve fixet indførte

Uden det lag var alt det landet i prod. Byg det ind fra start: `pipeline(opgaver, byg, verificér)` hvor
verifikatoren er instrueret i at **forsøge at refutere** og har lov til at sige at fundet er forkert.

**Stol aldrig på en agents egen CI-status.** Kør `gh pr checks <nr>` selv.

**Skeln færdig fra hængende.** En færdig agent og en død agent ser ens ud udefra: begge holder op med at
skrive. Kun `journal.jsonl` skiller dem, via `"type":"result"`. Overtager du en hængende agents arbejde,
så `TaskStop` workflowet i **samme tur**, ellers står det som Running i timevis.

**Ingen barriere foran uafhængigt arbejde.** `await parallel(...)` før et uafhængigt `await agent(...)`
udskyder det sidste uden grund. Brug `Promise.all` eller læg det ind som endnu en thunk.

**Tildel patch-note-versioner op front** når flere PR'er kører parallelt. Tre PR'er hævdede samme version
i dag, og `check-patch-notes-version` hard-fejler hvis top ikke er højere end base.

**Worktrees:** `pwsh -File scripts/new-worktree.ps1 -Branch <navn>` giver node_modules-junction så tests kan
køre. Bruger du preview-serveren, så verificér at den serverer worktree'et og ikke hoved-checkoutet:
`curl http://localhost:<port>/__worktree-id`. En agent gik i den fælde i dag.

---

## 8. Faste rammer

- **Ét issue pr. PR.** `Refs #N`, aldrig `Closes`. PR-body efter `PULL_REQUEST_TEMPLATE` inkl. Brugerverifikation.
  `pwsh -File scripts/preflight-pr.ps1` før push.
- **UI merges aldrig uden ejerens visuelle go.** Preview-deploys kræver login, så brug enten et
  screenshot-script mod en lokal preview-server med `VITE_PREVIEW_MOCK`, eller `show_widget` med den
  faktiske copy. Beskrivelser tæller ikke.
- **`main` kræver 1 review.** Ejeren er eneste menneske og `enforce_admins` er slået fra, så
  `gh pr merge --merge --delete-branch --admin` er den etablerede vej. **Bed om ejerens ord først.**
- **Prod-mutationer:** ingen uden ejerens GO på netop det skridt, og han skal have set tilstanden live.
- **Copy:** EN først, DA under, dansk med æøå, ingen em-dash **nogen steder**, intet opfundet indhold.
  Bemærk at `tone-check-em-dash.mjs` kun scanner locales og prosa-sider, ikke komponent-JSX. To em-dashes
  står live i `ContextBand.jsx:63` og `:78`.
- **Postmortem** i `.claude/learnings/` ved hver bugfix. **Patch notes + Hjælp** ved enhver brugerrettet ændring.
- **Opfølgninger ejer du selv.** Fund bliver til issue plus egen worker i sessionen. Ingen chips til ejeren.

## 9. Løse ender

- **13 worktrees** ligger tilbage, heraf 7 på branches merged og slettet på origin. Oprydning blev blokeret
  af auto-mode i dag; den kræver ejerens tilladelse eller hans egen hånd.
- **`MEMORY.md` står på 3171 tokens** mod et loft på 3200. Nye HOT-entries kræver en demotering først.
- **`frontend-smoke` er flaky og er en required check.** Den fejlede 27/8 på #4300 med
  `useForumHighlights failed: Load failed`, en netværksfejl i testmiljøet på en hook PR'en slet ikke rører.
  Verificér altid årsagen før du kalder den flaky, og gen-kør så jobbet i stedet for at ændre kode.
  Den koster en gen-kørsel hver gang og fortjener sit eget issue.
- **#4282** venter stadig på ejeren: et hold er transfer-frosset af renter alene.
- **#4288**: de tre Grand Tours kører 17-18 etaper og er derfor umålte; båndet er forældet, ikke kalenderen.
