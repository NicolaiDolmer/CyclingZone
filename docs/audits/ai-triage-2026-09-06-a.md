# AI-triage — 2026-09-06 (del A)

> 15 issues med labelen `needs-ai-triage`, del A af to. Metode: `gh issue view` (title/body/labels/comments), genmåling mod kode/merged PR'er/relaterede issues, klassificering (DONE/DUBLET/KLAR/EJER-VALG/UDSKUDT), én kommentar pr. issue der starter med "AI-triage 6/9:", label-opdatering. Ingen af de 15 var allerede triageret (ingen "AI-triage 6/9:"-kommentar fundet ved recovery-tjek).

## Samle-tabel

| # | Titel (kort) | Klasse | Handling udført | Ejer-spørgsmål |
|---|---|---|---|---|
| [#4596](https://github.com/NicolaiDolmer/CyclingZone/issues/4596) | "rolling"-etaper grupperet 9 steder (6 flad, 3 bakke) | EJER-VALG | Kommentar + `needs-decision` tilføjet, `needs-ai-triage` fjernet | Skal kaptajn-prioriteternes terræn-bucket rettes fra flad til bakke/udbrud (jf. #4176)? |
| [#4565](https://github.com/NicolaiDolmer/CyclingZone/issues/4565) | Express 4→5-migration (breaking middleware) | KLAR | Kommentar (worker-brief) + `needs-ai-triage` fjernet | - |
| [#4545](https://github.com/NicolaiDolmer/CyclingZone/issues/4545) | Manglende chunk svarede 200+HTML, cachet immutable | Afventer #2423 | Kommentar + `needs-ai-triage` fjernet | - |
| [#4537](https://github.com/NicolaiDolmer/CyclingZone/issues/4537) | To hold på to konti (selvmeldt), auktioner annulleret | KLAR | Kommentar (worker-brief, afventer spillersvar) + `needs-ai-triage` fjernet | - |
| [#4521](https://github.com/NicolaiDolmer/CyclingZone/issues/4521) | SSOT for patch notes (site+Discord) + efterkontrol | KLAR | Kommentar (SSOT-dok mangler stadig) + `needs-ai-triage` fjernet | - |
| [#4448](https://github.com/NicolaiDolmer/CyclingZone/issues/4448) | Konvertér parameter-drevne exhaustive-deps-disables | EJER-VALG | Kommentar + `needs-decision` tilføjet, `needs-ai-triage` fjernet | Luk på det leverede (9/21) + opfølgende issue, eller hold åbent til alle 13 resterende er konverteret? |
| [#4418](https://github.com/NicolaiDolmer/CyclingZone/issues/4418) | 5 ryttere forsvundet ud af 3 igangværende etapeløb | EJER-VALG | Kommentar + `needs-decision` tilføjet, `needs-ai-triage` fjernet | Skal de 5 rytteres kørte etaper stå som de er (samme linje som #4356)? |
| [#4189](https://github.com/NicolaiDolmer/CyclingZone/issues/4189) | Må collaborators trigge @claude på ejerens kvote? | EJER-VALG | Kommentar + `needs-ai-triage` fjernet (havde allerede `needs-decision`) | Skal claude.yml låses til kun ejerens GitHub-bruger (actor-guard)? |
| [#4074](https://github.com/NicolaiDolmer/CyclingZone/issues/4074) | EN /pro viste kroner, Alunta opkræver DKK for alle | Afventer #4616 | Kommentar (frontend allerede rettet til EUR) + `needs-ai-triage` fjernet | - |
| [#3967](https://github.com/NicolaiDolmer/CyclingZone/issues/3967) | Fog of war: potentiale som ord/interval i stedet for tal | UDSKUDT | Kommentar + `needs-ai-triage` fjernet | - |
| [#3743](https://github.com/NicolaiDolmer/CyclingZone/issues/3743) | Assistentens træningsvalg skal afhænge af trænerens evner | EJER-VALG | Kommentar + `needs-decision` tilføjet, `needs-ai-triage` fjernet | Må assistentens svageste valg være direkte skadeligt, eller kun suboptimalt? |
| [#3720](https://github.com/NicolaiDolmer/CyclingZone/issues/3720) | A6-kalibreringen antog en præmie der er for lav | UDSKUDT (grundregel B2, efter 27/9) | Kommentar + `needs-ai-triage` fjernet | - |
| [#3709](https://github.com/NicolaiDolmer/CyclingZone/issues/3709) | Rytterudvikling og træning: tag og rate skilles ad | KLAR | Kommentar (trin 2 klar til bygning) + `needs-ai-triage` fjernet | - |
| [#3633](https://github.com/NicolaiDolmer/CyclingZone/issues/3633) | Slet #3570-backuptabellerne når rollback-vinduet lukkes | EJER-VALG | Kommentar + `needs-ai-triage` fjernet (havde allerede `needs-decision`) | Må de to backup-tabeller slettes nu? |
| [#3503](https://github.com/NicolaiDolmer/CyclingZone/issues/3503) | Loft-mekanikken udvander arketype-identitet ved høj potentiale | KLAR | Kommentar (verificér/byg kvantil-remap) + `needs-ai-triage` fjernet | - |

**Ingen DONE eller DUBLET fundet i denne delmængde** — alle 15 var enten reelt ventende arbejde, en ren owner-beslutning, eller allerede leveret men bevidst holdt åbent til en afhængighed lander.

## Til ejeren: EJER-VALG-punkterne, ét ad gangen

1. **#4189 — Skal kun du kunne trigge @claude på GitHub?** I dag kan enhver med skriveadgang bruge din Claude-kvote via `@claude` i et issue eller en PR. Der ligger allerede en færdig analyse med tre muligheder. **Anbefaling: ja, lås det til kun din bruger** — det er én linje kode, kan altid rulles tilbage, og hjælpere har deres egen Claude-konto til lokalt arbejde alligevel.

2. **#3633 — Må jeg slette to gamle backup-tabeller?** Fra #3570-reparationen i august ligger der stadig to fulde snapshots af hele rytterbestanden i databasen, som rollback-sikkerhed. Rollback-vinduet er teknisk lukket siden 23/8. **Anbefaling: ja, slet dem nu** — jo længere de ligger, jo større risiko for at nogen ved en fejl læser fra et forældet snapshot.

3. **#4418 — Skal 5 ryttere, der faldt ud af igangværende løb pga. en fejl, blive stående som de er?** Fejlen (skade/akademikontrakt midt i løb) er allerede rettet fremadrettet. Et lignende issue (#4356, to kaptajner samme etape) blev netop afgjort med "resultaterne står", fordi det ville flytte placeringer for andre hold at rette det. **Anbefaling: samme linje, lad dem stå.**

4. **#4448 — Skal en oprydningsopgave i frontend-koden lukkes delvist, eller holdes åben til den er 100% færdig?** 9 af 21 tekniske "disables" er allerede ryddet op (og en rigtig bug blev fanget undervejs), resten er lavrisiko. **Anbefaling: luk på det leverede, opret et opfølgende issue til resten.**

5. **#3743 — Må assistentens træningsvalg gøre skade, eller kun være suboptimalt, når holdet ikke har en god træner?** Retningen (dårlig træner = dårligere automatisk valg) er allerede besluttet af dig i august. Det udestående er kun hvor hårdt det svageste valg må ramme. **Anbefaling: kun suboptimalt, aldrig direkte skadeligt** — et hold uden råd til stab skal stadig kunne udvikle sine ryttere, bare langsommere.

6. **#4596 — Skal kaptajn-prioriteternes "rolling"-kategori rettes fra flad til bakke/udbrud?** Al dokumentationen ligger nu samlet ét sted (SSOT), så beslutningen kan tages på et oplyst grundlag. **Anbefaling: ja til denne ene ændring nu** (størst spillereffekt, mindst risiko); lad generatorens flade-familie stå urørt til der er målt hvor mange etapeløb der mister deres sprint-finale.

## Ikke rørt / afventer eksternt

- **#4545** og **#4074** er allerede leveret på det, AI kan gøre noget ved. Begge afventer et andet spor (#2423 Skew Protection henholdsvis #4616 Infisical/Railway-session), ikke en ny beslutning.
- **#4537** afventer spillerens eget svar i forum-tråden om hvilket hold han beholder.
- **#3967** er bevidst udskudt af dig selv ("på sigt", efter træningscore) — ingen handling ventet nu.
- **#3720** er del af grundregel B2 (økonomi-balance), som du selv har udskudt til efter S3 slutter 27/9.
- **#3709** og **#3503** har klare næste-skridt (worker-briefs), ingen owner-beslutning venter.

## Bekræftelse

15 kommentarer postet (alle starter "AI-triage 6/9:"), 15 label-opdateringer udført (needs-ai-triage fjernet på alle; needs-decision tilføjet på #4596, #4448, #4418, #3743). Ingen kode rørt, ingen prod-mutationer, ingen nye issues oprettet.
