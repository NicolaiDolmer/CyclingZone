# GitHub-audit 11/9 2026: dubletter, glemt lukket, manglende claude:done

Read-only audit af hele issue-backloggen. Datagrundlag hentet 11/9 kl. ca. 12:00 dansk tid:
642 aabne issues (18 med `claude:done`), 1.500 merged PR'er tilbage til 26/6, 9 aabne PR'er.
Alle anbefalinger er verificeret mod issuets egen body plus seneste kommentar, ikke kun titlen.

Metode i korte traek:
1. Alle merged PR'er i vinduet parset for `Closes/Fixes/Resolves #N` (close-intent) og enhver `#N` (ref).
2. Alle aabne issuers seneste kommentar scannet for leverance-signal og for restarbejde (aabne checkbokse, "rest", "mangler", "delvist", "forbliver aabent").
3. Dubletter fundet paa to spor: TF-IDF-lighed over titel plus body, og eksplicitte udsagn i tekst ("dublet", "daekkes af", "foldes ind i", "erstattes af").

---

## 1. Glemt lukket

### 1a. Done-gated (`claude:done` + aaben), klar til at ejeren lukker

Alle 11 har en merget PR, groen CI eller deploy-verify og en post-verify-kommentar. Ingen af dem har aabent restarbejde i seneste kommentar.

| Issue | Titel (forkortet) | Evidens | Anbefalet handling |
|---|---|---|---|
| 5014 | Tre bare `lazy()`-kald uden retry-vaern | PR 5028 merget 8/9 08:20, squash b8f7a394, lint-guard i preflight | `gh issue close 5014 --reason completed` |
| 5013 | Forum: abonner/afmeld pr. kategori | PR 5026 merget 8/9 09:15, post-verify MCP 09:16 (RLS + policy OK) | `gh issue close 5013 --reason completed` |
| 5012 | Discord-navn paa managerprofilen | PR 5023 merget 7/9 21:50, post-verify 21:52 (kolonne + CHECK + grants) | `gh issue close 5012 --reason completed` |
| 5011 | Forum: @-tag af manager til indbakken | PR 5018 merget 8/9 08:50, post-verify 08:52 (notifikationstyper) | `gh issue close 5011 --reason completed` |
| 5007 | Founder-maerket paa offentlig managerprofil | PR 5010 merget 7/9 21:28, CI + deploy-verify groen, tekst rettet efter ejer-review | `gh issue close 5007 --reason completed` |
| 5000 | Forum: visningstal, seneste forfatter, indlaegstal | PR 5008 merget 7/9 21:35, post-verify 21:37 (view_count, RLS, EXECUTE) | `gh issue close 5000 --reason completed` |
| 4999 | Discord-resultater kun til gruppekanaler | PR 5009 merget 7/9 19:55, deploy-verify groen, 15 gruppekanaler uroerte | `gh issue close 4999 --reason completed` |
| 4819 | Billeder i forum-indlaeg | PR 5022 merget 8/9 09:40, post-verify 09:41 (bucket + 3 storage-policies) | `gh issue close 4819 --reason completed` |
| 4818 | Roadmap-kategori paa forummet (kun ejeren) | PR 5020 merget 8/9 08:35, post-verify 08:37 (category_check + trigger) | `gh issue close 4818 --reason completed` |
| 3200 | Spiller-til-spiller-beskeder (DM) | PR 5019 merget 8/9 10:05, post-verify 10:07 (6 dm_*-tabeller), opfoelger 5032 | `gh issue close 3200 --reason completed` |
| 5048 | Forretningslagets SSOT'er + PostHog-wiring | Boelgen lukket 8/9 22:25, 6 PR'er merget, 3 CI-guards groenne; ejer-trin ligger i 4321/3797/2853/4616 | `gh issue close 5048 --reason completed` |

**Betinget:** 4959 (puljer laaser paa 25) er `claude:done`, PR 5137 merget 11/9 11:15 med groen deploy-verify, men post-verify er berammet til loerdag 13/9 efter kl. 12. Luk efter det tjek, ikke foer.

### 1b. Uden `claude:done`, men beslutningen er truffet

| Issue | Titel (forkortet) | Evidens | Anbefalet handling |
|---|---|---|---|
| 1112 | Manager-omdoemme (del af renown-motor) | Kommentar 4/9: "manager faar intet omdoemme-tal og ingen effekt (doktrin 8/6)", bekraeftet i spec 2026-09-04-reputation-system-design.md paragraf 6. Karrierehistorik daekkes af eksisterende data i 1148 | `gh issue close 1112 --reason not_planned` (fravalgt ved design) |

### 1c. Kontrolresultat: ingen forsvundne close-refs

Der findes **0** aabne issues hvor en merget PR skriver `Closes/Fixes/Resolves #N`, maalt over hele PR-saettet 26/6 til 11/9. Repoet bruger konsekvent `Refs #N` per close-protokollen, saa GitHubs egen auto-close kan pr. design ikke lukke noget her. Den svaghed er baggrunden for forward-guarden i afsnit 7.

---

## 2. Mangler `claude:done`

### 2a. Aegte kandidater: ingen

Alle 71 `claude:todo`-issues med en merget PR inden for 30 dage OG et leveringssignal i seneste kommentar blev laest igennem. **Ingen af dem er fuldt leveret.** Hver eneste har eksplicit restarbejde i sin egen seneste kommentar, oftest skrevet af sessionen selv. Stikproever:

| Issue | Seneste kommentar siger | Daekning |
|---|---|---|
| 5089 | "Issuet forbliver aabent; post-verify: 429 api-baseline over 24 t" | Delvis (punkt 2b/3/4 ude) |
| 4629 | Design-spec merget i PR 4729, "afventer ejer-beslutning (spec paragraf 8)" | Kun spec, ingen kode |
| 4539 | Generatorregel merget i PR 4806, "reparationen koeres foerst efter ejer-GO" | Forward-fix uden datareparation |
| 4271 | "kernen er leveret med PR 4359", rest: rytterkortet + retning C | Delvis |
| 3961 | PR 3962 merget, "restpunkt nr. 1 fortsat aabent" (60 rogue-opslag ikke slettet) | Delvis |
| 4039 | "byggedelene fra PR 4053 er MERGED", venter paa tester-verifikationer | Delvis |

Konklusion: den kategori ejeren frygtede findes reelt ikke lige nu. Sessionerne er disciplinerede med at skrive resten ned. Det er den modsatte drift der er problemet, se 2b.

### 2b. Omvendt label-drift: `claude:done` sat paa arbejde der ikke er faerdigt

| Issue | Titel (forkortet) | Evidens | Anbefalet handling |
|---|---|---|---|
| 5121 | Skub paa spoergeskemaet, lukkedato 14/9 | Kommentar 11/9: skub sendt, men "tilbage: Discord-opslag, svartal 12/9 og 14/9, resultat-opsummering efter lukning" | Skift til `claude:todo` indtil 14/9 |
| 4150 | Watch paths + nedlukningsvindue | Kommentar 31/8: "Delvist leveret, lader staa aaben", delopgave 3 er ejer-beslutning | Skift til `claude:todo` + `needs-decision` |
| 3818 | Fair-play: ugescan 17/8, detektoren gav nul flag | Kommentar 31/8: "Delvist leveret, lader staa aaben" | Skift til `claude:todo` |
| 4453 | Railway-logstroem uden vagt | Kommentar 31/8: kode leveret og verificeret, men `RAILWAY_TOKEN` mangler som repo-secret, saa cron har aldrig kunnet koere | Skift til `needs-user-action` (ejer-klik, ikke kode) |

Legitimt done-gated med eksplicit gate (ingen handling): 4203 (lukkes naar S4 er applied via 4270) og 452 (shippet bag flag, flip ved cutover 27/9-28/9).

---

## 3. Dubletter

Kun par hvor begge bodies er laest og indholdet reelt er det samme problem. Beslaegtede issues, epic-slices og gated-par er bevidst holdt ude.

| Luk | Titel (forkortet) | Behold | Evidens | Anbefalet handling |
|---|---|---|---|---|
| 3977 | Revurder PITR naar spillet faar omsaetning (19/8) | 5154 | Begge handler om samme fravalg 19/8. 3977's egen trigger ("foerste betalende funktion lanceres") er allerede ramt; 5154 er selve beslutningsissuet med A/B, pris og anbefaling, oprettet 11/9 paa ejerens opfordring. 3977 har 0 kommentarer siden 19/8 | `gh issue close 3977 --reason not_planned` med kommentar "dublet af #5154" |
| 3799 | Balance-baselinen er 131 afvigelser skaev paa uroert main (15/8) | 4196 | Samme fund, samme rodaarsag, samme gate. 4196 (24/8) har nyere maaling (98 afvigelser), en rodaarsags-sektion og `epic:dx-hardening`. 3799 har 0 kommentarer | `gh issue close 3799 --reason not_planned` med kommentar "dublet af #4196" |
| 3625 | Fast rutine der efterkontrollerer patch notes (10/8) | 4521 | Samme ejer-direktiv gentaget. 4521 (31/8) er SSOT-issuet, har 4 kommentarer og en gentaget frist 7/9. Bemaerk: 3625 indeholder ogsaa kravet om roadbook/roadmap-sync, som skal baeres over i 4521 foer lukning | `gh issue close 3625 --reason not_planned` med kommentar "dublet af #4521, roadmap-sync-kravet er baaret over" |
| 3644 | Traeningssiden paa desktop: AI-slop-review (12/8) | 4613 | Issuets egen kommentar 3/9: "dette issue daekkes af #4613 ... Lukkes sammen med #4613". 4613 har ejer-valgt retning B og PR 4736 under bygning | `gh issue close 3644 --reason not_planned` med kommentar "dublet af #4613" |
| 3152 | Bestyrelses-tilfredshed opleves som humoer-draeber | 3514 | Kommentar 7/8: "Foldes ind i epic #3514 (Mandatet-reworket, spec ejer-godkendt 7/8)". Indholdet ligger i epicens spec | `gh issue close 3152 --reason not_planned` med kommentar "foldet ind i #3514" |
| 2723 | Renown kun synligt i bestyrelseslokalet | 3514 | Samme kommentar 7/8, samme spec. Synlighed er en leverance i Mandatet-reworket | `gh issue close 2723 --reason not_planned` med kommentar "foldet ind i #3514" |
| 4333 | 59 backup_-tabeller forurener genererede typer | 2259 | Del 1 (stoej ud af typer plus drift-check) er leveret i PR 4478. Resten (selve sletningen) er ordret 2259's scope, som er maalt frisk 10/9 (78 tabeller, 48 MB) | `gh issue close 4333 --reason completed` med kommentar "del 1 leveret i PR #4478, resten daekkes af #2259" |

**Ikke dubletter (afvist efter laesning):** 4620 mod 4621 (soeskende-slices af 2492), 3755 mod 3756 (gated par, 3755 er gaten), 4629 mod 4630 (spec mod community-workshop), 1112 mod 1099 (manager- mod rytter-omdoemme), 4328 mod 1464 (enum-refactor mod guard-test), 3455 mod 3427 (taktikflade mod traeningsflade), 708 mod 2901 (grants paa nye tabeller mod revoke paa 47 eksisterende), 2153 mod 4999 (4999 omgoer en delbeslutning i 2153, men 2153's webhook-migration staar tilbage), 3643 mod 4613 (3643 fik ny mobil-evidens 7/9 med 9 skaermbilleder som 4613 ikke daekker).

**Planlagt lukning, ingen handling nu:** 134 (Tailwind v3 til v4) lukkes eksplicit som del af 5152, trin 3 af 3 i kaeden 5150 til 5151 til 5152.

---

## 4. `priority:high` uden aktivitet i 14+ dage

53 af 175 `priority:high`-issues (30 %) har ikke haft aktivitet i 14 dage eller mere. Fordeling: 28 stk. 14 til 30 dage, 20 stk. 31 til 60 dage, 4 stk. 61 til 90 dage, 2 stk. over 90 dage.

### 4a. Epics og paraply-issues

| Issue | Titel (forkortet) | Sidst aktiv | Anbefalet handling |
|---|---|---|---|
| 931 | [Epic] Traeningssystem, noeglerytterplaner foerst | 26/6, 77 dage | Nedjuster til `priority:med`. Traeningssporet koeres i praksis via 4850, 4613 og 4192 |
| 954 | [Epic] Transparens-hub: changelog, patch notes, roadmap | 29/6, 74 dage | Nedjuster til `priority:med`. Patch-notes-delen koeres i 4521 |
| 2689 | AI-opsaetnings-audit 19/7: prioriteringsoversigt | 18/7, 55 dage | Handl eller luk: det er en tracker over 2679, 2680, 2681 m.fl. Hvis de nedjusteres, boer denne lukkes |
| 2768 | [Epic] Verdensklasse loebsmotor | 21/7, 52 dage | Nedjuster til `priority:med`. Race engine v4 koeres i 3855 og 4707-kaeden |
| 419 | Discord: Carl-bot, Dyno, auto-mod | 3/8, 39 dage | Ejer-klik. Ejer-go givet 3/8 i klik-pakken med 2892 og 2076, men aldrig udfoert. Handl eller nedjuster |
| 3395 | [Epic] Verdensklasse-planen 08: loebsdagen som teater | 6/8, 36 dage | Nedjuster til `priority:med` indtil v4-flippet er i hus |
| 3131 | [Epic] Financial Fair Play og anti-cheat | 6/8, 36 dage | Behold `priority:high`, men giv den en aktiv slice. 3818 er det eneste spor der har bevaeget sig |
| 932 | [Epic] Ungdomsakademi | 6/8, 36 dage | Nedjuster til `priority:med`. Akademi-auktionen er udgaaet per ejer-beslutning 6/8 |
| 4117 | 13 klar-til-post traade + postplan aug/sep | 22/8, 20 dage | Ejer poster selv. Postplanen for august er forældet: opdater eller luk |
| 428 | Fast ugentlig kommunikations-rytme (loebende) | 22/8, 20 dage | Loebende opgave, boer ikke taelle som stale. Overvej label `recurring` saa hygiejne-scriptet ignorerer den |

### 4b. De 12 aeldste ikke-epics: konkret anbefaling

| Issue | Titel (forkortet) | Sidst aktiv | Anbefalet handling |
|---|---|---|---|
| 1270 | Session-hardening hooks (pre-push, dep-sync, kollisionsvarsel) | 11/6, 92 dage | Nedjuster til `priority:med`. Kollisionsvarslet er delvis daekket af worktree-tvangen i 4016 |
| 658 | Schedule token-hygiene som lokal cron | 11/6, 92 dage | Nedjuster til `priority:low`. Scriptet koeres i dag manuelt ved close-out og fejler haardt ved overforbrug |
| 481 | Brand identity overhaul (logo + designmanual) | 14/6, 89 dage | Nedjuster til `priority:med`. Subsettet 671 (accent, font, wordmark) er allerede live |
| 1299 | Dynamiske OG-billeder via @vercel/og | 29/6, 74 dage | Nedjuster til `priority:med`. Deadline "foer 20/6-relaunch" er 3 maaneder passeret; hoerer under SEO-epic 1301 |
| 2460 | Fjern setup-forhindringer + loebende ops-audit | 15/7, 58 dage | Handl: det er et staaende ejer-direktiv uden en eneste kommentar. Giv den en foerste maaling eller luk den som daekket af 5048-stakken |
| 2681 | Memory-hygiejne (MEMORY.md tæt paa fail-gate) | 18/7, 55 dage | Verificer foerst: gaten koeres ved hvert close-out. Hvis den er groen i dag, luk |
| 2680 | Cowork-connector-toggles (ejer-klik) | 18/7, 55 dage | Ejer-klik i 5 minutter, eller nedjuster til `priority:low` |
| 2679 | Disable-boelge: 5 doedvaegt-plugins | 18/7, 55 dage | Nedjuster til `priority:med`. Token-gevinsten er 6 til 7k pr. session, ikke brugerrettet |
| 671 | Brand minimum: accent, font, wordmark | 19/7, 54 dage | Kernen er live per kommentar 19/7. Afgraens til de 57 resterende baseline-filer eller luk |
| 2759 | Facebook-annoncer + organisk TikTok | 23/7, 50 dage | Ejer-beslutning: betalt markedsfoering koster penge. Nedjuster eller traef beslutningen |
| 2893 | Daglig sundhedsrapport paa job_heartbeat | 25/7, 48 dage | Behold `priority:high`: det er rodaarsagen bag flere driftsblindheder. Giv den en session |
| 3803 | Post-merge 3798: backfill caps + baseline-refit | 18/8, 24 dage | **Handl nu.** PR 3798 ER merget (20/8 19:32). Udrulningskaeden staar dermed halvfaerdig i prod siden 22 dage |

Resten af de 53 er nyere end 25 dage og hoerer til aktive spor (balance, race engine v4, design). De boer ikke roeres uden ejerens prioritering.

---

## 5. Foraeldede drafts og PR'er

9 aabne PR'er. Kun 1 er aeldre end 14 dage. Ingen har merge-konflikt (alle `MERGEABLE` eller endnu ikke evalueret).

| PR | Titel (forkortet) | Alder | Status | Anbefalet handling |
|---|---|---|---|---|
| 3512 | Arketype-prior for AI-fill, starter squads (3458 fase 2) | 35 dage | Draft, sidst roert 4/9 | Luk eller genoptag. Issue 3458 har ogsaa staaet stille i 24 dage, saa hele sporet er koldt |
| 4736 | Traeningssiden: overblik foerst, trup-foerst rytterliste (4613) | 8 dage | Draft | Blokerer 4613, 3644 og 3643. Ejerens visuelle go paa preview er gaten. Enten faerdiggoer eller marker som parkeret i 4613 |
| 5147 | Orkestrator-standard v2 (5142) | 0 dage | Klar, BLOCKED paa checks | Afventer CI, ingen handling |
| 5140 | Forumafstemning late_fill-timing (D-034) | 0 dage | Klar, BLOCKED paa checks | Afventer CI |
| 5139 | Opdag ny release ved navigation (5033) | 0 dage | Klar, BLOCKED paa checks | Afventer CI |
| 5135 | Loebende graduerings-sweep (5133) | 0 dage | Klar, BLOCKED paa checks | Afventer CI |
| 5108 | Paamindelse foer trup-udtagelsesfristen (4983) | 1 dag | Klar | Afventer CI |
| 5148, 5149 | Dependabot (claude-code-action, @types/react-dom) | 0 dage | Klar | Auto-merge naar groen |

---

## 6. Tal: foer og efter

| Maal | Foer | Efter forslagene | Aendring |
|---|---|---|---|
| Aabne issues | 642 | 623 | -19 |
| Aabne issues med `claude:done` | 18 | 6 | -12 |
| `priority:high` aabne | 175 | 163 | -12 |
| `priority:high` uden aktivitet i 14+ dage | 53 | 40 | -13 |
| Aabne PR'er aeldre end 14 dage | 1 | 0 | -1 |

Opdeling af de 19 lukninger:

| Kilde | Antal | Issues |
|---|---|---|
| Afsnit 1a: done-gated, verificeret leveret | 11 | 5014, 5013, 5012, 5011, 5007, 5000, 4999, 4819, 4818, 3200, 5048 |
| Afsnit 1b: fravalgt ved design | 1 | 1112 |
| Afsnit 3: dubletter og foldet-ind | 7 | 3977, 3799, 3625, 3644, 3152, 2723, 4333 |
| **I alt nu** | **19** | |
| Betinget efter 13/9 | 1 | 4959 |

Labelskift: **4** (5121, 4150, 3818, 4453, alle fra `claude:done` til `claude:todo` eller `needs-user-action`).
Nedjusteringer: **12** (931, 954, 2768, 3395, 932, 1270, 658, 481, 1299, 2679, 2680 og 2689 lukkes eller nedjusteres).

Bemaerk hvad tallene IKKE viser: 623 aabne issues er stadig langt over ejer-direktivet i 3154 ("ned til ca. 200 paa 7 til 14 dage", skrevet 26/7). Hygiejne alene lukker ikke det hul. Den reelle aarsag er tilgangen, ikke afgangen: 1.500 merged PR'er siden 26/6 uden en eneste `Closes #N`.

---

## 7. Forward-guard

### 7a. Hvad `scripts/priority-hygiene.mjs` (#5155) skal tjekke ugentligt

Foreslaaet kontrakt: scriptet koerer read-only, skriver en rapport og `exit 1` ved fund over budget. Ingen automatiske labelskift eller lukninger, kun eskalering.

| Nr. | Tjek | Taerskel | Hvorfor (fundet i denne audit) |
|---|---|---|---|
| 1 | `claude:done` + aaben + seneste kommentar uden restarbejde + PR merget for over 7 dage siden | Rapporter alle, WARN over 5 | 11 af 18 done-gatede laa klar til lukning, den aeldste i 12 dage |
| 2 | `claude:done` + seneste kommentar indeholder "delvist", "lader staa aaben", "rest:", "mangler" eller aaben `- [ ]` | FAIL ved 1 eller flere | 4 issues baerer et forkert done-flag lige nu (5121, 4150, 3818, 4453) |
| 3 | `priority:high` uden aktivitet i 14+ dage | WARN over 20, FAIL over 40 | 53 i dag, dvs. 30 % af alle high. Signalet er udvandet |
| 4 | `priority:high` uden aktivitet i 60+ dage | FAIL ved 1 eller flere | 6 stykker, heraf 2 over 90 dage |
| 5 | Merged PR med `Refs #N` hvor N har vaeret aaben i 30+ dage efter merge og ingen kommentar er skrevet paa N | Rapporter | Den eneste maskinelle vej til "glemt lukket" i et repo der aldrig bruger `Closes #N` |
| 6 | Aaben PR aeldre end 14 dage, draft eller ej | Rapporter | 3512 har ligget 35 dage og holder issue 3458 koldt |
| 7 | Aaben PR i draft hvis issue har `priority:high` | Rapporter | 4736 blokerer tre issues (4613, 3644, 3643) |
| 8 | Issue hvis seneste kommentar matcher "daekkes af #N", "foldes ind i #N" eller "dublet af #N" hvor N stadig er aaben, og der er gaaet 30+ dage | Rapporter som lukkekandidat | Praecis moenstret bag 3152, 2723 og 3644 |
| 9 | Titel-plus-body TF-IDF-lighed over 0,30 mellem to aabne issues oprettet med under 30 dages mellemrum | Rapporter par, max 10 | Fangede 3799 mod 4196 og 3977 mod 5154; ren titel-Jaccard fangede nul |
| 10 | `needs-user-action` uden aktivitet i 21+ dage | Rapporter som ejer-koe | 20 issues baerer labelen; 419 har haft ejer-go siden 3/8 uden at blive udfoert |

Undtag altid: `epic:*`, titler der starter med `[Epic]`, `auto-close-veto`, `manual:user` og issues markeret som loebende (fx 428).

### 7b. Hvad `github-housekeeping`-skillen skal laere af denne koersel

1. **Skift dublet-detektionen fra titel-Jaccard til TF-IDF over titel plus body.** Titel-Jaccard ved 0,45 gav 0 par paa 642 issues, og ved 0,30 kun 2, begge falske positiver (soeskende-slices). Repoets titler er lange og unikke. TF-IDF med titel-vaegt 3 og et loft paa dokumentfrekvens fandt de aegte par.
2. **Tilfoej et eksplicit "supersede-scan".** Regex efter "dublet", "daekkes af", "foldes ind i", "erstattes af", "holdes aabent til #N", "lukkes naar #N" i bodies og kommentarer gav 32 traef og 3 aegte lukkekandidater paa under et sekund. Det er billigere og mere praecist end lighedsmaal.
3. **Vend Kategori K om.** Skillen leder efter issues der mangler `claude:done`. Denne audit fandt 0 af dem og 4 af den modsatte fejl. Tilfoej en Kategori L: `claude:done` sat paa delvist arbejde. Den fejl er dyrere, fordi et done-flag stopper videre arbejde.
4. **Loft merged-PR-vinduet til mindst 800.** Repoet merger ca. 40 PR'er i doegnet. 200 PR'er daekker under 6 dage, ikke de 14 skillen antager. 1.500 PR'er raekker tilbage til 26/6.
5. **Tilfoej et gate-felt til stale-tjek.** Mange issues er bevidst gated ("lukkes naar S4 er applied", "flip ved cutover 27/9"). De boer ikke taelle som stale. Enten en label (`gated`) eller en maskinlaesbar linje i seneste kommentar.
6. **Knyt PR-alder til issue-alder.** De mest vaerdifulde fund i afsnit 5 kom af at koble en kold draft-PR til et koldt issue. Skillen ser i dag paa de to lister hver for sig.
