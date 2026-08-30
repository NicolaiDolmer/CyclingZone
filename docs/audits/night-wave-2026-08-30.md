# Natbølge 2026-08-30 til 31

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 22:17 → 01:15 |
| Workflows / agenter launched | 12 / 58 |
| Agenter fuldført / døde eller stoppet | 46 / 12 |
| Issues triageret og målt | 48 |
| Issues lukket som allerede løst | 9 |
| PR'er åbnet / merged | 24 / **0** |
| Nye issues oprettet på fund | 4 (#4463, #4465, #4479, #4482) |
| gh-401-retries | preflight 0 (1. forsøg grønt); bølgen: ingen blokerende |
| Recoveries | 1 (uncommitted arbejde reddet i #4333's worktree) |
| Preflight | GO kl. 22:19 (`.codex.local/night-wave-preflight.json`) |

## Hvorfor nul merges

Ejeren gav ikke merge-go. Bølgen kørte på et generelt mandat om at arbejde, ikke på et mandat om at lande noget i `main`. Dertil kom to konkrete grunde til at holde igen selv på grønne PR'er:

1. **#4456 ændrer CI.** Brækker `static-guards` på `main`, går alle bølgens øvrige PR'er røde samtidig. Blast-radius under en aktiv bølge er hele køen.
2. **#4457 ændrer deploy-adfærd.** Forkerte watch paths betyder at backenden holder op med at deploye, og acceptkriterierne kan først verificeres efter merge.

Køen er derfor 24 PR'er om morgenen. Det er over orkestrator-reglens loft på 5, og det er en reel omkostning: `patchNotes.js` er holdt fri (orkestratoren skrev én samlet udkast-note i `drafts/`), men `help.json`, `ci.yml` og `backend/routes/api.js` har flere PR'er på sig. Merge-rækkefølgen står i morgenoplægget.

## Merge-kø

Ingen PR er merget. Rækkefølgen nedenfor er bindende hvor der står **efter**: to par har tekstkonflikt i samme fil.

### 1. Merg først, lav risiko, reviewet

| PR | Issue | Hvad | Note |
|---|---|---|---|
| #4471 | #2997 | 27 droppede supabase-errors i seks kolde filer | Ikke reviewet |
| #4472 | #3145 | Ingen falske ofrings-tekster på enkeltstarter | Spillervendt, patch note |
| #4466 | #4414 | High Roller-tærsklen retter sig efter sin copy | Spillervendt, patch note |
| #4475 | #3750, #1819 | Fail-closed model-load + målt præmie i scorecard | Rejser et balance-spørgsmål, se nedenfor |
| #4464 | #2671 | RLS-policy-funktioner uden EXECUTE | MINOR_ISSUES, to en-linjers rettelser foreslået |
| #4470 | #4440 | 26 RLS-drifttabeller klassificeret | **Review døde**, ikke gennemgået |
| #4468 | #3410 | Låse-årsag udledt eksplicit | Kun logik-laget; visningen venter på at racehub-PR'erne lander |
| #4459 | #4455 | Ét launch-referenceår | **Efter** #3512, ellers genindføres konstanten |
| #4458 | #1464 | Forward-guard for finance-enums | **Før** #4388 synkroniserer `schema.sql`, ellers brækker en assert |

### 2. Docs og SSOT, deadline-drevet

| PR | Issue | Frist |
|---|---|---|
| #4462 | #4266 | **1/9** - fire nye SSOT-dokumenter |
| #4474 | #4176 | **4/9 OG før S4-kalenderen** - kalender-konsolidering |
| #4480 | #4266 | Drift-audit, ingen frist |
| #4476 | #4382 | Bestyrelsens flerårsplan i hjælpen. Spillervendt |
| #4461 | #2682 | CLAUDE.md-trim. Reviewet fandt at en bindende regel var forsvundet; rettet |
| #4481 | #3024 | Vite-dev-serveren som leak-vektor |
| #4483 | #4479 | Lønsats-paritetsvagten der aldrig blev bygget |

### 3. CI og deploy, rækkefølgen er bindende

1. **#4469** (#4453) Railway-logvagt - først, den redigerer en jobblok #4456 sletter
2. **#4470** - tilføjer et job i den region #4456 sletter
3. **#4456** (#4330) CI-konsolidering - **efter** 1 og 2, og tag begge deres guard-steps med ind i `static-guards` ved rebase
4. **#4477** (#4463, #4465) Kalender-vagtens sandhed - **dens `audit`-check er rød med vilje.** Det er beviset for at guarden bider. Merges den, er nat-vagten ærligt rød hver nat indtil #4204's RPC-timeout er løst
5. **#4457** (#4150) Watch paths - bekræft på første deploy at Railway faktisk læser `backend/railway.json`
6. **#4478** (#4333) Backup-tabeller ude af genererede typer

### 4. Kræver din beslutning før merge

| PR | Hvad du skal gøre |
|---|---|
| **#4473** (#3818) | Kør `node scripts/fairplayScoringDryRun.js` med service-nøglen **først**. Fixet tredobler detektorens datagrundlag, så hele feltet skal scores om i en rigtig kørsel |
| **#4467** | Spam fra ekstern bot (NEXAITECHAU, påstået "$500 bounty", to tomme leverance-filer). Luk eller rapportér |
| **#4482** | Skal lag 6-bonustilbud udløbe? 37 aktive tilbud på afsluttede sæsoner. Anbefaling: luk hullet fremadrettet, lad de 37 stå (ingen mister noget for en fejl vi selv lavede) |
| **#4483** | Lønsats-paritetsvagten er nu bygget (#4479). Er frontend og backend faktisk uenige om satsen i dag, står svaret i PR-bodyen |

## Beslutninger der venter på dig

Alle ligger som kommentarer på deres issue med målte tal og en anbefaling. De tre der haster:

1. **#4098** - frist i dag 31/8. Målt: 323 unge ryttere på 103 af 350 hold står `done` i en evne der i snit ligger 67 point under rytterens eget loft.
2. **#4269** - den daglige Supabase-rutine du bad om 25/8 har fejlet fem dage i træk, fordi `SUPABASE_ACCESS_TOKEN` aldrig blev sat som repo-secret. Kun du kan lave det token.
3. **#4272** - brosten-målet er 5 % eller 6 %. Begge tal lever i koden. Ved 5 % er kun D3 brudt, ved 6 % kun D1. Valget afgør hvilke katalog-lofter der overhovedet er reelle, og det blokerer de syv øvrige kalender-spørgsmål.

## Faserne

| Fase | Agenter | Hvad | Udbytte |
|---|---|---|---|
| 1. Triage | 10 | Mål præmissen på 50 kandidat-issues mod live kode og prod | 9 lukket, 14 klar til byg, 21 ejer-gatede med færdige beslutningsoplæg |
| 2. Byg | 21 | Kun de issues triagen havde verificeret | 24 PR'er |
| 3. SSOT | 8 | Ejer-direktiv #4266 (frist 1/9) + planlagt drift-audit | 4 nye SSOT-dokumenter, kalender-konsolidering, 2 drift-rapporter |
| 4. Review | 10 | Adversarisk: forsøg at modbevise bølgens egne PR'er | 5 NEEDS_FIX, 4 MINOR, 0 SOLID |
| 5. Rettelse | 7 | Ret review-fundene på de eksisterende branches | 6 PR'er rettet, 1 ny (#4483) |

## De fund der betyder noget

**Fair play-detektoren har aldrig set direkte handler.** `normalizeTransactions` læste sælger og rytter gennem et join på `transfer_listings`, og den række slettes ved gennemførsel. 141 af 141 accepterede direkte handler i 90-dages-vinduet blev sprunget over. Handlen der udløste #3818 fandtes ikke i detektorens datagrundlag. Det reelle nettobeløb er 505.507, ikke de 64.194 detektoren så, og 12 af 12 handler gik samme vej. Fixet tredobler datagrundlaget, så hele feltet skal scores om i en rigtig kørsel før merge (PR #4473).

**En nat-vagt der rapporterede grønt uden at måle noget.** `calendar-invariant-audit` 30/8 09:28 UTC: `verify-invariants` døde på en RPC-timeout, `|| true` lod bash fortsætte med en tom `invariants.json`, parseren kastede, men blokken var skrevet `node ... | tee`, så `tee`'s exit 0 gjorde steppet grønt. Både tracking-issue-steppet og fail-steppet blev SKIPPED. Backwards-checket fandt samme klasse i **7 steps på tværs af 5 workflows** (#4463, PR #4477). Anden gang klassen rammer.

**En gate der håndhævede en ophævet regel.** `calendar_monument_exclusive_game_day` har gjort kalender-vagten rød 27/8, 28/8 og 29/8 på en ikke-fejl: ejeren ophævede reglen 26/8 (#4236). `CALENDAR_RULES.md` beskrev ophævelsen på linje 115-117 og listede samtidig invarianten som aktiv i §9. Reglen levede **fem steder**, ikke ét, heriblandt i et prod-skrivende reparations-script der ville have genindført det eksklusive indskud ved en gen-kørsel (#4465, PR #4477).

**En vagt der aldrig blev bygget.** `ECONOMY_RULES.md` lister `frontend/src/lib/salaryRateParity.test.js` som den aktive vagt mod at lønsatsen driver mellem frontend og backend. Filen findes ikke. To kodekommentarer bruger den som *begrundelse* for at duplikere satsen (#4479).

**Achievementen der var umulig.** High Roller lovede et bud over 500.000 CZ$ og krævede 2.000.000.000. Højeste bud i spillets historie er 1.087.224. 21 hold havde kvalificeret sig (#4414, PR #4466).

**616 falske ofrings-tekster på enkeltstarter.** Seneste skrevet 19:00 samme aften. 607 af de 616 taggede ryttere havde `work_cost = 0`. Spillerne rapporterede teksten tre gange (#3145, PR #4472).

**Lag 6-bonustilbud udløber aldrig.** `expireSeasonScopedConsequences` er skrevet, testet og eksporteret, men kaldes ingen steder i produktionsstien. 37 bonustilbud står `active` på sæson 1 og 2, som begge er `completed`. Et hold kan i princippet indløse et to sæsoner gammelt tilbud til 200.000 CZ$ (#4482, ejer-beslutning).

**To guards mere der ikke bed, fundet af rettelses-fasen.** #4469's forward-guard scannede `backend/middleware`, som ikke findes, og `walk()` slugte fejlen, så den målte nul og var grøn. #4461's token-gate talte CRLF som indhold, så et "FAIL" var en line-ending-artefakt. Begge er rettet i kilden. Det bringer klassen "grønt flueben der intet verificerer" op på **fire** forekomster på én nat.

## Tal i gamle issues, systematisk

Reglen fra 30/8-bølgen holdt igen. Ingen agent fik lov at gentage et tal uden at genmåle det. Udbyttet:

| Issue | Sagde | Virkeligheden |
|---|---|---|
| #4455 | 1 inlinet kopi af alders-formlen | 57 steder, heraf en i den **kørende** motor |
| #2901 | 47 tabeller med anon-grants | 94, heraf 60 med skrive-grant |
| #4330 | 19 CI-jobs, 19 checkouts | 21 og 21 |
| #2997 | 170 droppede supabase-errors | 160, og et af de tre prioriterede punkter var allerede ryddet |
| #4453 | ~25 strukturerede log-signaler | 49 distinkte tags over 89 kaldsteder |
| #4098 | 353 unge ryttere på 124 af 362 hold | 323 på 103 af 350 |
| #4320 | `traffic_events` har 7 kolonner uden referrer | 13 kolonner med begge dele; issuet var løst |
| #3818 | "nul flag for parret nogensinde" | Flag med de to stærkeste identitets-signaler |
| #1819 | D1 får 160-274k i præmie | 709.425 |

## Afvigelser og læringer

**1. Stall-detektion på transcript-mtime alene giver falske positiver.** Min første vagt slog ud på tre agenter der arbejdede fint; deres worktrees viste aktiv fremdrift. Runbook'ens krav om at krydse **to** ground-truth-signaler er der af en grund. Vagten blev skrevet om til 30 minutters tavshed krydset mod worktree-fremdrift, og gav derefter ingen falske alarmer.

**2. Tre agenter døde med intet, én med reddeligt arbejde.** Tavshedsgrænsen virkede: `#4333`-agenten døde efter 45 minutter med 8 filer ucommitteret i sit worktree, og en genopretnings-agent fortsatte i **samme** worktree per runbook'ens recovery-tabel. De to der døde med nul (`#3024`, `#723/#724`) blev henholdsvis genstartet friskt og droppet eksplicit. **#723/#724 er ikke leveret i nat.**

**3. Den store SSOT-audit døde af sit eget scope.** Ét agent-spor skulle auditere ni dokumenter. Det producerede ingenting på 63 minutter. Splittet i to spor à fire dokumenter leverede begge på under 30. Skala pr. agent er en variabel, ikke en konstant.

**4. Scratchpad-filer forsvinder under lange sessioner.** Fem review-kommentarer fejlede fordi filerne var væk mellem to `Bash`-kald, selvom `ls` viste dem. Løsningen var at generere og bruge filen i **samme** kald. Værd at kende for enhver agent der skriver en fil til scratchpad og bruger den senere.

**5. `gh` er en Windows-binær og kan ikke læse Git Bash-relative stier.** `--body-file pr-4456.md` fra en `cd`'et mappe fejler; absolut sti virker.

**6. Reviewet fandt noget i hver eneste PR.** Nul af ni fik `SOLID`. Det stærkeste enkeltfund: `#4456`'s forward-guard mod tabte required check-navne lå i et job der **ikke er required**, så en PR der slettede et navn ville gå rød og merge alligevel. Fælden PR'en påstod at lukke var ikke lukket. Orkestratorens egen PR (#4462) fik `NEEDS_FIX` med syv fund, heraf to nye SSOT'er der modsagde hinanden om live adfærd fra dag ét.

**7. En agent rettede to fejl i sit eget grundlag.** Kalender-konsoliderings-agenten fandt at tillægget den byggede på påstod to ting forkert (etapeløbs-spændet ER gatet, monument-spredningen ER kvantificeret) og fjernede dem, så ejeren undgik to falske åbne spørgsmål. Det er den adfærd verifikations-fasen er til for.

---

_Refs [#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605). Runbook: [`NIGHT_WAVE_RUNBOOK.md`](../NIGHT_WAVE_RUNBOOK.md). Merge-rækkefølge og beslutningsoplæg: se issue-kommentarerne, ikke denne fil._
