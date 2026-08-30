# Natbølge 2026-08-30 til 31

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 22:17 → 01:00 |
| Workflows / agenter launched | 12 / 58 |
| Agenter fuldført / døde eller stoppet | 46 / 12 |
| Issues triageret og målt | 48 |
| Issues lukket som allerede løst | 9 |
| PR'er åbnet / merged | 21 / **0** |
| Nye issues oprettet på fund | 3 (#4463, #4465, #4479) |
| gh-401-retries | preflight 0 (1. forsøg grønt); bølgen: ingen blokerende |
| Recoveries | 1 (uncommitted arbejde reddet i #4333's worktree) |
| Preflight | GO kl. 22:19 (`.codex.local/night-wave-preflight.json`) |

## Hvorfor nul merges

Ejeren gav ikke merge-go. Bølgen kørte på et generelt mandat om at arbejde, ikke på et mandat om at lande noget i `main`. Dertil kom to konkrete grunde til at holde igen selv på grønne PR'er:

1. **#4456 ændrer CI.** Brækker `static-guards` på `main`, går alle bølgens øvrige PR'er røde samtidig. Blast-radius under en aktiv bølge er hele køen.
2. **#4457 ændrer deploy-adfærd.** Forkerte watch paths betyder at backenden holder op med at deploye, og acceptkriterierne kan først verificeres efter merge.

Køen er derfor 21 PR'er om morgenen. Det er over orkestrator-reglens loft på 5, og det er en reel omkostning: `patchNotes.js` er holdt fri (orkestratoren skrev én samlet udkast-note i `drafts/`), men `help.json`, `ci.yml` og `backend/routes/api.js` har flere PR'er på sig. Merge-rækkefølgen står i morgenoplægget.

## Faserne

| Fase | Agenter | Hvad | Udbytte |
|---|---|---|---|
| 1. Triage | 10 | Mål præmissen på 50 kandidat-issues mod live kode og prod | 9 lukket, 14 klar til byg, 21 ejer-gatede med færdige beslutningsoplæg |
| 2. Byg | 21 | Kun de issues triagen havde verificeret | 21 PR'er |
| 3. SSOT | 8 | Ejer-direktiv #4266 (frist 1/9) + planlagt drift-audit | 4 nye SSOT-dokumenter, kalender-konsolidering, 2 drift-rapporter |
| 4. Review | 10 | Adversarisk: forsøg at modbevise bølgens egne PR'er | 5 NEEDS_FIX, 4 MINOR, 0 SOLID |
| 5. Rettelse | 7 | Ret review-fundene på de eksisterende branches | 4 PR'er rettet |

## De fund der betyder noget

**Fair play-detektoren har aldrig set direkte handler.** `normalizeTransactions` læste sælger og rytter gennem et join på `transfer_listings`, og den række slettes ved gennemførsel. 141 af 141 accepterede direkte handler i 90-dages-vinduet blev sprunget over. Handlen der udløste #3818 fandtes ikke i detektorens datagrundlag. Det reelle nettobeløb er 505.507, ikke de 64.194 detektoren så, og 12 af 12 handler gik samme vej. Fixet tredobler datagrundlaget, så hele feltet skal scores om i en rigtig kørsel før merge (PR #4473).

**En nat-vagt der rapporterede grønt uden at måle noget.** `calendar-invariant-audit` 30/8 09:28 UTC: `verify-invariants` døde på en RPC-timeout, `|| true` lod bash fortsætte med en tom `invariants.json`, parseren kastede, men blokken var skrevet `node ... | tee`, så `tee`'s exit 0 gjorde steppet grønt. Både tracking-issue-steppet og fail-steppet blev SKIPPED. Backwards-checket fandt samme klasse i **7 steps på tværs af 5 workflows** (#4463, PR #4477). Anden gang klassen rammer.

**En gate der håndhævede en ophævet regel.** `calendar_monument_exclusive_game_day` har gjort kalender-vagten rød 27/8, 28/8 og 29/8 på en ikke-fejl: ejeren ophævede reglen 26/8 (#4236). `CALENDAR_RULES.md` beskrev ophævelsen på linje 115-117 og listede samtidig invarianten som aktiv i §9. Reglen levede **fem steder**, ikke ét, heriblandt i et prod-skrivende reparations-script der ville have genindført det eksklusive indskud ved en gen-kørsel (#4465, PR #4477).

**En vagt der aldrig blev bygget.** `ECONOMY_RULES.md` lister `frontend/src/lib/salaryRateParity.test.js` som den aktive vagt mod at lønsatsen driver mellem frontend og backend. Filen findes ikke. To kodekommentarer bruger den som *begrundelse* for at duplikere satsen (#4479).

**Achievementen der var umulig.** High Roller lovede et bud over 500.000 CZ$ og krævede 2.000.000.000. Højeste bud i spillets historie er 1.087.224. 21 hold havde kvalificeret sig (#4414, PR #4466).

**616 falske ofrings-tekster på enkeltstarter.** Seneste skrevet 19:00 samme aften. 607 af de 616 taggede ryttere havde `work_cost = 0`. Spillerne rapporterede teksten tre gange (#3145, PR #4472).

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
