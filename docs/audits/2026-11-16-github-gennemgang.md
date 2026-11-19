# GitHub-gennemgang 16/11/2026 (rapport, Refs #7911)

> **Kun rapport.** Intet er ændret på GitHub. Ejeren godkender hver handling i hovedsessionen på PC1.
> Datagrundlag: alle 1.013 åbne issues og 18 åbne PR'er hentet 16/11 via GitHub-søgning, git-historik på `main` fra 1/8 (2.416 commits efter 17/9), `docs/MASTERPLAN.md` og `docs/NOW.md` på `dea78fc`, plus kommentarlæsning for de 47 `claude:done`-issues og 93 dublet-kandidater.

## Tal

| | Antal |
|---|---|
| Åbne issues | 1.013 |
| Oprettet / lukket seneste 7 dage (sessionshook) | 123 / 59 |
| `claude:done` men åbne | 47 |
| Uden område-label | 465 (46 %) |
| Issues med reelle label-konflikter | 44 |
| Forældede kandidater (> 60 dage uden spor) | 348 |
| Ejer-signal eller `priority:high` uden plads i planen | 221 |
| Åbne PR'er > 7 dage uden aktivitet | 0 |

**Forbehold (verificér før handling):**
- GitHubs `updated_at` kan ikke bruges som aktivitetsmål: 686 issues blev rørt samme dag, 2/11 (masse-relabel). "Aktivitet" er derfor målt som *commit på main der nævner issuet* + *omtale i MASTERPLAN/NOW*. Kommentarer er ikke læst for de 348 forældede kandidater.
- **Rettelse (16/11 eftermiddag):** De 70 luk-kandidater (Bilag A-B og A-C) har alle en kommentar fra backlog-sweepen 2/11 (#7492), der vurderede dem uden at handle. Masse-berøringen 2/11 var altså sweepens kommentarer. De er ikke uden aktivitet, men uden beslutning. Detaljer pr. issue: `2026-11-16-github-gamle-70.json`. Sektion 6 talte 221; genberegnet med samme forælder-regel som Bilag B er det 219 (`2026-11-16-ejer-loefter-221.json`).
- `docs/audits/2026-11-16-tabt-fra-masterplanen.md` findes ikke på `main` (heller ikke på PR-branchen for den åbne PR 8231, "plan-hul-tjek"). Sektion 6 er derfor beregnet direkte mod `MASTERPLAN.md` + `NOW.md`.
- "Område-label" er ikke defineret i `GITHUB_WORKFLOW.md`. Antagelse: `cat:*`, `slice:*`, `epic:*`, `security` eller `brand`.
- `priority:next` behandles som en markør oven på prioritet, ikke som en konflikt (med+next er OK).

---

## Top 20 handlinger (anbefalet rækkefølge)

| # | Issue(s) | Handling | Begrundelse |
|---|---|---|---|
| 1 | #3797 | Luk (completed); fjern `claude:in-progress` | Til-dørs: alle 8 krav ok/na (internt arbejde). Har både `claude:in-progress` og `claude:done`. |
| 2 | #8108 | Sæt krav 3+4 til `na`, luk | Hjælpetekst-rettelse; krav 5 og 8 ok (help.json byte-identisk på 5 sprog i prod 13/11). Intet at tænde. |
| 3 | #7832, #7917 | Luk (completed) efter ejerens beslutninger | #7832: ejer 12/11 "ingen efterbetaling, intet skrives til prod". #7917: ejer 13/11 dropper afbryderen; alarm + 503 er leverancen. |
| 4 | #1407, #2511, #6204, #7789, #7971, #8206 | Kør `til-doers-check.mjs` igen; luk hvis krav 3-7 bliver `na` | Interne/ops-issues, hvor krav 3-7 står som manglende. Regel #7827 burde sætte dem til `na`: tjek hvorfor den ikke gjorde det (PR rørte sandsynligvis en ikke-intern sti). |
| 5 | #6668, #6804, #6165 | Fjern `claude:done`, tilbage til `claude:todo` (race-engine-session) | Ejer 15/11: privat S5-måling består ikke krav 8 (#6668, #6804); #6165: "færdig-mærke forkert, vagten er ikke bygget" (13/11). De er ikke færdige. |
| 6 | #6299, #7003, #7290, #7294 | Ejer-valg: luk med "verificeres ved næste hændelse" via opfølgningslisten #7829, eller fastsæt en målemetode | Kun krav 8 mangler, og har stået siden 3/11 (13 dage) uden et prod-tilfælde. |
| 7 | 10 issues med to `claude:`-states (sektion 3a) | Behold én state | `claude:todo`+`claude:in-progress` på #6514, #6862, #6912, #7247, #7248, #7336, #7495, #7583, #7829, og #3797 (pkt. 1). Forvirrer bølge-optag og NOW. |
| 8 | 8 `claude:done` med `triage:new`/`needs-ai-triage`/`needs-decision` | Fjern triage-labels | #2511, #7832, #7964, #7965, #8025, #8188, #8190, #8206: triage er overstået, når arbejdet er merget. |
| 9 | 7 reelle prioritetskonflikter (sektion 3a) | Ejeren vælger én prioritet | #4321 (high+med), #6912 (high+med), #7137 (high+med), #7111 (high+low), #2217/#2218/#7006 (med+low). |
| 10 | #5443 | Luk (completed) eller skriv hvad der mangler | Kommentar 22/9: "Rest samlet i #5497", og #5497 er lukket (completed). Epic'en står åben med `priority:high` uden plads i planen. |
| 11 | #8069 + 7 børn (#8070-#8076) | Placér i MASTERPLAN eller ejer-beslutning | Designløftet (`priority:high`, ejer i titel) med 7 "Del af"-børn; kun #8071 står i NOW, hub'en står ingen steder. |
| 12 | #6667/#6668 | Kobl til MASTERPLAN-linjen "U23 og junior senest i S6" | Planen lover U23/junior uden et issuenummer; hub'en #6667 (`priority:high`) har ingen plads. |
| 13 | #3154 | Ejer-beslutning: luk som erstattet af #7911/#7476, eller placér | Ejer-direktiv 26/7 "backlog ned til ~200 åbne issues": i dag 1.013. Løftet er hverken opfyldt eller formelt afløst. |
| 14 | #7138, #8034, #5843, #5841 | Placér med dato | Ejer-direktiver med konkret spilleffekt (kontrakter maks. 2 sæsoner fra S5; trupgrænser 30/30/30; U23/junior-løb synlige; kommende sæsons kalender). Ingen plads i planen. #8034 bør kobles til #7490 (trupstørrelser), der står i Brand. |
| 15 | Ejer-løfter med dato: #6950, #7418, #6190, #6940 | Placér eller meld løftet om | #6950 "ejer-løfte 28/9 + 1/…", #7418 "ejer-løfte 27/10", #6190 "planlagt uge 43-46" (overskredet), #6940 "ejer-løfte" (claude:done, krav 8 kan ikke måles endnu). |
| 16 | #7626, #7953, #8077, #7694, #7695, #6935 | Placér eller ejer-nedprioritering | Resten af ejer-direktiverne med `priority:high` uden plads (dashboard, holdsiden, motor uden lodtrækning, to forslags-gennemgange, forkert-info-gennemgang). |
| 17 | 34 issues i Bilag A-B | Luk som *not planned* med kort arkiv-note | `icebox`/`post-launch`, > 60 dage uden commit og uden for planen. Lukning er ikke sletning (regel 38). Læs seneste kommentar først. |
| 18 | 36 issues i Bilag A-C | Luk som *not planned* | `priority:low`, aldrig nævnt i en commit, > 60 dage, uden for planen. |
| 19 | 116 issues i Bilag A-D | Kør til-dørs-tjek; luk dem, der er leveret | Har commits på main før 17/9, men ingen siden. Mange er sandsynligvis leveret uden lukning (fx #3640, #3803, #4197). |
| 20 | 465 issues uden område-label | Backfill med script ud fra titelpræfiks (`[ops]`→`cat:infra`/`cat:ai-ops`, `[balance]`→`cat:balance`, `[ux]`/`[design]`→`cat:user-feature` …); 73 uden præfiks håndteres manuelt | 46 % af backloggen kan ikke filtreres pr. område. 300 af dem er oprettet i oktober-november, så det er et løbende hul i oprettelsen, ikke kun gammel gæld. Overvej en CI-vagt på issue-oprettelse. |

---

## 1. `claude:done` men åbne (47)

Kilde: `<!-- til-doers:v1 -->`-kommentaren og nyeste kommentar pr. issue. Ingen af dem nævner en åben PR.

| Issue | Mangler (krav) | Seneste status | Foreslået handling |
|---|---|---|---|
| #3797 | ingen | 9/11 alle ok/na | **Luk** |
| #8108 | 3, 4 | 13/11 5+8 ok | Sæt 3/4 `na`, **luk** |
| #6299 | 8 | 3/11 tjek ordrekontekst i prod | Ejer-valg (top 6) |
| #7003 | 8 | 3/11 co_captain-tilfælde i prod | Ejer-valg (top 6) |
| #7290 | 8 | 3/11 genafspil prod-input | Ejer-valg (top 6) |
| #7294 | 8 | 3/11 prod-optagelse af udtagelse | Ejer-valg (top 6) |
| #6649 | 8 | Ejer: dømmes efter GC-favorit-måling tir 17/11 | Vent til 17/11 |
| #6668 | 8 | Ejer 15/11: består ikke | **Tilbage til todo** |
| #6804 | 8 | Ejer 15/11: består ikke | **Tilbage til todo** |
| #6940 | 8 | Ingen gruppetto-tilfælde endnu | Opfølgningslisten #7829 |
| #3564 | 4, 5, 8 | 12/11 PR merget | Vis + verificér |
| #7339 | 4, 8 | 12/11 verifikation afventer | Verificér ved næste løbsdag |
| #7474 | 4, 8 | Observér næste gradueringsfrist | Opfølgningslisten #7829 |
| #7536 | 4, 8 | 4/11 flag tændt | Verificér, luk |
| #8089 | 3, 4, 6, 8 | Formen dag 2-3 kan ses 16/11 | **Verificér i dag** |
| #8099 | 3, 4, 6, 8 | Halvsæson-tjek ikke kørt efter deploy | Opfølgningslisten |
| #8110 | 3, 4, 5, 6, 8 | Ingen kørsel med parkerede hold set | Opfølgningslisten |
| #7832 | 3, 4, 5, 6, 8 | Ejer 12/11: ingen efterbetaling | **Luk** |
| #7917 | 3-8 | Ejer 13/11: alarm + 503 er leverancen | **Luk** |
| #1407, #2511, #6204, #7789, #7971, #8206 | 3-7 (+8) | Internt arbejde, merget | Kør til-dørs-tjek igen (top 4) |
| #6165 | 3, 4, 5, 6, 8 | 13/11: "færdig-mærke forkert, vagten er ikke bygget" | **Fjern `claude:done`** |
| #2230 | 3, 4, 5, 6, 8 | 13/11: lukkes efter skærmtjek på 2-3 sider | Skærmtjek, luk |
| #8190 | 3-8 | Spillerens melding ikke bekræftet | Spørg spilleren / verificér |
| #8188 | 3-8 | Reparation kørt i prod, 10 rækker rettet | Sæt krav, luk |
| #7964 | 3, 4, 5, 6, 8 | Rester udskilt til #8078/#8079 | Sæt krav, luk |
| #1369, #1602, #5902, #6155, #6365, #6515, #6584, #7561, #7860, #7868, #7932, #7965, #8025, #8097, #8124, #8152, #8196 | 3-6 og 8 (enkelte også 7) | PR merget 4/11-16/11, ingen til-dørs-opfølgning | Til-dørs-runde: tænd/vis/Hjælp/patch note pr. issue; #1369 og #1602 er meta/epic og bør ikke bære `claude:done` |

**Mønster:** 37 af 47 mangler krav 3-6, dvs. de er merget, men ikke ført til dørs. `claude:done` sættes ved merge, mens lukning kræver alle 8 krav. Forslag: en ugentlig til-dørs-blok, der tager de ældste først.

## 2. Dubletter og "samlet i"-kæder

Scannet: "samlet i / dublet af / erstattet af / del af / foldet ind i" i alle 1.013 issue-bodies + kommentarerne på 93 kandidater. Næsten alle træffere er hubs, der samler *andre* issues (normalt), eller falske positiver (#7137, #4355, #3743, #7988 nævner en relation om et *andet* issue). Ingen titel-dubletter over 0,6 i lighed.

| Issue | Relation | Mål | Handling | Begrundelse |
|---|---|---|---|---|
| #5443 | Rest samlet i #5497 (kommentar 22/9) | **Lukket** (completed) | Luk eller skriv hvad der mangler | Kæden ender i et lukket issue; epic'en står med `priority:high` uden plads |
| #8070-#8076 | Del af #8069 | Åben, **uplanlagt** | Placér #8069 eller ejer-beslutning | 7 børn hænger på en hub uden for planen |
| #6668 | Del af #6667 | Åben, **uplanlagt** | Kobl #6667 til "U23 og junior senest i S6" | Planen har løftet, men intet nummer |
| #2770 | Del af #2768 | Åben, uplanlagt | Ejer-triage | `priority:high`-barn uden planlagt forælder |
| #2409 | Del af #323 | Åben, uplanlagt | Ejer-triage | |
| #6521 | Del af #2223 | Åben, uplanlagt | Ejer-triage | |
| #8189 ↔ #7899 | Overlap (sprintere/klassementsryttere vinder for mange kuperede etaper) | Begge åbne, begge i planen | Behold; nævn koblingen i begge | Samme balancefænomen set fra to sider |

**Forbehold:** Kommentar-scanningen fandt kun ét reelt fund ud af 93; et højere antal kan ikke udelukkes, da kun bodies og de 93 søgetræffere er læst.

## 3. Labels

### 3a. Modstridende labels (44 issues)

| Type | Issues | Handling |
|---|---|---|
| To `claude:`-states | #3797 (in-progress+done), #6514, #6862, #6912, #7247, #7248, #7336, #7495, #7583, #7829 (todo+in-progress) | Behold én (in-progress hvis der er en aktiv PR, ellers todo) |
| To prioriteter | #4321 high+med, #6912 high+med, #7137 high+med, #7111 high+low, #2217 med+low, #2218 med+low, #7006 med+low | Ejeren vælger |
| `claude:done` + triage/beslutning | #2511 (needs-decision), #7832, #7964, #7965, #8025, #8188, #8190 (triage:new), #8206 (needs-ai-triage) | Fjern triage-label |
| `bug` + anden type | #2749 (+investigation), #2838, #8079, #8082, #8087, #8091, #8150 (+feature) | Ret til én type |
| `enhancement` + `type:bug` | #1373, #2906, #8049 | Fjern `enhancement` |
| To `type:` | #6863, #6912, #6917, #6923, #6998, #7006, #7018 | Én type |
| To `cat:` | #2798, #2799, #4630, #7138 | Acceptabelt hvis bevidst; ellers én |
| Ingen priority | #7649 (supabase-log-watch) | Sæt priority eller luk (bot-issue) |
| Ingen `claude:`-state | 20 issues (bl.a. #6916) | Sæt `claude:todo` eller placér |

### 3b. Uden område-label (465)

Fordelt på titelpræfiks: intet præfiks 73, `[ops]` 58, `[ux]` 22, `[bug]` 17, `[design]` 17, `[taktik]` 17, `[motor]` 16, `[perf]` 15, `[feature]` 14, `[idé]` 14, `[balance]` 12, øvrige < 10. Oprettet: 300 i okt-nov, 165 før. Fuld liste i Bilag C. **Handling:** top 20, pkt. 20.

## 4. Uden aktivitet i over 60 dage (348 kandidater)

Kriterie og fuld liste: Bilag A. Opdeling og foreslået handling:

| Gruppe | Antal | Handling | Begrundelse |
|---|---|---|---|
| A. Ejer-signal eller `priority:high` | 45 | **Ikke luk.** Placér eller ejer-beslutning | Det er netop den slags, ejeren ikke vil miste |
| B. `icebox`/`post-launch` | 34 | Luk som *not planned* | Allerede parkeret; > 60 dage uden spor |
| C. `priority:low`, aldrig i en commit | 36 | Luk som *not planned* | Lav prioritet, aldrig påbegyndt |
| D. Har commits før 17/9, ingen siden | 116 | Til-dørs-tjek; luk de leverede | Sandsynligvis leveret eller delvist leveret uden lukning |
| E. `priority:med`, aldrig i en commit | 117 | Ejer-triage i blokke af 20: planlæg, nedprioritér eller luk | Ingen evidens for at de er planlagt eller påbegyndt |

Eksempler på stærke luk-kandidater (verificér seneste kommentar først): #26 Transfer war-room (icebox, 6/5), #17 lånerenter (low, 6/5), #27 gemte scoutingfiltre (low, 6/5), #3596 disk-IO-tærskel (bot-alarm 19/8), #3553 "Add to Roadmap"-action fejler (13/8, sandsynligvis forældet), #3839 staging-miljø-levetid (23/8), #3961 staging-hændelse (23/8).

## 5. Åbne PR'er over 7 dage uden aktivitet

**Ingen.** Alle 18 åbne PR'er er oprettet 15-16/11 (8 drafts). Bemærk PR 8231 (draft, "plan-hul-tjek + regel om fjernelse fra masterplanen", Refs #8230), der adresserer samme problem som sektion 6: den bør lande før en stor placeringsrunde, så tjekket kan holde fundene fast.

## 6. Ejer-valg og løfter uden plads i planen (221)

Kriterie og fuld liste: Bilag B. De vigtigste:

| Issue | Ejer-valg / løfte | Foreslået handling |
|---|---|---|
| #3154 | Ejer-direktiv 26/7: backlog ned til ~200 | Erklær afløst af #7911/#7476 eller genoptag |
| #7138 | Ejer-direktiv 23/10: kontrakter kan maks. forlænges 2 sæsoner (fra S5) | Placér; S5 er i gang |
| #8034 | Trupgrænser 30/30/30, højst 60 (ejer 9/11) | Kobl til #7490 i Brand-linjen |
| #5843 | Ejer-direktiv 27/9: U23/junior-løb kan ikke ses | Kobl til "U23 og junior senest i S6" |
| #5841 | Ejer-direktiv 27/9: kommende sæsons kalender synlig | Placér før S6 |
| #6667 | U23/junior uden S4's fejl (S5) | Kobl til U23/junior-linjen |
| #8069 | Designløftet (high) + 7 børn | Placér eller ejer-nedprioritering |
| #8077 | Motoren uden lodtrækninger | Kobl til Loft 1 "Motor og løbsfilm sande" |
| #7626 | Ejer-direktiv 3/11: dashboard kun store nyheder | Placér |
| #7953 | Holdsiden løftes | Placér |
| #7136 | Ejer-direktiv 23/10: opsiges ansatte automatisk? | Investigation, hurtig at afklare |
| #7694, #7695 | Ejer-direktiv 4/11: forbedringsforslag fra forslagstråd + #staff | Placér eller luk som afsluttet |
| #6935 | Spildækkende gennemgang af forkert info | Kobl til "forkert info" i Rækkefølge pkt. 5 |
| #6950 | Ejer-løfte 28/9: catch-up-mekanik rig/fattig | Placér eller meld om |
| #7418 | Ejer-løfte 27/10: luksushjælper måles i S5 | Placér før S5 slutter |
| #6190 | Mentale evner, "planlagt uge 43-46" | Overskredet; ny dato eller udskyd eksplicit |
| #4521 | Ejer-direktiv 31/8: SSOT for patch notes | Tjek om leveret; ellers placér |
| #5131 | Ejer-direktiv 10/9: hastigheds- og mobiloptimering | Kobl til Web 5x #6494 |
| #4850 | Træning pr. løbsdag "live senest S4 28/9" | Sandsynligvis leveret; til-dørs-tjek |
| #6164 | Ryd op i hængende tilbud fra inaktive managere | Placér |
| #6914, #6916, #6917-#6919 | "Verdensklasse"-spor (high/next) | Ejer-beslutning: aktive spor eller hubs til senere |

**Mønster:** ejer-direktiver oprettes som issues med "Ejer-direktiv DATO" i titlen, men MASTERPLAN har et budget på ≤ 1.500 tokens og kan ikke rumme dem alle. Forslag: et `owner-decision`-label + en genereret liste (som `FEATURE_STATUS.md`), så MASTERPLAN kun skal indeholde rækkefølgen, mens listen sikrer, at intet forsvinder. Hører til i PR 8231-sporet (Claude Code).

---

## Bilag A: forældede kandidater (sektion 4), fuld liste

Kriterie: oprettet før 17/9/2026, ikke nævnt i `MASTERPLAN.md`/`NOW.md`, og ingen commit på main nævner issuet efter 17/9. Seneste kommentar er **ikke** tjekket pr. issue: læs den før lukning.

### A. Placér i planen eller ejer-beslutning (ejer-signal / high): IKKE luk (45)

| Issue | Oprettet | Sidste commit | Labels | Titel |
|---|---|---|---|---|
| #671 | 2026-05-25 | 2026-09-02 | priority:high, type:feature, cat:founder | Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) |
| #941 | 2026-06-02 | aldrig | priority:med, type:investigation, cat:founder | Regnskabsprogram: vælg + opsæt |
| #1283 | 2026-06-11 | aldrig | priority:med, type:docs, cat:founder | ToV-session: definér founder-stemmen (ejer-ledet): struktur fra AI, prosa fra N |
| #1569 | 2026-06-20 | 2026-09-10 | priority:high, type:bug, cat:user-feature | Ny-spiller onboarding-audit (2026-06-20): prioriteret handlingsplan |
| #1819 | 2026-06-23 | 2026-08-31 | priority:high, type:feature | Opfølgning efter præmienedskæringen: bekræft økonomi-coherence + ryd backup |
| #2480 | 2026-07-16 | aldrig | priority:low, type:investigation | Motor-ops: ML-assisteret kalibreringsforslag fra live drift (systemet foreslår,  |
| #2645 | 2026-07-18 | 2026-08-05 | priority:med, type:bug, cat:user-feature | [bug/balance] Peak/loft-beskeder inkonsistente: 'approaching ceiling' ved 29/90+ |
| #2670 | 2026-07-18 | 2026-08-05 | priority:med, type:investigation | [balance] Udvikl-og-sælg: re-mål ROI mod ægte markedsadfærd + ejer-beslutning om |
| #2675 | 2026-07-18 | aldrig | priority:med, type:investigation | [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering:  |
| #2682 | 2026-07-18 | 2026-08-31 | priority:high, cat:ai-ops, type:task | AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til  |
| #2762 | 2026-07-20 | aldrig | priority:med, type:feature, cat:user-feature | [ux/help] FAQ: kategori-inddeling + navigation + oprydning af forældet indhold ( |
| #2770 | 2026-07-21 | 2026-09-06 | priority:high, type:feature, cat:user-feature | [build] Sub-2: Dybe konkurrencer: passage-ordener (KOM/point) + bonussekunder |
| #2820 | 2026-07-23 | aldrig | priority:med, type:bug, cat:founder | [monetization] /founder-supporter siger "betaling er ikke live" mens /pro tager  |
| #2822 | 2026-07-23 | 2026-08-04 | priority:high, type:investigation, cat:founder | [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managersp |
| #2840 | 2026-07-23 | 2026-08-05 | priority:high, type:feature | Løn skal være dagsbaseret (rigtige dage): engangstræk ved sæsonstart gør sent k |
| #2884 | 2026-07-25 | 2026-08-18 | priority:high, type:feature, cat:user-feature | [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-t |
| #3154 | 2026-07-30 | 2026-09-05 | priority:high, type:bug, cat:ai-ops | [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld p |
| #3451 | 2026-08-06 | 2026-09-08 | priority:med, type:feature, cat:user-feature | [feature] Ejer-direktiv 6/8: forum-søgning + markering af ulæste indlæg i tråde |
| #3453 | 2026-08-06 | 2026-09-08 | priority:med, type:bug, cat:infra | [bug] Ejer-direktiv 6/8: /admin/growth er ikke opdateret til dagsdato: tallene  |
| #3511 | 2026-08-07 | aldrig | priority:high, type:refactor | [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashbo |
| #3659 | 2026-08-13 | 2026-08-24 | priority:med, type:feature, cat:user-feature | Ejer-direktiv 13/8: goer udvikling, traening og lofter forstaaeligt i UI: forsl |
| #3660 | 2026-08-13 | aldrig | priority:med, type:investigation, cat:user-feature | Ejer-direktiv 13/8: UX-gennemgang af hele siden: kan spilleren stole paa det de |
| #3756 | 2026-08-14 | aldrig | priority:med, type:feature, cat:balance | [balance] Gebyr paa hoeje auktions-startpriser (ejer-beslutning 15/8) - gated af |
| #3950 | 2026-08-18 | 2026-08-18 | priority:med, type:feature | [feature] Resultat-botten poster etape-resultater i divisionskanalerne (ejer-go  |
| #4010 | 2026-08-20 | 2026-08-31 | priority:high, type:bug | Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og ge |
| #4109 | 2026-08-22 | 2026-09-03 | priority:med, type:refactor, cat:user-feature | Ejer-direktiv 21/8: Planlaegning-fladen - for mange faner og klik, anti-AI-slop- |
| #4159 | 2026-08-23 | 2026-09-03 | priority:high, type:bug | [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-p |
| #4176 | 2026-08-24 | 2026-09-03 | priority:med, type:task | Ejer-direktiv 24/8: samle ALLE kalender-regler i én SSOT + gate dem, saa de ikke |
| #4268 | 2026-08-26 | 2026-09-14 | priority:med, type:feature, cat:community | Ejer-direktiv 25/8: roller i spillet - Admin, Moderator, Beta tester |
| #4271 | 2026-08-26 | 2026-08-28 | priority:med, type:feature, cat:user-feature | Ejer-direktiv 25/8: formpeaks skal vaere mere forstaaelige |
| #4322 | 2026-08-27 | 2026-09-08 | priority:med, type:feature, cat:founder | [growth] AI-assistenter som maalt akkvisitionskanal: ChatGPT er allerede top-5 s |
| #4616 | 2026-09-02 | 2026-09-06 | priority:low, type:feature, cat:founder | [session] Infisical-session: EUR-planer i Alunta, Railway-noegler, Resend-noegle |
| #4622 | 2026-09-02 | 2026-09-10 | priority:med, type:feature, cat:user-feature | [epic] Designsystem til naeste niveau: taste-doc, audit af 63 sider, kit, CI-vag |
| #4751 | 2026-09-04 | 2026-09-08 | priority:med, type:feature, cat:user-feature | Ejer-direktiv 3/9: forum- og social-pakke - klikbare navne, profilbillede, DM/in |
| #4812 | 2026-09-05 | 2026-09-11 | priority:low, cat:ai-ops, type:task, priority:next | [ci] dependabot-auto-merge.yml er sandsynligvis doed af samme aarsag som #4404 - |
| #4814 | 2026-09-05 | 2026-09-10 | priority:med, cat:user-feature, type:task | [design/beslutning] Rytterprofilens foto-plads uden feature + skyggerne paa /sea |
| #4820 | 2026-09-05 | 2026-09-10 | priority:med, cat:community, type:task | Ejer-direktiv 4/9: indholdsplan for forum-indlaeg (9 emner) + spoergeskema til s |
| #4831 | 2026-09-05 | 2026-09-05 | priority:med, type:feature, cat:balance | [balance] Traeningsrater kalibreres saa +1-loftet pr. dag naesten aldrig binder  |
| #4852 | 2026-09-05 | 2026-09-05 | priority:med, type:feature | [traening] D1: Belastning Let/Normal/Haard paa samme session, tempo-varianten (e |
| #4853 | 2026-09-05 | 2026-09-05 | priority:med, type:feature | [traening] D2: Holdpas variant 2 rollefordelt (fem paktyper, ingen bonus) (ejer- |
| #4955 | 2026-09-07 | aldrig | priority:med, type:feature | [omdoemme] PR 2: backfill --apply + flag shadow + 7 dages natlig audit (ejer-go  |
| #4985 | 2026-09-07 | aldrig | priority:low, type:feature, cat:user-feature | [feature] Gruppér enslydende beskeder i indbakken paa tvaers af flere haendelser |
| #5031 | 2026-09-08 | aldrig | priority:low, type:feature, cat:infra | Ejer-direktiv 7/9: ryd op i admin-funktioner der aldrig bruges eller er blevet o |
| #5131 | 2026-09-11 | 2026-09-11 | priority:high, type:feature, cat:user-feature | Ejer-direktiv 10/9: hele hjemmesiden skal hastighedsoptimeres OG mobiloptimeres  |
| #5256 | 2026-09-15 | aldrig | priority:med, type:bug, cat:balance | [balance] Taktik vægter med på holdtidskørsel ved en fejl - ejeren vil fjerne d |

### B. Luk som not planned (icebox / post-launch) (34)

| Issue | Oprettet | Sidste commit | Labels | Titel |
|---|---|---|---|---|
| #26 | 2026-05-06 | aldrig | priority:low, type:feature, cat:user-feature | [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) |
| #62 | 2026-05-06 | 2026-09-03 | priority:med, type:feature, cat:user-feature | [Epic] Today / Manager Inbox: hvad skete, hvad ændrede sig, hvad kræver handlin |
| #94 | 2026-05-06 | aldrig | priority:low, type:feature, cat:user-feature | [Feature] Manager cross-season statistik |
| #323 | 2026-05-12 | aldrig | priority:med, type:feature, cat:ai-ops | [epic] Verdensklasse AI/Ops setup mod 5.000-10.000 brugere |
| #324 | 2026-05-12 | aldrig | priority:med, type:feature, cat:infra | [ops] Fase 0: gør AI/release baseline reel og verificerbar |
| #425 | 2026-05-15 | 2026-08-05 | priority:med, type:feature | Discord: Auto-tildel Top-50 Manager-rolle (cron + Supabase-query) |
| #426 | 2026-05-15 | aldrig | priority:med, type:feature | Discord: /mit-hold slash-command (embed spillerens hold) |
| #430 | 2026-05-15 | aldrig | priority:low, type:feature | Discord: Rekrutter 2 community-moderatorer |
| #431 | 2026-05-15 | aldrig | priority:low, type:feature | Discord: Planlæg første AMA (community Q&A) |
| #479 | 2026-05-18 | aldrig | priority:med, type:bug | Mobile Performance optim for /founder-supporter waitlist (follow-up #361) |
| #621 | 2026-05-24 | 2026-08-28 | priority:med, type:bug, cat:infra | [ops] Sentry hardening backlog: efter #348 baseline |
| #722 | 2026-05-28 | aldrig | priority:med, type:feature | [DX] Discord-MCP setup fuldt non-interaktivt på frisk PC (autonom Railway-link) |
| #930 | 2026-06-02 | aldrig | priority:low, type:feature, cat:user-feature | [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fys |
| #957 | 2026-06-02 | aldrig | priority:med, type:feature, cat:user-feature | [Epic] Rytter-popularitet: mest besoegte ryttere (24t/7d + trend) |
| #1099 | 2026-06-06 | 2026-09-13 | priority:low, type:feature | [Epic] Omdømme/Renown-system: optjent popularity (resultater, sejre, ranglister |
| #1109 | 2026-06-06 | aldrig | priority:low, type:feature, cat:user-feature | Manager-evner (FM-stil): forhandling, scouting, økonomi m.m. |
| #1148 | 2026-06-08 | aldrig | priority:med, type:feature, cat:user-feature | [Epic] World history & Club Museum: records, legends, rivalries and season stor |
| #1151 | 2026-06-08 | aldrig | priority:med, type:feature, cat:user-feature | [Epic] Human-driven transfer market & AI liquidity |
| #1199 | 2026-06-09 | aldrig | priority:med, type:feature, cat:ai-ops | Natlig harness-vagt: kør gates mod prod-data på cron + rapportér drift som GitHu |
| #1208 | 2026-06-10 | aldrig | priority:med, type:refactor | Kalibrér boardIdentity star-score væk fra frossen uci_points (sidste funktionell |
| #1239 | 2026-06-10 | 2026-09-10 | priority:med, type:investigation, cat:user-feature | [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen a |
| #1293 | 2026-06-11 | aldrig | priority:med, type:feature | Race-motor: population-berigelse + endelige gate-bånd (cobbles/hilly/itt op til  |
| #1373 | 2026-06-13 | 2026-09-05 | priority:med, type:bug, cat:user-feature | [perf] Frontend: delt query-cache + risk-baseret optimistic/pending UI (spec 202 |
| #1374 | 2026-06-13 | aldrig | priority:med, type:refactor, cat:user-feature | [perf] Targeted Realtime-invalidering: erstat broad loadAll-refetches (auktion f |
| #1375 | 2026-06-13 | aldrig | priority:med, cat:infra, type:task | [perf] Performance-arkitektur: eksekverings-tracker (spec 2026-06-13) |
| #1450 | 2026-06-18 | aldrig | priority:med, cat:infra, type:task | [ops] Vercel Secret Sync via Infisical App Connections (single source of truth) |
| #2222 | 2026-07-05 | aldrig | priority:med, type:feature | Merchandise-funktion: hold sælger merch til fans (indtægt skalet af fans/omdømme |
| #2683 | 2026-07-18 | aldrig | priority:med, cat:ai-ops, type:task | AI-audit 19/7: oprydning: 7 udløbne scheduled tasks + stale referencer |
| #3050 | 2026-07-26 | aldrig | priority:low, type:feature, cat:user-feature | [feature] Venskabsløb / custom turneringer på tværs af divisioner (spiller-opret |
| #3486 | 2026-08-07 | 2026-08-07 | priority:med, cat:infra, type:task | [ops] VERCEL_TOKEN i Infisical + Vercel CLI: gør forbrug/alarmer læsbare fra Cl |
| #4100 | 2026-08-22 | 2026-09-10 | priority:low, type:feature, cat:community | [feature] Portraetbilleder til ryttere - community-oenske (smukkethomsen 21/8) |
| #4540 | 2026-09-01 | aldrig | priority:low, type:feature, cat:user-feature | [feature] Traek en rytter ud af et igangvaerende loeb - men laas ham ude af over |
| #5062 | 2026-09-09 | aldrig | priority:low, type:feature, cat:user-feature | [feature] Skift liga/division i saesonpausen ved at bytte med et AI- eller nedla |
| #5120 | 2026-09-10 | 2026-09-10 | priority:low, type:feature, cat:user-feature | [feature] Race-replay i 3D fra v4-tidslinje med spillerens egne ryttere/livery ( |

### C. Luk som not planned (priority:low, aldrig nævnt i en commit) (36)

| Issue | Oprettet | Sidste commit | Labels | Titel |
|---|---|---|---|---|
| #17 | 2026-05-06 | aldrig | priority:low, type:feature, cat:user-feature | [design] Lån: skal renter starte med det samme + skal gebyr betales kontant? |
| #27 | 2026-05-06 | aldrig | priority:low, type:feature, cat:user-feature | [feature] Custom gemte scoutingfiltre |
| #306 | 2026-05-11 | aldrig | priority:low, type:feature, cat:user-feature | [obs] Instrumenter resterende ~10 events fra #137 scope |
| #481 | 2026-05-18 | aldrig | priority:low, type:bug | Brand identity overhaul: logo + design manual (once-and-for-all) |
| #658 | 2026-05-25 | aldrig | priority:low, type:feature, cat:ai-ops | chore(ops): Schedule check-agent-token-hygiene.ps1 as local cron (Windows Task S |
| #986 | 2026-06-02 | aldrig | priority:low, type:feature | Økonomiside: rework af struktur (faner, forecast, lån, sæson-historik) |
| #1113 | 2026-06-06 | aldrig | priority:low, type:feature, cat:user-feature | Fans som spil-mekanik (popularity → effekt på økonomi/moral) |
| #2217 | 2026-07-05 | aldrig | priority:med, priority:low, type:feature | Staff-kontrakter + genforhandling (med Slice B) (#1441) |
| #2218 | 2026-07-05 | aldrig | priority:med, priority:low, type:feature | Pension→staff: retired ryttere bliver trænere/spejdere (#1441) |
| #2460 | 2026-07-15 | aldrig | priority:low, cat:ai-ops, type:task | [ops] Fjern setup-forhindringer én gang for alle + løbende proaktiv ops-audit |
| #2679 | 2026-07-18 | aldrig | priority:low, cat:ai-ops, type:task | AI-audit 19/7: disable-bølge: 5 dødvægt/dublet-plugins (~6-7k tok/session) |
| #2680 | 2026-07-18 | aldrig | priority:low, cat:ai-ops, type:task | AI-audit 19/7: Cowork-connector-toggles i dev-kanal (Ahrefs/Clarity/Calendar/Dri |
| #2681 | 2026-07-18 | aldrig | priority:low, cat:ai-ops, type:task | AI-audit 19/7: memory-hygiejne: MEMORY.md 2 tok fra fail-gate + memory-dir +173 |
| #2749 | 2026-07-20 | aldrig | priority:low, type:investigation | [Investigation] S1 prize-overbetaling: 40,7M udbetalt vs 35,98M payable |
| #2751 | 2026-07-20 | aldrig | priority:low, type:bug | Season-standings: NULL league_division_id (test/frosne konti) ekskluderes tavst  |
| #2838 | 2026-07-23 | aldrig | priority:low, type:feature | routes: regionOf() giver spanske/generiske stigningsnavne til nederlandske/belgi |
| #2991 | 2026-07-25 | aldrig | priority:low, type:investigation | season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division- |
| #3109 | 2026-07-28 | aldrig | priority:low, type:bug | 4 AI-hold fik deres trup erstattet af heal-sweep-fejlen (26/7): hvad gør vi ved |
| #3374 | 2026-08-05 | aldrig | priority:low, type:feature, cat:user-feature | [feature] 'Undlad udtagelse'-flag pr. rytter: beskyt ryttere der skal trænes, i |
| #3755 | 2026-08-14 | aldrig | priority:low, type:investigation, cat:balance | [balance] Maal auktions-konkurrencen 28 dage efter #2884 - gaten for baade gebyr |
| #3970 | 2026-08-19 | aldrig | priority:low, type:feature | Kontraktforlaengelse i dage + korte intro-kontrakter for akademiryttere (ejer-re |
| #4032 | 2026-08-20 | aldrig | priority:low, type:feature | [balance] Pensions-sandsynlighed boer vaegte resultater + tidligere startalder ( |
| #4073 | 2026-08-21 | aldrig | priority:low, type:feature | [ux] Akademi-salg/afvis tæt på sæsonskiftet: stille skip uden feedback til manag |
| #4352 | 2026-08-28 | aldrig | priority:low, type:bug | [ops/LAV] Frontendens API-kald fejler tavst - en fejl der rammer hver gang ser u |
| #4433 | 2026-08-30 | aldrig | priority:low, type:task | [hardening] deriveForRiderIds kan saenke en optraenet rytters evner hvis gaten n |
| #4490 | 2026-08-31 | aldrig | priority:low, type:feature, cat:user-feature | [ux] Etape-narrativet vises ogsaa i den samlede stilling, hvor det laeses forker |
| #4703 | 2026-09-03 | aldrig | priority:low, type:feature, cat:user-feature | [ux] Vis akademiryttere i holdudtagelsen bag et tilvalgs-hak, saa rutematch kan  |
| #4815 | 2026-09-05 | aldrig | priority:low, cat:user-feature, type:task | [design] Smaafund fra natboelge 5/9: badge-radius, disabled uden forklaring, sid |
| #4926 | 2026-09-06 | aldrig | priority:low, type:bug, cat:bug | [academy] academy_graduation.status stemples sold ved auktions-OPRETTELSE, ikke  |
| #4958 | 2026-09-07 | aldrig | priority:low, type:feature | [omdoemme] PR 5: marked + loen laeser omdoemme via #3448-kadence (efter 27/9) |
| #5068 | 2026-09-09 | aldrig | priority:low, type:bug | [ui/admin] AI-only-loeb vises som 0 CZ$-raekker i praemiepreviewet efter #5066 |
| #5095 | 2026-09-10 | aldrig | priority:low, type:bug, cat:bug | [ux] Raa kode/placeholder-tekst i finanshistorik, fyr rytter og traen tempo (Dis |
| #5200 | 2026-09-14 | aldrig | priority:low, type:feature, cat:user-feature | [feature] Kalenderen farvekodet efter egen status: udmeldt / tilmeldt / hold sat |
| #5225 | 2026-09-14 | aldrig | priority:low, type:feature | [assistent] Egen fra-knap: 'lad aldrig assistenten udtage for mig' (opfoelger ti |
| #5255 | 2026-09-15 | aldrig | priority:low, type:feature, cat:user-feature | [ux] Byttehandel-forslag: notifikationen fører til modtagerens egen rytter i ste |
| #5293 | 2026-09-16 | aldrig | priority:low, type:feature, cat:user-feature | [ux] Live bids-blokken paa auktionssiden skubber det vigtige ned uden at give no |

### D. Tjek om leveret (sidste commit før 17/9): kør til-dørs-tjek før lukning (116)

| Issue | Oprettet | Sidste commit | Labels | Titel |
|---|---|---|---|---|
| #103 | 2026-05-06 | 2026-09-01 | priority:low, type:investigation, cat:user-feature | [investigate] Multi-year mål: tidlig opfyldelse og genforhandling |
| #413 | 2026-05-15 | 2026-09-03 | priority:med, type:feature, cat:infra | feat(i18n): Fase 4: PatchNotes refactor + Privacy merge + Supabase emails |
| #419 | 2026-05-15 | 2026-08-05 | priority:low, type:feature | Discord: Inviter Carl-bot + Dyno + konfigurér auto-mod |
| #427 | 2026-05-15 | 2026-09-15 | priority:med, type:feature | Discord: Annoncér Discord-link i CyclingZone UI + waitlist-mail |
| #428 | 2026-05-15 | 2026-09-08 | priority:med, type:docs, cat:community | [community] Fast ugentlig kommunikations-rytme (Man/Ons/Soen) - LOEBENDE opgave |
| #844 | 2026-05-31 | 2026-09-04 | priority:med, type:feature, cat:user-feature | Lande-system: countries-tabel + 3-akset nationsstyrke (fødselsrate, talent, omdø |
| #994 | 2026-06-03 | 2026-08-05 | priority:low, type:bug, cat:infra | [ops] Harness-oprettede worktrees mangler node_modules + .env (auto-setup hook/s |
| #1141 | 2026-06-07 | 2026-09-03 | priority:med, type:investigation, cat:user-feature | Instrumentér board-brug → datagrundlag for at forenkle bestyrelses-systemet |
| #1173 | 2026-06-09 | 2026-09-08 | priority:med, type:feature, cat:user-feature | Vækst/viralitets-loop: referral (del spillet med en ven) |
| #1301 | 2026-06-11 | 2026-09-02 | priority:med, type:bug | SEO-fundament: cyclingzone.org skal kunne findes og rangere (epic) |
| #1310 | 2026-06-11 | 2026-09-10 | priority:med, type:feature, cat:user-feature | Markeds-pakke fast-follow: system-bølger, AI-bud, uopfordrede bud, forlængelses- |
| #1441 | 2026-06-17 | 2026-08-14 | priority:med, type:feature | Epic: langsigtet sammenhængende økonomi: anti-inflation, gold sinks, rigtige sp |
| #1461 | 2026-06-18 | 2026-09-05 | priority:med, type:feature | security(email): DMARC enforcement: p=none → quarantine → reject |
| #1602 | 2026-06-20 | 2026-09-10 | priority:med, type:feature, cat:user-feature | [Epic] Mobil-optimering: luk de resterende huller (ikke en omskrivning) |
| #1784 | 2026-06-23 | 2026-08-07 | priority:med, cat:infra, type:task | Vercel Pro: sæt spend management / budget-loft op (forsikring før marketing-bølg |
| #1997 | 2026-06-29 | 2026-09-03 | priority:med, type:feature | Verdensklasse historik/palmares (rytter + hold): design + build |
| #2153 | 2026-07-03 | 2026-09-07 | priority:med, type:bug | Ny Discord-server: division-routed resultat-kanaler + webhook-migration |
| #2161 | 2026-07-03 | 2026-09-07 | priority:med, type:feature | feat(auth): Log ind / opret bruger / connect med Discord (OAuth via Supabase) |
| #2178 | 2026-07-04 | 2026-09-10 | priority:med, type:feature, cat:user-feature | [feature] Upload af holdlogo + rework af holdsiden (ala rytterside-rework) |
| #2259 | 2026-07-10 | 2026-09-11 | priority:med, type:refactor, priority:next | [chore] Supabase DB-hygiejne: ryd ~20 backup_*-tabeller + covering-index på unin |
| #2261 | 2026-07-10 | 2026-09-04 | priority:med, type:bug | [bug] "High profile"-markering rammer middelmådige ryttere (3½-4★): påvirker be |
| #2415 | 2026-07-12 | 2026-09-07 | priority:med, cat:infra, type:task | Gap-realisme-scorecard: målbånd for tids-gab (etape-margener + slut-GC-spredning |
| #2423 | 2026-07-13 | 2026-09-05 | priority:med, cat:infra, type:task | [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protecti |
| #2490 | 2026-07-16 | 2026-08-06 | priority:med, type:feature | Rytter-krøniken: karrierebiografi + event-fundament (addendum Fase 2-4) |
| #2511 | 2026-07-16 | 2026-08-14 | priority:med, cat:infra, type:task | [perf/ci] Bundle-drift: gaten måler kun PR-diffs: main kan summe forbi loftet u |
| #2720 | 2026-07-20 | 2026-08-06 | priority:med, type:bug | [scouting] Rapport viser modstridende signaler: "Verdensklasse-emne" + "lav till |
| #2748 | 2026-07-20 | 2026-09-10 | priority:med, type:feature, cat:user-feature | Pensionering: forvarsel + squad-minimum-check ved masse-retirement |
| #2783 | 2026-07-22 | 2026-09-05 | priority:med, type:bug | [bug] grand_tour-arketypen kan give 2 eller 10 høj-bjergsetaper → GT'ens HC-tota |
| #2887 | 2026-07-25 | 2026-08-03 | priority:med, type:investigation, cat:balance | [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirk |
| #2893 | 2026-07-25 | 2026-08-06 | priority:low, type:feature | [ops] Daglig sundhedsrapport paa projekt-ejet job_heartbeat: positiv puls i ste |
| #2901 | 2026-07-25 | 2026-08-14 | priority:med, type:bug | [security] REVOKE anon/authenticated-grants paa 47 RLS-laaste tabeller (EFTER cu |
| #2906 | 2026-07-25 | 2026-08-17 | priority:med, type:bug | [design] Mit Hold-løft: alle 15 evner synlige samtidig, rating-kolonne, lavere r |
| #2997 | 2026-07-25 | 2026-08-31 | priority:med, type:refactor | Spis de 170 droppede Supabase-errors ned (baseline fra #2897-guarden) |
| #3092 | 2026-07-27 | 2026-09-05 | priority:med, type:investigation | Afinstallér ubrugt Manus Connector GitHub App (permission-request 27/7) |
| #3131 | 2026-07-30 | 2026-09-08 | priority:med, type:feature | [Epic] Financial Fair Play & Anti-Cheat: bevis, forebyggelse, detektion, håndte |
| #3328 | 2026-08-04 | 2026-08-25 | priority:med, type:bug, cat:balance | [balance] Løbsklasse og etapeantal er afkoblet: 32 af 36 D2-etapeløb er ProSerie |
| #3337 | 2026-08-04 | 2026-08-22 | priority:med, type:investigation, cat:balance | [investigation] Betaler specialisering sig? Bjergryttere vs. brede allroundere o |
| #3349 | 2026-08-04 | 2026-08-05 | priority:med, type:bug, cat:balance | [balance] Spillets terræn-mix er skævt mod fladt: kuperet under virkelighede |
| #3350 | 2026-08-04 | 2026-08-20 | priority:med, type:feature, cat:user-feature | [produkt] Spillerne gætter på reglerne: fire testere byggede fire private model |
| #3372 | 2026-08-05 | 2026-08-09 | priority:med, type:investigation, cat:user-feature | [bug] Ungdoms-scoutrapport faldt drastisk, og TT står fast på 90% trods anbefale |
| #3395 | 2026-08-05 | 2026-08-06 | priority:med, type:feature | [Epic] Verdensklasse-planen 2026-08: løbsdagen som teater + levende presse + lev |
| #3450 | 2026-08-06 | 2026-08-10 | priority:med, type:investigation, cat:balance | [investigation/balance] Potentialer rykkede sig bredere end tilsigtet efter rytt |
| #3471 | 2026-08-06 | 2026-08-06 | priority:med, type:feature, cat:user-feature | [feature] Kalender-spor med identitet (GT-spor / WT-spor / klassiker-spor): spi |
| #3503 | 2026-08-07 | 2026-08-14 | priority:med, type:feature, cat:balance | [balance] Loft-mekanikken udvander arketype-identitet ved hoej potentiale - G3-r |
| #3542 | 2026-08-08 | 2026-08-29 | priority:med, type:investigation, cat:balance | [balance] Division 2 opleves som økonomisk straf: spiller vurderer 4x indtjening |
| #3547 | 2026-08-09 | 2026-08-21 | priority:med, type:feature, cat:balance | [balance] S3-kalender: samlet spillerfeedback ud over GT'erne: brosten, enkelts |
| #3553 | 2026-08-09 | 2026-08-13 | priority:med, type:bug | [ops] "Add to CyclingZone Roadmap"-action fejler på ALT: Bad credentials (udløbe |
| #3577 | 2026-08-09 | 2026-08-18 | priority:med, type:investigation | [investigation] #3561-efterspil: spillere tog lån og solgte ryttere for at byde  |
| #3592 | 2026-08-10 | 2026-08-18 | priority:med, type:feature, cat:balance | [balance] Fire typepar er matematisk uadskillelige: positive vaegte er delmaeng |
| #3595 | 2026-08-10 | 2026-09-10 | priority:med, type:investigation, cat:balance | [balance] Sponsormål kan ignoreres uden konsekvens: pengene udbetales med det s |
| #3596 | 2026-08-10 | 2026-08-19 | priority:med, type:investigation | [db-health] Disk-IO/performance tærskel-brud |
| #3614 | 2026-08-10 | 2026-08-18 | priority:med, type:investigation, cat:balance | [balance] 142 frie ungdomsryttere fra gamle akademi-kuld er over ungdomsbåndet: |
| #3616 | 2026-08-10 | 2026-08-11 | priority:med, type:investigation, cat:balance | [balance] Ungdomsbåndet er for lavt i bunden og fladt i toppen: 16-17-årige und |
| #3629 | 2026-08-11 | 2026-08-14 | priority:med, type:feature | [balance] Talent-kloeften: akademiet snit 3,61 stjerner, det frie marked 2,20:  |
| #3640 | 2026-08-11 | 2026-08-11 | priority:med, type:bug | [bug/comms] 'Over-22-rettelsen' 11/8 re-typede ogsaa 77 % af spillernes under-23 |
| #3667 | 2026-08-13 | 2026-08-20 | priority:med, type:docs | [docs] Hjælp/FAQ + patch notes efter rating-omlægningen (Fase 3) |
| #3705 | 2026-08-14 | 2026-09-02 | priority:med, type:feature, cat:balance | [balance] Traeningsfokus rammer faste evne-bundter: progression spildes naar 1-2 |
| #3711 | 2026-08-14 | 2026-08-14 | priority:med, type:feature | [ops] cross-pc-sync har ingen oprydning: 2,8 GB og 9.777 transcript-filer i OneD |
| #3719 | 2026-08-14 | 2026-08-23 | priority:med, type:feature, cat:balance | [balance] Kalenderen har intet præmiepulje-budget pr. division: variations-besl |
| #3729 | 2026-08-14 | 2026-08-14 | priority:med, type:feature, cat:balance | [balance/HOEJ] Markedet er forbudt at prissaette over modellen - 23 konkurrenceh |
| #3732 | 2026-08-14 | 2026-08-20 | priority:med, type:feature, cat:balance | [balance/HOEJ] Vaerdimodellen er pengepolitik, ikke en prisseddel - en stor del af al |
| #3733 | 2026-08-14 | 2026-08-20 | priority:med, type:feature, cat:user-feature | [ux] Soendags-kvittering paa vaerdien: spilleren skal kunne se HVORFOR hans rytt |
| #3743 | 2026-08-14 | 2026-08-14 | priority:med, type:feature | [balance] Assistentens traeningsvalg skal afhaenge af traenerens evner - i dag e |
| #3763 | 2026-08-14 | 2026-08-14 | priority:med, type:feature | [ux] Managers skal kunne se form stige og falde af traening - dataene ligger all |
| #3767 | 2026-08-14 | 2026-08-17 | priority:med, type:bug | [observability] Sentry er tavs: eneste alarmregel rammer kun high-priority (sids |
| #3803 | 2026-08-17 | 2026-08-20 | priority:med, type:feature | [ops] Post-merge #3798: backfill ability_caps + baseline-refit + issue-lukning ( |
| #3804 | 2026-08-17 | 2026-08-17 | priority:med, type:bug | [balance] Bi-typen former ikke rytterens krop endnu - blokeret af at race:gate's |
| #3818 | 2026-08-17 | 2026-08-31 | priority:med, type:investigation | [fair-play] Ugescan 17/8: 3 ensrettede handler mellem samme to hold, incl. 71x o |
| #3839 | 2026-08-17 | 2026-08-23 | priority:med, type:task | [ops] Staging-miljøet staging-3746-trin7: levetid + oprydningsliste (koster ~2 k |
| #3854 | 2026-08-17 | 2026-08-17 | priority:med, type:feature | [feature] Staff-parallel rest efter #3851: aegte per-scout kapacitet + per-rytte |
| #3856 | 2026-08-17 | 2026-08-17 | priority:low, type:feature, cat:user-feature | [feature] Løbsfilm-backfill: tidslinjer for de 1.929 historiske etaper med sim-r |
| #3864 | 2026-08-17 | 2026-09-03 | priority:med, type:feature, cat:user-feature | [S4] Belgisk åbning: kurateret klassiker-uge + brosten-sektorer med reel vægt på |
| #3938 | 2026-08-18 | 2026-08-18 | priority:med, type:refactor | [refactor] race_entries: raceRunner-autofyld + distribution-regenerate paa apply |
| #3939 | 2026-08-18 | 2026-08-18 | priority:med, type:investigation | [investigation] 148 (loeb,hold)-enheder under 6 entries trods fejlfri sweep - sm |
| #3948 | 2026-08-18 | 2026-09-05 | priority:med, type:feature | [ux] Board-maalet 'Mindst 1 etapesejr' er tvetydigt: samlede sejre i endagsloeb  |
| #3955 | 2026-08-18 | 2026-08-23 | priority:med, type:feature | [ux] Planning: loebs-info er for tynd - etapeprofiler inline + Available Riders  |
| #3957 | 2026-08-18 | 2026-09-10 | priority:med, type:bug | [bug] Assistentens auto-udtagelse matcher ikke loebsprofilen (bjergryttere+ungdo |
| #3961 | 2026-08-18 | 2026-08-23 | priority:med, type:bug | [incident] Staging-backend mod branch-klon postede 60 re-simulerede resultater t |
| #3965 | 2026-08-19 | 2026-08-21 | priority:med, type:investigation, cat:balance | [balance] Punch-evnen opleves vaegtloes paa punch-etaper - foerste mand over top |
| #3982 | 2026-08-19 | 2026-08-20 | priority:med, type:feature | [feature] Etapestriben fase 2: resultat-piller (top 5 + eget hold) efter koersel |
| #3987 | 2026-08-20 | 2026-08-20 | priority:med, type:feature, cat:balance | [balance] Sponsorens basisbeloeb og race-day-betaling boer skalere med global ra |
| #4005 | 2026-08-20 | 2026-09-02 | priority:med, type:feature | [billing] /pro foer aabning: 49 kr inkl. moms eksplicit + pro-rata-forklaring ve |
| #4015 | 2026-08-20 | 2026-08-20 | priority:med, type:feature | [perf] Request-budget pr. spiller som grundlag for compute-sizing |
| #4067 | 2026-08-21 | 2026-09-16 | priority:med, type:feature | [SEO] Offentligt Next.js-site (hybrid-split): marketing-lag, EN+/da/, keyword-ti |
| #4122 | 2026-08-22 | 2026-08-23 | priority:med, type:feature, cat:user-feature | [design] Forfattede loeb: de loeb der baerer identitet skal kunne skrives ned, i |
| #4145 | 2026-08-23 | 2026-08-23 | priority:med, type:feature | [balance] Kontraktforlaengelse er gratis: gebyr skal goere det til et aegte valg |
| #4146 | 2026-08-23 | 2026-09-03 | priority:med, type:feature | [balance] Trup-loftet er 30 for alle divisioner mens et loeb udtager 6-8: DIVIS |
| #4150 | 2026-08-23 | 2026-08-31 | priority:med, type:bug, cat:infra | [infra] Watch paths + nedlukningsvindue: docs-commits redeployer backenden midt  |
| #4164 | 2026-08-24 | 2026-08-24 | priority:med, type:docs | [docs] Ubesvaret mekanik-spoergsmaal: giver 6 etaper paa én dag mere traening en |
| #4188 | 2026-08-24 | 2026-08-24 | priority:med, type:feature | [collab] Delt dev-miljoe + invitér hjaelpere som collaborators |
| #4189 | 2026-08-24 | 2026-08-24 | priority:med, type:feature | [collab/beslutning] Maa collaborators trigge @claude paa ejerens kvote? |
| #4195 | 2026-08-24 | 2026-08-24 | priority:med, type:bug | [balance] Vaerdimodellen er saa stejl i toppen at ET overall-point = +20M - 40M- |
| #4196 | 2026-08-24 | 2026-08-24 | priority:med, type:bug | [guard] balance:check taeller 98 afvigelser paa main men er advisory - baselinen |
| #4197 | 2026-08-24 | 2026-08-24 | priority:med, type:bug | [guard] race:gate:routes er permanent roed - longDayEnduranceLift-baandet staar  |
| #4214 | 2026-08-25 | 2026-08-25 | priority:low, type:feature | [ops] Infisical machine identity, saa prod-scripts kan koeres uden interaktivt b |
| #4220 | 2026-08-25 | 2026-08-26 | priority:med, type:bug | [calendar/realisme] Enkeltstarter skal ligne virkelighedens cykelsport - researc |
| #4263 | 2026-08-26 | 2026-09-03 | priority:med, type:investigation, cat:user-feature | [ux] Rytterens vaerdi falder 240k paa to maaneder mens evnerne stiger - intet i  |
| #4264 | 2026-08-26 | 2026-09-02 | priority:low, type:feature, cat:user-feature | [feature] Skjul andre holds rytter-evner - scouting afsloerer gradvist et interv |
| #4278 | 2026-08-26 | 2026-09-03 | priority:med, type:feature, cat:balance | [balance] D4 er den mest bjergrige division - samlet opad over baandet |
| #4328 | 2026-08-27 | 2026-08-31 | priority:med, type:refactor | [refactor] finance_transactions.type: CHECK-constraint → Postgres-enum (pensione |
| #4364 | 2026-08-28 | 2026-08-30 | priority:med, type:refactor | [ops] NOW.md og MASTERPLAN.md ligger paa deres token-lofter - hver ny note kraev |
| #4423 | 2026-08-30 | 2026-08-31 | priority:med, type:bug | [bug] Akademikontrakt skrevet midt i et igangvaerende etapeloeb fjerner rytteren |
| #4535 | 2026-08-31 | 2026-08-31 | priority:med, type:feature | [ux] Saesonmatrixens tidsakse: datoer og loebsdage gentages pr. loebsgruppe - ov |
| #4537 | 2026-08-31 | 2026-09-01 | priority:med, type:investigation | [fair-play] To hold paa to konti (selvmeldt): 57 auktioner annulleret, hold-valg |
| #4539 | 2026-09-01 | 2026-09-05 | priority:med, type:bug, cat:balance | [bug] La Course au Soleil: etape 1 og 3 er identiske 20 km enkeltstarter - ejer- |
| #4591 | 2026-09-02 | 2026-09-02 | priority:med, type:investigation, cat:balance | [balance] To D2-loeb samme dag vundet fra udbrud af markant svagere ryttere (1/9 |
| #4596 | 2026-09-02 | 2026-09-02 | priority:med, type:investigation, cat:balance | [balance/ssot] 'rolling' er grupperet ni steder - seks paa flad-siden, tre paa b |
| #4627 | 2026-09-02 | 2026-09-03 | priority:med, cat:user-feature, type:task | Synk Claude Design-spejlet (a332ec00) via /design-sync: 10 drift-punkter + readm |
| #4628 | 2026-09-02 | 2026-09-05 | priority:med, type:feature, cat:user-feature | Luk de fire aabne anti-slop-issues #3422 #4109 #3644 #3643 med det nye kit (slic |
| #4646 | 2026-09-02 | 2026-09-08 | priority:med, type:bug | [billing/funnel] 3 af 4 startede Pro-koeb 2/9 gennemfoerte ikke: maal frafaldet  |
| #4822 | 2026-09-05 | 2026-09-05 | priority:med, type:docs, cat:community | [docs] Ubesvaret: prioriterer en rytter med sekundaer troeje point frem for klas |
| #4825 | 2026-09-05 | 2026-09-05 | priority:low, type:feature, cat:user-feature | [design] Kan et bud annulleres? Live auktion nej, egne salg maaske 3 min - ejer- |
| #5064 | 2026-09-09 | 2026-09-10 | priority:med, type:docs, cat:user-feature | [docs] Scouting: hvad giver niveau 4/5, og taeller coaching group med? (thelamba |
| #5107 | 2026-09-10 | 2026-09-10 | priority:med, type:feature, cat:user-feature | [fog of war] Forum-afstemning: præcise tal, bånd uden for markedet, eller bånd f |
| #5114 | 2026-09-10 | 2026-09-11 | priority:med, type:docs, cat:user-feature | [design] TASTE.md P2-udvidelse: illustration som identitet + identity-slot/hero- |
| #5157 | 2026-09-11 | 2026-09-13 | priority:med, type:task, priority:next | [process] To drafts aeldre end en maaned (#3512, #4736): faerdig eller luk + 14- |

### E. Ejer-triage (priority:med, aldrig nævnt i en commit) (117)

| Issue | Oprettet | Sidste commit | Labels | Titel |
|---|---|---|---|---|
| #91 | 2026-05-06 | aldrig | priority:med, type:feature, cat:user-feature | [Feature] Race Day Live-ticker |
| #414 | 2026-05-15 | aldrig | priority:med, type:docs, cat:infra | chore(i18n): Fase 5: lint-guard + docs + retro |
| #415 | 2026-05-15 | aldrig | priority:med, type:docs | Discord community: world-class opsætning (epic/tracker) |
| #450 | 2026-05-16 | aldrig | priority:med, type:feature | [feature] Minimumspris på egne ryttere: passive floor mod spam-bud (Vman-style) |
| #519 | 2026-05-20 | aldrig | priority:med, type:refactor, cat:infra, priority:next | [refactor] Split backend/routes/api.js i domain routers uden adfærdsændring |
| #520 | 2026-05-20 | aldrig | priority:med, type:refactor, cat:infra | [refactor] Split AdminPage/RacesPage og fastlæg frontend vs backend data ownersh |
| #723 | 2026-05-28 | aldrig | priority:med, type:feature | [DX] bootstrap-pc.ps1: installer gitleaks via Scoop (robust pre-commit primær-st |
| #724 | 2026-05-28 | aldrig | priority:med, type:feature | [DX] Ét verify-setup.ps1 med samlet grøn/gul/rød-verdikt (MCP + secret-on-disk + |
| #908 | 2026-06-01 | aldrig | priority:med, type:feature | R2 v1.1: akse-1 ratio-editor for master-ankre (pointtrøje = X% af etapesejr) |
| #931 | 2026-06-02 | aldrig | priority:med, type:feature, cat:user-feature | [Epic] Træningssystem: nøglerytterplaner først, individuel dybde senere |
| #938 | 2026-06-02 | aldrig | priority:med, type:feature, cat:user-feature | Global søgefunktion: søg på tværs af ryttere, hold, løb og managers |
| #939 | 2026-06-02 | aldrig | priority:med, type:feature, cat:user-feature | Vejr + vind på etaper som race-faktor (sub-scope af race-engine #675/#676) |
| #954 | 2026-06-02 | aldrig | priority:med, type:feature, cat:user-feature | [Epic] Transparens-hub: Changelog / Patch notes / Roadmap (+ voting & styrings-s |
| #1106 | 2026-06-06 | aldrig | priority:med, type:feature, cat:user-feature | Multi-sæson visning: rangliste/historik/kalender på tværs af sæsoner (10+) |
| #1110 | 2026-06-06 | aldrig | priority:med, type:feature, cat:user-feature | Bestyrelsen går op i ryttertyper (mål baseret på rolle-sammensætning) |
| #1136 | 2026-06-07 | aldrig | priority:med, type:feature, cat:user-feature | [Epic] Progression & livscyklus: rytterudvikling, træning, ungdom (samler #930/ |
| #1182 | 2026-06-09 | aldrig | priority:med, type:feature | Verificér + slet ubrugte Railway Postgres + Redis (pleasing-spontaneity) |
| #1294 | 2026-06-11 | aldrig | priority:med, type:feature, cat:infra | Race-motor test-værktøjer: seed-variation i preview (flere udfald) + preview på  |
| #1299 | 2026-06-11 | aldrig | priority:med, type:feature | Dynamiske OG share-billeder via @vercel/og (etaperesultat-kort): før 20/6-relau |
| #1379 | 2026-06-13 | aldrig | priority:med, type:feature, cat:user-feature | Genbesøg evnesystemet + watt-intervaller (5/10/15-min power-kurve) |
| #1818 | 2026-06-23 | aldrig | priority:med, type:feature | Økonomi-gates ignorerer 0c hale-ryttere: gen-kør #1441/#1606 med fuld 12-trup |
| #1833 | 2026-06-25 | aldrig | priority:med, cat:user-feature, type:task | [ux] In-game forklaring af rytter-evner + fysiologiske power-intervaller (toolti |
| #1900 | 2026-06-26 | aldrig | priority:med, cat:user-feature, type:task | [ux] Cross-division standings-overblik: alle divisioner i én visning + filter ti |
| #1922 | 2026-06-26 | aldrig | priority:med, type:feature, cat:user-feature | [feature] Træningsfokus-rework: meningsfulde trade-offs (cykelnørd møder casual) |
| #1925 | 2026-06-26 | aldrig | priority:med, cat:bug, type:task | Follow-ups efter holdudtagelses-overhaul (#1924): help.json, trigger-verify, edg |
| #1981 | 2026-06-29 | aldrig | priority:med, type:investigation, cat:user-feature | [Investigation] Catch-up for nye/tilbagevendende klubber: billigere udviklingsve |
| #2101 | 2026-07-02 | aldrig | priority:med, type:feature | Opfølgning #2098: ability_progress-scoping + grant-audit forward-guard |
| #2227 | 2026-07-06 | aldrig | priority:med, type:bug | [ux] /board høj dead-click-tæthed (480, 29/6-6/7): element ser klikbart ud men  |
| #2270 | 2026-07-10 | aldrig | priority:med, type:feature | [ci] Natlig game-day smoke-sim: fuld pipeline-test (kalender->startlister->etape |
| #2398 | 2026-07-12 | aldrig | priority:med, type:feature | [feature] Vis træner-stats + sign-on/release-gebyr for coaches |
| #2399 | 2026-07-12 | aldrig | priority:med, type:feature | [feature] Rytter-søgning: filtrér på ejer-type (kun mennesker) + division |
| #2417 | 2026-07-12 | aldrig | priority:med, type:task | τ-kompression exit-strategi + maxSeason-genmåling post-S4 (kalibrerings-gæld) |
| #2441 | 2026-07-15 | aldrig | priority:med, type:task | [discord] Nye medlemmer ser ikke kanalerne: skal selv finde dem manuelt |
| #2457 | 2026-07-15 | aldrig | priority:med, type:feature, cat:user-feature | [balance] AI-holdenes rytter-kvalitet skal matche deres division (div 1-4) |
| #2477 | 2026-07-16 | aldrig | priority:med, type:investigation, cat:user-feature | Race-motor/verden: verdensrangliste der fodrer motoren: kvalifikation, wildcard |
| #2479 | 2026-07-16 | aldrig | priority:med, type:investigation | Research-spike: W'/Critical Power-fysiologimodel i dry-run-harnesset (fatigue v4 |
| #2487 | 2026-07-16 | aldrig | priority:med, type:feature | Gennembruds-vinduer & stagnations-diagnoser (addendum Fase 2) |
| #2488 | 2026-07-16 | aldrig | priority:med, type:feature | Projekt-ryttere: flersæsons udviklingsplaner, maks 3 slots (addendum Fase 2) |
| #2489 | 2026-07-16 | aldrig | priority:med, type:feature | Sæsonkortet: Lag 2-periodiseringsflade med træningsblokke (addendum Fase 3) |
| #2493 | 2026-07-16 | aldrig | priority:med, type:feature | Årgangs-cyklussen: navngivne generationer + årgangs-leaderboard (addendum Fase 5 |
| #2494 | 2026-07-16 | aldrig | priority:med, type:feature | Informations-derbyet: scout-vindue før ungdomsauktion (addendum Fase 5) |
| #2495 | 2026-07-16 | aldrig | priority:med, type:feature | Akademi-filosofi: valgbar skole der farver kuldene (addendum Fase 5) |
| #2667 | 2026-07-18 | aldrig | priority:med, type:feature | Værdimodel v4 slice 4: selvkørende re-fit mod ægte driftdata + anchors udfases ( |
| #2669 | 2026-07-18 | aldrig | priority:med, type:refactor | [chore/balance] Migrér 7 offline-harnesses fra v3- til v4-værdimodellen (eftersl |
| #2684 | 2026-07-18 | aldrig | priority:med, cat:ai-ops, type:task | AI-audit 19/7: drift-vagt-hærdning (prefix-match + snapshot-staleness-WARN) + ha |
| #2685 | 2026-07-18 | aldrig | priority:med, type:feature, cat:ai-ops | AI-audit 19/7: ny skill /close-out: kodificér 6-trins session-afslutning som hå |
| #2687 | 2026-07-18 | aldrig | priority:med, cat:ai-ops, type:task | AI-audit 19/7: PostToolUse-hook: eslint på frontend-edits (forebygger #2044-kla |
| #2747 | 2026-07-20 | aldrig | priority:med, type:feature, cat:user-feature | Regen/newgen: erstat pensionerede ryttere så feltet ikke krymper monotont |
| #2768 | 2026-07-21 | aldrig | priority:med, type:feature, cat:user-feature | [Epic] Verdensklasse løbsmotor: virkelighedstro ruter, dybe konkurrencer & præs |
| #2799 | 2026-07-22 | aldrig | priority:med, type:bug, cat:user-feature, cat:balance | [balance/HØJ] Markedsværdier eksploderede i halen efter v4-cutoveren: 350k-rytt |
| #2885 | 2026-07-25 | aldrig | priority:med, type:feature, cat:user-feature | [feature] Sælg rytter til AI efter N mislykkede auktioner: udvej for hold der i |
| #2923 | 2026-07-25 | aldrig | priority:med, type:feature | Marked-/auktionsfrys som app_config-flag (bruges ved hvert skifte og ved inciden |
| #2964 | 2026-07-25 | aldrig | priority:med, type:feature, cat:infra | [infra] Fuldt PR-preview: backend-preview pr. branch + DB-strategi: ejeren skal |
| #2990 | 2026-07-25 | aldrig | priority:med, type:refactor | refactor(teams): migrer de 10 resterende menneske-hold-queries til humanTeamFilt |
| #3010 | 2026-07-25 | aldrig | priority:med, type:feature | [feature] Prologer mangler eget distance-bånd: enkeltstartens distance-bånd bruges |
| #3087 | 2026-07-27 | aldrig | priority:med, type:feature | [planner etape 3] Mål-løb-modellen: markér de løb du vil vinde, assistenten plan |
| #3112 | 2026-07-28 | aldrig | priority:med, type:bug | [ops] Parallel session slettede ucommitteret arbejde i delt checkout: NOW.md-cl |
| #3139 | 2026-07-30 | aldrig | priority:med, cat:user-feature, type:task | [fair-play/H] Sanktionstrappe, sagsskabelon og spiller-vendte fair play-regler |
| #3147 | 2026-07-30 | aldrig | priority:med, type:feature, cat:user-feature | [feature] Sponsor race-day-udbetalinger løbende i stedet for klumpsum ved sæsons |
| #3153 | 2026-07-30 | aldrig | priority:med, type:feature | [fair-play] Community-flagget transfer 29/7: rytter til nyoprettet hold uden and |
| #3204 | 2026-08-03 | aldrig | priority:med, type:task | [bot] Perf & SEO inbox (rå) |
| #3233 | 2026-08-03 | aldrig | priority:med, type:feature | [fair-play] Sanktioner skal arkivere frem for hård-slette: cascade-sletning fje |
| #3424 | 2026-08-06 | aldrig | priority:med, type:feature | [design] Elevation-restlisten fra #2849: dashboard-idiomer, sparkline-primitiv,  |
| #3444 | 2026-08-06 | aldrig | priority:med, type:feature, cat:user-feature | [design] Division 1 som karakter-peloton: det fremragende endgame (ejer-mandat  |
| #3455 | 2026-08-06 | aldrig | priority:med, type:feature, cat:user-feature | [ux] Vis rytterens træthed i taktik-/rollevalget, ikke kun på daglig træning |
| #3466 | 2026-08-06 | aldrig | priority:med, type:feature, cat:balance | [balance/design] Aldersnedgang skal ske dagligt i stedet for som 28-dages-klippe |
| #3501 | 2026-08-07 | aldrig | priority:med, type:bug | Økonomi: end-to-end audit + forbedringsforslag (kør EFTER 9/8-merge af #3448) |
| #3515 | 2026-08-07 | aldrig | priority:med, type:refactor | [refactor] Board-modul kode-arkæologi + konsolidering (Mandatet fase 0b, ejer-kr |
| #3529 | 2026-08-07 | aldrig | priority:med, type:feature | [feature] Race log pr. rytter: én flade der viser hvilke løb hver rytter i trupp |
| #3543 | 2026-08-08 | aldrig | priority:med, type:investigation, cat:balance | [investigation/balance] Udbruds-udvælgelsen er uigennemskuelig: 10+ forsøg uden  |
| #3647 | 2026-08-11 | aldrig | priority:med, type:feature, cat:user-feature | [design] Skriv kompensations-reglen ned: hvornår holdes en spiller skadesløs? |
| #3656 | 2026-08-12 | aldrig | priority:med, type:investigation, cat:balance | [economy] Loennormalisering: hotfix mod absurd lave OG absurd hoeje loenninger ( |
| #3748 | 2026-08-14 | aldrig | priority:med, type:bug | [ops] Rytterudviklings-scorecardet er ikke en gate - modellen kan drive uden at  |
| #3964 | 2026-08-19 | aldrig | priority:med, type:feature, cat:user-feature | [feature] Byt akademi- og seniorrytter i en handling naar truppen er fuld |
| #4025 | 2026-08-20 | aldrig | priority:med, type:feature | [design] Oekonomisiderne: alt for meget tekst paa fladen - flyt manualprosa til  |
| #4076 | 2026-08-21 | aldrig | priority:med, type:feature | [feature] Staaende ordrer: kvittering + 'goer det til en regel' - een auto-fyld- |
| #4101 | 2026-08-22 | aldrig | priority:med, type:investigation, cat:balance | [investigation] Ingen frie agenter paa 35+ gik paa pension - kun ryttere paa hol |
| #4181 | 2026-08-24 | aldrig | priority:med, type:investigation, cat:balance | [balance/HOEJ] TT-rytteren er ikke bedst til enkeltstart, og rouleuren (en del af  |
| #4206 | 2026-08-24 | aldrig | priority:med, type:bug, cat:balance | [balance/HOEJ] mange ryttere har identiske stats i alle 14 felter - over ha |
| #4327 | 2026-08-27 | aldrig | priority:med, type:refactor | [refactor] Typet Supabase-klient i backend (vejen til at pensionere schema-colum |
| #4341 | 2026-08-28 | aldrig | priority:med, type:feature, cat:user-feature | [ux] Peak-markoer mangler i holdudtagelsen - man kan kun se hvem der peaker FOER |
| #4342 | 2026-08-28 | aldrig | priority:med, type:feature, cat:user-feature | [feature] Vis paa traeningssiden om rytteren er udtaget til et loeb - og hvor ma |
| #4355 | 2026-08-28 | aldrig | priority:med, type:bug | [balance] Juni-fyldkuldet (24/6) har samme taktik/hidden_potential-laek som #431 |
| #4358 | 2026-08-28 | aldrig | priority:med, type:feature | [matrix] Eet-kliks-flyt i celle-popoveren naar loebsvalget er laast af overlappe |
| #4367 | 2026-08-28 | aldrig | priority:med, type:feature | [db] Forward-guard: riders.team_id maa ikke aendres uden matchende rider_ownersh |
| #4452 | 2026-08-30 | aldrig | priority:med, type:feature, cat:infra | [security] Rate-limiterne bruger in-memory store: kræver delt store før horison |
| #4488 | 2026-08-31 | aldrig | priority:med, type:feature, cat:balance | [balance] Konverteringsmatrix for rytter-typer: sprint og klatring skal ikke kun |
| #4497 | 2026-08-31 | aldrig | priority:med, type:investigation | [fair-play] Ugescan 31/8: Scuola di Cadenza <-> Koben Racing, 154.885 til samme  |
| #4530 | 2026-08-31 | aldrig | priority:med, type:bug | [ux] Saesonmatrix fast-follow: 'Assign form peak here' i celle-popoveren |
| #4531 | 2026-08-31 | aldrig | priority:med, type:bug | [ux] Saesonplan: drag'n'drop af ryttere mellem loeb med autosave |
| #4543 | 2026-09-01 | aldrig | priority:med, type:bug, cat:balance | [balance] Loebsdags-raten er sat mod et etapetal der ikke gaelder - 205 hold tje |
| #4599 | 2026-09-02 | aldrig | priority:med, type:feature | [races] Dagsform-modifikatorer (løbstype/vejr/land/tidspunkt/formpeak) - backlog |
| #4600 | 2026-09-02 | aldrig | priority:med, type:task | [races] Laas dagsform-replik-data paa server-/RLS-niveau (kun eget hold) - opfoe |
| #4611 | 2026-09-02 | aldrig | priority:med, type:feature, cat:user-feature | [races] Rytterens stemme trin 2: asynkron team radio foer/efter etapen med eet-k |
| #4612 | 2026-09-02 | aldrig | priority:med, type:feature, cat:user-feature | [scouting] Scout et loeb eller en rival: ny missionstype paa data vi allerede ha |
| #4614 | 2026-09-02 | aldrig | priority:med, type:investigation | [race-engine] Nedkoersels-ratioens definition: harness maaler p1-p10, baandet si |
| #4813 | 2026-09-05 | aldrig | priority:med, type:bug, cat:user-feature | [ux/team] Transferhistorik-fanen: raekker med hover men uden link (153/119 doede |
| #4858 | 2026-09-05 | aldrig | priority:med, type:task | [board] Slet gammel BoardPage.jsx 1-2 uger efter Mandatet-flip |
| #4941 | 2026-09-07 | aldrig | priority:med, type:bug, cat:bug | [bug] Autobud sorteres ikke med hoejeste bud oeverst i budlisten (knud_r_flink 6 |
| #4942 | 2026-09-07 | aldrig | priority:med, type:feature, cat:user-feature | [feature] Skades-/styrt-historik for eget hold - spillerne kan ikke se hvor mang |
| #4944 | 2026-09-07 | aldrig | priority:med, type:bug | [ops] 401-byge hver hele time paa HH:17: ~150 afviste presence/online-count-kal |
| #5001 | 2026-09-07 | aldrig | priority:med, type:feature | [harness] renderV4AnchorTable.mjs skriver RACE_ENGINE_RULES.md uden --write; def |
| #5032 | 2026-09-08 | aldrig | priority:med, cat:user-feature, type:task | [messages] DM v1 opfoelgning: CASCADE ved kontosletning vs. aldrig-slet-reglen,  |
| #5061 | 2026-09-09 | aldrig | priority:med, type:feature, cat:user-feature | [feature] Foelg et hold: genvejsliste + notifikation ved etapesejr (knud_r_flink |
| #5067 | 2026-09-09 | aldrig | priority:med, type:feature | [perf] AI-retirement-triggeren koster ~1,7x paa race_entries-inserts ogsaa naar  |
| #5069 | 2026-09-09 | aldrig | priority:med, type:feature | [ops] Skema-tro testharness for SQL-migrationer i stedet for haandskrevne fixtur |
| #5074 | 2026-09-10 | aldrig | priority:med, type:feature, cat:user-feature | [feature] Peak-planlaegning: vaelg hvor i et etapeloeb man topper + eksplicit pr |
| #5104 | 2026-09-10 | aldrig | priority:med, cat:user-feature, type:task | [onboarding] Mål afstanden fra tilmelding til et nyt holds første løb (forudsætn |
| #5115 | 2026-09-10 | aldrig | priority:med, type:feature, cat:user-feature | [feature] Livery: datamodel + designer + mini-troeje i standings/kort/lister + l |
| #5116 | 2026-09-10 | aldrig | priority:med, type:feature, cat:user-feature | [feature] Sponsor-univers: 36 fiktive brands (wordmark, palet, tier) + sponsor_k |
| #5117 | 2026-09-10 | aldrig | priority:med, type:feature, cat:user-feature | [feature] Rider genome: gemt deterministisk udseende pr. rytter, aeldning pr. sa |
| #5118 | 2026-09-10 | aldrig | priority:med, type:feature, cat:user-feature | [feature] 3D master-assets (Blender+MPFB, GLTF, toon) + rytterprofil-hero der dr |
| #5119 | 2026-09-10 | aldrig | priority:med, type:feature, cat:infra | [infra] Portraet-batch-render-pipeline: ingen GPU paa Vercel/Railway, WebGL-kont |
| #5151 | 2026-09-11 | aldrig | priority:med, type:refactor, priority:next | [design-kit] Tailwind 4 trin 2/3: migrer spillet (frontend/) fra 3.4 til 4.x + r |
| #5226 | 2026-09-14 | aldrig | priority:med, type:feature | [fair-play] Rapportér en afsluttet auktion som eget objekt (slutpris + budhistor |
| #5243 | 2026-09-14 | aldrig | priority:med, cat:infra, type:task | [ops] Hook: afvis run_in_background i boelge-worktrees (worker ventede 1,5 t paa |
| #5273 | 2026-09-15 | aldrig | priority:med, type:investigation | [ryttere] Fysiologi v2-seed (Task D2) er aldrig koert: aero = NULL paa alle 8.48 |

## Bilag B: ejer-valg og løfter uden plads (sektion 6), fuld liste

Kriterie: ikke nævnt i `MASTERPLAN.md`/`NOW.md` (heller ikke via "Del af #M" til et planlagt issue) og enten ejer-direktiv/ejer-valg/løfte i titlen, eller `priority:high`/`priority:next`/`cat:founder`.

| Issue | Signal | Oprettet | Titel |
|---|---|---|---|
| #519 | next | 2026-05-20 | [refactor] Split backend/routes/api.js i domain routers uden adfærdsændring |
| #671 | high, founder | 2026-05-25 | Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) |
| #941 | founder | 2026-06-02 | Regnskabsprogram: vælg + opsæt |
| #1283 | founder | 2026-06-11 | ToV-session: definér founder-stemmen (ejer-ledet): struktur fra AI, prosa fra Nicolai |
| #1569 | high | 2026-06-20 | Ny-spiller onboarding-audit (2026-06-20): prioriteret handlingsplan |
| #1819 | high | 2026-06-23 | Opfølgning efter præmienedskæringen: bekræft økonomi-coherence + ryd backup |
| #2236 | founder | 2026-07-06 | Organic community outreach: Reddit + Discord posting |
| #2259 | next | 2026-07-10 | [chore] Supabase DB-hygiejne: ryd ~20 backup_*-tabeller + covering-index på unindexed fore |
| #2480 | ejer i titel | 2026-07-16 | Motor-ops: ML-assisteret kalibreringsforslag fra live drift (systemet foreslår, ejer beslu |
| #2557 | high | 2026-07-17 | [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-wi |
| #2645 | ejer i titel | 2026-07-18 | [bug/balance] Peak/loft-beskeder inkonsistente: 'approaching ceiling' ved 29/90+: Del B p |
| #2670 | ejer i titel | 2026-07-18 | [balance] Udvikl-og-sælg: re-mål ROI mod ægte markedsadfærd + ejer-beslutning om ROI-loft |
| #2675 | ejer i titel | 2026-07-18 | [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering: og ejer-va |
| #2682 | high | 2026-07-18 | AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL |
| #2758 | ejer i titel | 2026-07-20 | [ops/rutine] Faste rutiner: Discord-triage → GitHub-issues (dagligt) + done-audit-sweep (u |
| #2759 | ejer i titel, founder | 2026-07-20 | [growth] Start Facebook-annoncer + organisk TikTok-markedsføring (ejer 20/7) |
| #2762 | ejer i titel | 2026-07-20 | [ux/help] FAQ: kategori-inddeling + navigation + oprydning af forældet indhold (ejer 19/7) |
| #2770 | high | 2026-07-21 | [build] Sub-2: Dybe konkurrencer: passage-ordener (KOM/point) + bonussekunder |
| #2820 | founder | 2026-07-23 | [monetization] /founder-supporter siger "betaling er ikke live" mens /pro tager imod betal |
| #2822 | high, founder | 2026-07-23 | [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil |
| #2840 | high | 2026-07-23 | Løn skal være dagsbaseret (rigtige dage): engangstræk ved sæsonstart gør sent købte rytte |
| #2884 | high | 2026-07-25 | [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vindu |
| #3154 | ejer i titel, high | 2026-07-30 | [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriterin |
| #3426 | high | 2026-08-06 | [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerge |
| #3451 | ejer i titel | 2026-08-06 | [feature] Ejer-direktiv 6/8: forum-søgning + markering af ulæste indlæg i tråde |
| #3453 | ejer i titel | 2026-08-06 | [bug] Ejer-direktiv 6/8: /admin/growth er ikke opdateret til dagsdato: tallene skal opdat |
| #3458 | ejer i titel | 2026-08-06 | [design] Ryttertype-fundamentet v2: arketype-generation + skala-aerlighed, ingen tredje ry |
| #3511 | high | 2026-08-07 | [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og mål |
| #3513 | ejer i titel | 2026-08-07 | [epic] Dashboard-rework: Sportsforsiden: fast rygrad + spillerens widget-board (hybrid, e |
| #3517 | ejer i titel | 2026-08-07 | [feature] Forum v1.1: ejer-direktiver 6-7/8: citér-svar m. notifikation, emoji+links, dan |
| #3556 | ejer i titel, next | 2026-08-09 | [ci/quality] Merge queue paa main + flake-karantaene som data (verdensklasse-verifikation, |
| #3624 | ejer i titel | 2026-08-11 | [investigation] Ejer-direktiv 10/8: løb starter ofte senere end det tidspunkt der står på  |
| #3659 | ejer i titel | 2026-08-13 | Ejer-direktiv 13/8: goer udvikling, traening og lofter forstaaeligt i UI: forslag foerst |
| #3660 | ejer i titel | 2026-08-13 | Ejer-direktiv 13/8: UX-gennemgang af hele siden: kan spilleren stole paa det de ser? + ve |
| #3709 | ejer i titel | 2026-08-14 | [design] Rytterudvikling og traening: taget og raten skilles ad: 13 ejer-beslutninger + s |
| #3756 | ejer i titel | 2026-08-14 | [balance] Gebyr paa hoeje auktions-startpriser (ejer-beslutning 15/8) - gated af #3755 |
| #3950 | ejer i titel | 2026-08-18 | [feature] Resultat-botten poster etape-resultater i divisionskanalerne (ejer-go 18/8) |
| #4010 | high | 2026-08-20 | Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() pr |
| #4109 | ejer i titel | 2026-08-22 | Ejer-direktiv 21/8: Planlaegning-fladen - for mange faner og klik, anti-AI-slop-gennemsyn |
| #4159 | high | 2026-08-23 | [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-packer-fix  |
| #4176 | ejer i titel | 2026-08-24 | Ejer-direktiv 24/8: samle ALLE kalender-regler i én SSOT + gate dem, saa de ikke skal laer |
| #4268 | ejer i titel | 2026-08-26 | Ejer-direktiv 25/8: roller i spillet - Admin, Moderator, Beta tester |
| #4271 | ejer i titel | 2026-08-26 | Ejer-direktiv 25/8: formpeaks skal vaere mere forstaaelige |
| #4321 | high, next | 2026-08-27 | [growth] PostHog (EU) som analytics-lag: kanal-attribution, funnels, retention + MCP-adgan |
| #4322 | founder | 2026-08-27 | [growth] AI-assistenter som maalt akkvisitionskanal: ChatGPT er allerede top-5 signup-kild |
| #4521 | ejer i titel, high | 2026-08-31 | Ejer-direktiv 31/8: SSOT for patch notes (site + Discord) + efterkontrol siden 28/8 - foer |
| #4616 | founder | 2026-09-02 | [session] Infisical-session: EUR-planer i Alunta, Railway-noegler, Resend-noegler, checkou |
| #4622 | ejer i titel | 2026-09-02 | [epic] Designsystem til naeste niveau: taste-doc, audit af 63 sider, kit, CI-vagter, Claud |
| #4751 | ejer i titel | 2026-09-04 | Ejer-direktiv 3/9: forum- og social-pakke - klikbare navne, profilbillede, DM/indbakke mel |
| #4765 | ejer i titel | 2026-09-04 | [balance/beslutning inden 11/9] Udviklingshastighed for svagheder: én intern rate |
| #4812 | ejer i titel, next | 2026-09-05 | [ci] dependabot-auto-merge.yml er sandsynligvis doed af samme aarsag som #4404 - tredje me |
| #4814 | ejer i titel | 2026-09-05 | [design/beslutning] Rytterprofilens foto-plads uden feature + skyggerne paa /seasons (doku |
| #4820 | ejer i titel | 2026-09-05 | Ejer-direktiv 4/9: indholdsplan for forum-indlaeg (9 emner) + spoergeskema til spillerne |
| #4831 | ejer i titel | 2026-09-05 | [balance] Traeningsrater kalibreres saa +1-loftet pr. dag naesten aldrig binder - langsigt |
| #4850 | ejer i titel, high | 2026-09-05 | [Epic] Traening pr. loebsdag - loebsdagen bliver tick-enheden, live senest S4 28/9 (ejer-g |
| #4852 | ejer i titel | 2026-09-05 | [traening] D1: Belastning Let/Normal/Haard paa samme session, tempo-varianten (ejer-go 6/9 |
| #4853 | ejer i titel | 2026-09-05 | [traening] D2: Holdpas variant 2 rollefordelt (fem paktyper, ingen bonus) (ejer-go 6/9) |
| #4854 | ejer i titel | 2026-09-05 | [traening] D3: Traetheds-graense - holdregel plus undtagelse pr. rytter (ejer-go 6/9) |
| #4914 | high | 2026-09-06 | [engine-v4] Kalibreringspakke foer flip: holdspil-gab, M12 all_out/grupetto, feltspredning |
| #4955 | ejer i titel | 2026-09-07 | [omdoemme] PR 2: backfill --apply + flag shadow + 7 dages natlig audit (ejer-go pr. trin) |
| #4964 | high, founder | 2026-09-07 | [growth] Launch-kohorten holder 28,6 % mens etablerede holder 86,8 % - og signups faldt 20 |
| #4985 | ejer i titel | 2026-09-07 | [feature] Gruppér enslydende beskeder i indbakken paa tvaers af flere haendelser (ejer 7/9 |
| #5031 | ejer i titel | 2026-09-08 | Ejer-direktiv 7/9: ryd op i admin-funktioner der aldrig bruges eller er blevet overfloedig |
| #5131 | ejer i titel, high | 2026-09-11 | Ejer-direktiv 10/9: hele hjemmesiden skal hastighedsoptimeres OG mobiloptimeres (paraply + |
| #5151 | next | 2026-09-11 | [design-kit] Tailwind 4 trin 2/3: migrer spillet (frontend/) fra 3.4 til 4.x + radius-konv |
| #5157 | next | 2026-09-11 | [process] To drafts aeldre end en maaned (#3512, #4736): faerdig eller luk + 14-dages draf |
| #5256 | ejer i titel | 2026-09-15 | [balance] Taktik vægter med på holdtidskørsel ved en fejl - ejeren vil fjerne det sammen  |
| #5327 | high | 2026-09-17 | [ryttere] Faerdiggoer PR #3512 arketype-prior: WIP-cherry-pick, groen test, foer/efter-for |
| #5348 | ejer i titel | 2026-09-17 | [evner] Holdarbejde i loebsmotoren v4 bag flag teamwork_in_engine + harness-gate H6 + kemi |
| #5349 | ejer i titel | 2026-09-17 | [evner] Lederskab: mentorpar (data + flader) + mentor-delta bag flag mentor_pairs_enabled  |
| #5382 | high | 2026-09-18 | [balance] Dobbelthop mellem divisioner efterlader hold uden oekonomisk fodfaeste |
| #5443 | ejer i titel, high | 2026-09-20 | [epic/economy] Vaerdisystemet faerdigt: rigtig type for alle, omregnet formel, kvittering, |
| #5480 | ejer i titel | 2026-09-22 | [feature] Faelles kalender-varianter + proveniens for S4 - ejerbeslutning (22/9) |
| #5485 | ejer i titel, high | 2026-09-22 | [design] Traeningssiden: ingen scroll, faner/modals, det mest brugte oeverst, Clarity-data |
| #5507 | next | 2026-09-22 | [ops] Færdig = kan tændes: kontakt-vagt i CI + reviewer slår PR-bodyens påstande op i kode |
| #5573 | next | 2026-09-23 | [design] Holdmødet: sportsdirektørens plan pr. etape - holdplan, angrebspunkt, positioneri |
| #5574 | next | 2026-09-23 | [design] Hvis-så-ordrer i cykelsprog + feltets spil mellem mennesker (lag 4) |
| #5575 | ejer i titel | 2026-09-23 | [epic] Taktik i v4: Holdmødet i 4 lag - sportsdirektørens beslutninger (ejer 23/9) |
| #5678 | next | 2026-09-24 | [ops] Session-hygiejne: haard graense for sessionslaengde, close-out som fast blok, prompt |
| #5681 | ejer i titel, next | 2026-09-24 | [ops] Anonymiser Discord-brugernavne i gamle issues og kommentarer (efter saesonskiftet, e |
| #5757 | ejer i titel | 2026-09-25 | [board] Tilliden er maettet foer Mandatet gaar til alle: 191 af 251 hold paa 100, 44 paa 0 |
| #5833 | ejer i titel | 2026-09-27 | [design] Pause mellem sæsoner + flyttet slut/start (spillerønske 27/9) - ejer-beslutning t |
| #5841 | ejer i titel, high | 2026-09-28 | [feature] Ejer-direktiv 27/9: kommende sæsons kalender skal kunne ses, og divisionsvalget  |
| #5843 | ejer i titel, high, next | 2026-09-28 | [bug] Ejer-direktiv 27/9: U23- og juniorløbene kan ikke ses før, under eller efter - hvor  |
| #5871 | high | 2026-09-28 | [auktioner] Sæsonskifte-gaten skal kun spærre pensionister/udløbende kontrakter, ikke alle |
| #5876 | ejer i titel | 2026-09-28 | [generator] Nye rytteres nationer skal afspejle virkelighedens cykelnationer (ejer 28/9) |
| #5882 | ejer i titel | 2026-09-28 | [træning] Løbsudvikling efter niveau-match v1 (D-018): løb på rytterens niveau udvikler me |
| #5893 | high | 2026-09-28 | S4 løbsdag 1 hændelse: ungdomsløb, DB-udfald og bestyrelser - rod-årsager + langsigtet pla |
| #5895 | ejer i titel | 2026-09-28 | Bestyrelsesmål for akademiarbejde (eksplicit, valgfrit) - ejer-valg B 28/9 |
| #5898 | ejer i titel | 2026-09-28 | Bestyrelsen ser kun seniortruppen: fælles scope + CI-vagt (ejer-valg B) |
| #5901 | ejer i titel | 2026-09-28 | Bestyrelsens rytme: ét skridt pr. løbsdag eller pr. eget løb? (ejer-beslutning) |
| #5911 | high | 2026-09-28 | Aftentræningen skal være færdig på < 2 min og starte straks efter sidste etape |
| #5912 | high | 2026-09-28 | Genopret 1.759 tabte træningsdage fra 28/9 (kørt før regel A i #5880) |
| #5973 | founder | 2026-09-30 | [growth] Pressekit og afgrænset pilot for redaktionel omtale af Cycling Zone |
| #5978 | high | 2026-09-30 | [investigation/design] v4: GC-trussel og gentagne favorit-udbrud i Soleil skal vurderes ef |
| #6047 | high | 2026-10-01 | Malwarebytes Browser Guard blokerer cyclingzone.org (false positive): indberet 3/10 |
| #6064 | next | 2026-10-02 | [ops] Bølge: hook der håndhæver scope for bølge-agenter deterministisk |
| #6065 | next | 2026-10-02 | [ops] Bølge: drift-audit af subagent-transcripts ved oprydning |
| #6109 | ejer i titel, high | 2026-10-02 | [design] Løb bremser tilbagegangen + stilstandsår: tilbagegang man kan påvirke (ejer 2/10) |
| #6134 | high | 2026-10-03 | Schedulerbudget og holdbar backpressure: rest fra #5900 |
| #6147 | ejer i titel | 2026-10-04 | [ux/nav] Samlet navigationsanalyse mobil + pc med Clarity-data (ejer 4/10, tages 5/10) |
| #6155 | ejer i titel | 2026-10-04 | [design] Akademisiden efter U23/Junior-siderne: rytterlisten ud (ejer 4/10) |
| #6157 | ejer i titel | 2026-10-04 | [race-engine] Trin 0: tjek hvad der er loest i v4 + kvalitetsopfoelgning paa motoraendring |
| #6164 | ejer i titel, high | 2026-10-04 | [market] Ryd op bagud: haengende tilbud + transferliste og tilbud fra inaktive managers (e |
| #6165 | ejer i titel | 2026-10-04 | [perf] Bundle-loft der maaler det spilleren henter: foerste indlaesning + pr. stykke, tota |
| #6184 | high | 2026-10-05 | [drift] PostgREST dræber ca. 3.000 forespørgsler i døgnet ('Thread killed by timeout manag |
| #6190 | ejer i titel | 2026-10-05 | [evner] Ro under pres + træningsdisciplin som mentale egenskaber (planlagt uge 43-46, ejer |
| #6203 | ejer i titel | 2026-10-05 | [roadmap] Søgefunktion på roadmappet for spillerne (ejer 5/10) |
| #6204 | ejer i titel | 2026-10-05 | [roadmap/admin] Faner, filtre og sortering i roadmap-admin (ejer 5/10) |
| #6205 | ejer i titel | 2026-10-05 | [ops/roadmap] MASTERPLAN, roadmap og roadbook i sync, tæt på automatisk (ejer 5/10) |
| #6212 | ejer i titel | 2026-10-05 | [comms] Patch notes: fast struktur til Discord, ensartet og i ejerens tone of voice (denne |
| #6272 | high | 2026-10-06 | [ops] Database-alarm: ekstern overvågning af /api/health med rigtig DB-forespørgsel, push  |
| #6273 | high, next | 2026-10-06 | [perf] Mål API-svartider omkring etape-tick → beslut worker-service (uge 42 eller 44) |
| #6275 | high, next | 2026-10-06 | [perf/10x] Lasttest på staging: 10 × dagens peak, før 25/10 og ved hver større release (re |
| #6299 | high | 2026-10-07 | [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbru |
| #6319 | high | 2026-10-07 | [comms] Svar-side v2 til 8/10: lær af ejerens rettede svar, find nye ubesvarede, påmind om |
| #6324 | high | 2026-10-07 | [bug] Roadmap: spillernes 'god idé'-stemmer blev ikke flyttet med til de nye punkter ved r |
| #6351 | high | 2026-10-08 | [race-ui] Vis hvilken regelversion et løb kører på |
| #6369 | high | 2026-10-08 | [epic] S5-etapeprofiler: typen af ruten, mellembjerg, nye finaler, to akser, benchmark |
| #6493 | next | 2026-10-11 | Én delt TS-pakke til logik, som frontend og backend begge bruger (slut med kopier + parite |
| #6495 | high, next | 2026-10-11 | Store sider deles op efter T1-T3 + ratchet på sidestørrelse (+ ESLint React 19, strukturer |
| #6496 | ejer i titel, next | 2026-10-11 | Tekniske standarder 11/10: samle-issue (6 punkter, ejer-godkendt) |
| #6514 | ejer i titel | 2026-10-12 | [bug] Resultatarkivet: søgning finder kun enkelte løb (ikke Tour de l'Hexagone/Vuelta Iber |
| #6548 | high | 2026-10-12 | [ops] "Hvad brænder"-vagten: daglig rapport kl. 08 (GitHub Action + fast issue) |
| #6553 | high | 2026-10-13 | [release-gate] Beta → færdigt spil: tjekliste, dato S6-start |
| #6554 | high | 2026-10-13 | [growth] S5-mail 24/10 til sovende spillere med samtykke (send kun på ejerens endelige go) |
| #6569 | high | 2026-10-13 | [perf] Dashboard: "Dagens etaper" venter 1-2,6 s på resten af siden + vandfald + skelet-bl |
| #6571 | next | 2026-10-13 | [S5+] Ruter på rigtige højdedata (Copernicus/SRTM): licens, kilde og arkitektur |
| #6604 | high | 2026-10-14 | deps: ryd alle major-efterslæb i dag (ESLint 10 marketing, React-config, Sentry 11, @verce |
| #6616 | high | 2026-10-14 | [ops] Bølger uden ekstra runde: preflight = CI static-guards + review-loop i lanen |
| #6666 | high | 2026-10-15 | [design] Akademi-optag 2.0: hent ugens kuld, lær prognosen gennem træning, klubprofil via  |
| #6667 | ejer i titel, high | 2026-10-15 | [S5] U23/junior uden S4's fejl: løftet AI-ungdom, samlede grupper, flere U23-løbsdage, nye |
| #6668 | ejer i titel, high | 2026-10-15 | [S5] AI-ungdom løftes til menneskeholdenes niveau + menneskehold samles i færre grupper (d |
| #6706 | high | 2026-10-16 | [beta] Automatisk besked til beta-testere når en funktion går i beta (indbakke + Discord + |
| #6765 | high | 2026-10-17 | [perf/10x] Rangliste-matviews genberegner hele historikken: 15,7 s/runde ved prod-volumen, |
| #6862 | high | 2026-10-18 | [ops] Audit: sommer-/vintertid i alle tidsafhængige job og visninger (mandag 19/10, før DS |
| #6864 | high | 2026-10-18 | [ops] PR-CI under 10 min: målt baseline mandag 19/10, byg tirsdag 20/10 |
| #6871 | high | 2026-10-18 | [ui] Automatisk beta-mærkning: menu viser beta i området + beta-tegn foran funktionen (reg |
| #6872 | high | 2026-10-18 | [races] Løbsbibliotek: Grand Tour-tærskel (>=15 etaper) i racePeek + rute-fallback til æld |
| #6883 | ejer i titel | 2026-10-19 | [balance] Næsten ingen ryttere har GC som bedste rating, og træning kan ikke få dem derhen |
| #6886 | next | 2026-10-19 | [ai-ops] Planlagte rutiner ligger kun lokalt på én PC - versionér prompterne i repoet + sy |
| #6887 | next | 2026-10-19 | [obs] 29 × 'Script error.' i Clarity pr. uge uden detaljer - find kilden og gør fejlen læs |
| #6888 | next | 2026-10-19 | [obs] Konvention for kendte/afgjorte Sentry-alarmer (link til beslutning + arkivér til esk |
| #6889 | next | 2026-10-19 | [obs] Clarity custom tags (spiller-alder, Pro, sideskabelon) så friktionsfund kan segmente |
| #6890 | next | 2026-10-19 | [ai-ops] Samlet session: forbedringer af triage-rutinerne (uge 44, efter sæsonskiftet) |
| #6914 | high, next | 2026-10-19 | [motor] Race engine til verdensklasse: rigtige data, obligatorisk testport, løbsfilm-genne |
| #6915 | next | 2026-10-19 | [ux] Tastaturgenveje + kommandopalet (Mod+K) med TanStack Hotkeys |
| #6916 | high, next | 2026-10-19 | [mobil] Mobil 10x: native-følelse, tommelfinger-navigation, øjeblikkelige sider, én-tommel |
| #6917 | next | 2026-10-19 | [fundament] Driftssikkerhed, kvalitetsstige og fart ved 10x (verdensklasse spor 1) |
| #6918 | next | 2026-10-19 | [desktop] Desktop 10x: cockpit, hover-forhåndsvisning, regneark-tabeller, træk-og-slip |
| #6919 | next | 2026-10-19 | [vækst] Første 10 minutter, del og vind, smarte notifikationer, AI-assistent |
| #6923 | next | 2026-10-19 | [roadmap] Roadmap og known issues: leveret fra patch notes, din rapport → rettet, 'i gang' |
| #6935 | ejer i titel, high | 2026-10-20 | [kvalitet] Spil-dækkende gennemgang: fjern information der kan være forkert (ejer-princip  |
| #6940 | ejer i titel | 2026-10-20 | [motor] Gruppetto-ordre: ingen udbrud, energibesparelse efter etapetype (ejer-løfte 1/10) |
| #6942 | ejer i titel | 2026-10-20 | [ai-ops] Anti-feature-liste: hvad laves aldrig/først 2028, og hvad tidligst januar 2027 (e |
| #6944 | ejer i titel | 2026-10-20 | [akademi] Manageren vælger hvilken aldersgruppe nye talenter søges i (ejer 20/10) |
| #6950 | ejer i titel | 2026-10-20 | [økonomi] Kløften mellem rige og fattige hold: catch-up-mekanik (ejer-løfte 28/9 + 1/10) |
| #6958 | ejer i titel | 2026-10-20 | [roadmap] Afstemningen har for mange og uklare spørgsmål: rotér, så man ser færre ad gange |
| #6976 | ejer i titel | 2026-10-20 | [design] Nyt design (beta-preview): billeder er klemt (ejer 15/10) |
| #6984 | high | 2026-10-20 | [design] Form og træthed 2.0: spillernes kravspec (træthed pr. etapetype, sæsonbelastning, |
| #7004 | ejer i titel | 2026-10-21 | [feature/træning] Træning skal føles øjeblikkelig: i dag køres træthed og form først i aft |
| #7006 | ejer i titel, founder | 2026-10-21 | [proces] Ejer-princip 20/10: ingen 90%-færdige kommer-snart-løsninger, større sikkerhedsne |
| #7018 | high | 2026-10-21 | security: afhængigheds- og sikkerhedstjek 21/10 (Node 24.22.1, Next/React RCE-advisories) |
| #7096 | ejer i titel | 2026-10-23 | [bestyrelse] Ungdomsresultater (U23/junior) tæller i vurderingen af ungdomsarbejdet, ikke  |
| #7111 | high | 2026-10-23 | [idé] Scouting som jagt: scout-missioner med krav |
| #7136 | ejer i titel, high, founder | 2026-10-24 | [investigation] Ejer-direktiv 23/10: tjek om ansatte automatisk bliver opsagt, når hold bl |
| #7137 | ejer i titel, high, founder | 2026-10-24 | [feature] Ejer-direktiv 23/10: ranglisten skal vise sejre (samlede, klassikere, i alt) |
| #7138 | ejer i titel, high, founder | 2026-10-24 | [balance] Ejer-direktiv 23/10: kontrakter kan maks. forlænges 2 sæsoner frem (fra S5) |
| #7167 | high | 2026-10-24 | [bestyrelse] Gennemgang med ejeren i S5 uge 1: virker bestyrelsen efter hensigten, og form |
| #7197 | high | 2026-10-25 | [ops] Forum-opslag til sæsonskiftet: før 20:30, når S4 er lukket, når S5 er klar (med opsu |
| #7236 | high | 2026-10-26 | [motor] Dronningeetaper: nr. 10 kommer 7-13 min efter på bjerg med kort nedkørsel (v2 og v |
| #7247 | high | 2026-10-26 | [quality] System: PostgREST 1.000-loftet må aldrig ramme uopdaget igen (runtime-detektor,  |
| #7248 | high | 2026-10-26 | [audit] Har 1.000-loftet allerede ramt andre steder? Triage af 105 baseline-fund + skadesv |
| #7250 | high | 2026-10-26 | [feature] Automatisk påmindelse før sæsonskiftet (T-7 og T-48 t) i stedet for manuelt scri |
| #7335 | ejer i titel | 2026-10-29 | [feature] Automatisk info-bjælke i spillet når løbene er sat på pause (egomadsen + ejer 28 |
| #7336 | high | 2026-10-29 | [ops] Byggestop i admission (følg til dørs, Task 1-2) |
| #7339 | high | 2026-10-29 | [bug] Auto-fyld satte for få ryttere på ved S5-løbsdag 28/10 (did_not_start under gulv 6) |
| #7367 | high | 2026-10-30 | [deps] Genbesøg @vercel/og/satori-opgradering når en fungerende version findes |
| #7418 | ejer i titel | 2026-10-31 | [taktik] Luksushjælper: mål effekten i S5 og foreslå forbedringer (ejer-løfte 27/10) |
| #7467 | ejer i titel | 2026-11-01 | [ux] Beskeder åbner på "Skal handles" + dagens etape på forsiden (ejer-godkendt 18/10, uds |
| #7476 | high | 2026-11-01 | Til dørs 1/11: opfølgning (eneste indgang til alt aftalt i sweepen) |
| #7492 | high | 2026-11-02 | [ops] Backlog-sweep 2026-11: Codex-ledger (4 lanes, DolmerPC) |
| #7526 | high | 2026-11-02 | [ops/design] Server-side auto-merge for lavrisiko-PR'er (policy-as-code), så nætter kan me |
| #7583 | ejer i titel | 2026-11-03 | [ops] TypeScript-retning: spejderregel + filer med flest fejl til .ts én ad gangen (ejer-g |
| #7626 | ejer i titel, high | 2026-11-04 | [ux] Ejer-direktiv 2026-11-03: dashboard - vis kun store nyheder, flyt årsmøde og sæsonbjæ |
| #7694 | ejer i titel, high, founder | 2026-11-05 | [investigation] Ejer-direktiv 2026-11-04: forbedringsforslag ud fra egomadsens forslagstrå |
| #7695 | ejer i titel, high, founder | 2026-11-05 | [investigation] Ejer-direktiv 2026-11-04: forbedringsforslag ud fra 14 dages #staff-chat |
| #7701 | high | 2026-11-05 | [løbsfilm] Udgåede ryttere får forkert eller ingen årsag i referat og på løbssiden |
| #7719 | high | 2026-11-05 | [motor] Årsags-krav i testene: ingen rytter må tabe meget tid eller udgå uden hændelse med |
| #7720 | high | 2026-11-05 | [motor] Sandhedsvagten skal kunne stoppe tænding: ren på rigtige etaper før motor-kør |
| #7733 | high | 2026-11-05 | [motor] Planryttere uden resultatrække: hvor blev de af? (41 på 7 dage) |
| #7830 | ejer i titel | 2026-11-07 | [balance] Ryttere udgår på enkeltstarter: skal det kun kunne ske ved styrt? (ejer 6/11) |
| #7856 | ejer i titel | 2026-11-07 | [taktik] Hunter og fri rolle samles til Fri rolle (ejer 7/11) |
| #7880 | ejer i titel | 2026-11-07 | [taktik] Taktik for mange etaper på én gang: planer der arves (ejer 7/11) |
| #7886 | ejer i titel | 2026-11-07 | [ux] Tabeller på telefonen: nyt forslag (ejer 7/11) |
| #7890 | high | 2026-11-07 | [motor] Generalprøve af motoren før Tour de l'Hexagone 8/11 kl. 15 |
| #7932 | ejer i titel | 2026-11-09 | [ejer 9/11] Ungdomstrupper, prognose-ord, scout-knap og favoritter |
| #7941 | high | 2026-11-09 | [ops] Discord-kanalen for ops: hvad skal derind, og hvem håndterer det |
| #7950 | high | 2026-11-09 | [træning] AI-hold træner ikke: fast træthed og form, ingen daglig træning |
| #7953 | ejer i titel, high | 2026-11-09 | [ux] Holdsiden løftes: alle trupper, sæsonhistorik og transfers; managersiden bliver en æg |
| #7993 | high | 2026-11-11 | [kvalitet] Selvskærpende kvalitetssystem for hele hjemmesiden (a11y, Lighthouse, fuld genn |
| #7999 | high | 2026-11-11 | [perf] Bundle-diet: én stor gennemgang + loft pr. side der kun kan strammes |
| #8008 | high | 2026-11-11 | [perf/5x] Dashboard: ét samlet kald i stedet for ~10 separate |
| #8012 | high | 2026-11-11 | [perf/5x] Slå React Compiler til (automatisk memoisering), trinvist |
| #8016 | high | 2026-11-11 | [ux/beta] Auto-accept for køber: tydelig auto-pris og to klart adskilte valg (bud vs. star |
| #8034 | ejer i titel, high | 2026-11-12 | [trupper] Nye trupgrænser 30/30/30, højst 60 i alt, vist som midlertidige (ejer 9/11 + 12/ |
| #8035 | ejer i titel | 2026-11-12 | [ux] Markér flere ryttere og flyt med højreklik i alle trupvisninger (ejer 9/11) |
| #8039 | ejer i titel | 2026-11-12 | [ops] Regel-oprydning 12/11: NOW.md-budget, byggestop-liste og close-out pr. commit (ejer- |
| #8055 | high | 2026-11-12 | [bot] Playwright Smoke rød på main (nightly) |
| #8069 | ejer i titel, high | 2026-11-12 | [design] Designløftet: ét udseende på web, mobil og app, faste regler og fast proces (saml |
| #8070 | high | 2026-11-12 | [design] Dagens designregler skrives ind i TASTE.md og PAGE_TEMPLATES.md (ejeren godkender |
| #8077 | ejer i titel, high | 2026-11-12 | [motor] Motoren uden lodtrækninger: udfald følger af energi, taktik, evner og løbets forlø |
| #8081 | high | 2026-11-12 | [akademi] Ét samlet designvalg for akademiet (regnskab, rejsen, optag) |
| #8126 | high | 2026-11-13 | [docs] Funktionsregistret, statustavlen og masterplanens statuslinjer rettes til prod efte |
| #8129 | ejer i titel | 2026-11-13 | [roadmap] Roadmap-pakke 13/11: holdplaner-dublet, trupgrænser, løbssiden og fire koblinger |
| #8143 | high | 2026-11-13 | [perf/fundament] Serverens vej til databasen: mål ventetiden, direkte forbindelse og hent  |
| #8152 | ejer i titel | 2026-11-13 | [bug] Forsiden viser vinder og tilmeldte ca. 7 sekunder for sent, når det valgfrie profil- |
| #8180 | high | 2026-11-15 | [motor] Peak-signalet afkortes i store felter: de sidste hold får ingen træningsrækker |
| #8206 | high | 2026-11-15 | Hooks springer over naar cwd ikke er repo-roden (relative stier i settings.json) |

## Bilag C: uden område-label (sektion 3), 465 issues

Område-label = `cat:*`, `slice:*`, `epic:*`, `security` eller `brand`. Numre sorteret:

#450, #479, #481, #908, #986, #1099, #1182, #1208, #1293, #1299, #1301, #1441, #1461, #1819, #1875, #1997, #2153, #2161, #2217, #2218, #2222, #2223, #2227, #2230, #2259, #2261, #2270, #2398, #2399, #2409, #2487, #2488, #2489, #2490, #2492, #2493, #2494, #2495, #2667, #2669, #2670, #2675, #2720, #2749, #2751, #2838, #2840, #2893, #2906, #2923, #2990, #2991, #2997, #3087, #3109, #3204, #3395, #3424, #3501, #3511, #3513, #3515, #3517, #3529, #3553, #3556, #3577, #3596, #3629, #3640, #3667, #3668, #3709, #3711, #3743, #3748, #3763, #3767, #3803, #3804, #3839, #3854, #3938, #3939, #3948, #3950, #3955, #3957, #3961, #3970, #3982, #3984, #4005, #4010, #4015, #4016, #4032, #4067, #4073, #4076, #4145, #4146, #4159, #4164, #4176, #4195, #4197, #4211, #4214, #4220, #4355, #4358, #4367, #4423, #4433, #4512, #4514, #4530, #4531, #4535, #4537, #4600, #4646, #4765, #4850, #4852, #4853, #4854, #4858, #4914, #4915, #4916, #4944, #4955, #4957, #4958, #5001, #5067, #5068, #5069, #5087, #5151, #5157, #5177, #5179, #5218, #5225, #5238, #5271, #5273, #5275, #5283, #5425, #5436, #5480, #5485, #5490, #5491, #5507, #5515, #5591, #5657, #5681, #5683, #5989, #6065, #6115, #6147, #6164, #6165, #6171, #6175, #6181, #6182, #6184, #6212, #6230, #6232, #6234, #6291, #6293, #6303, #6319, #6323, #6324, #6336, #6351, #6358, #6369, #6470, #6472, #6476, #6490, #6491, #6492, #6493, #6494, #6495, #6496, #6497, #6545, #6548, #6553, #6554, #6558, #6563, #6569, #6571, #6572, #6573, #6579, #6583, #6584, #6601, #6604, #6616, #6617, #6618, #6666, #6667, #6668, #6706, #6718, #6727, #6782, #6783, #6804, #6828, #6836, #6838, #6845, #6851, #6862, #6864, #6865, #6866, #6867, #6868, #6871, #6872, #6915, #6916, #6917, #6918, #6919, #6923, #6935, #6940, #6942, #6943, #6944, #6945, #6947, #6950, #6951, #6952, #6953, #6954, #6955, #6956, #6958, #6960, #6966, #6969, #6972, #6976, #6978, #6994, #6998, #7041, #7078, #7084, #7089, #7091, #7093, #7097, #7102, #7106, #7109, #7110, #7111, #7146, #7167, #7173, #7186, #7197, #7210, #7211, #7214, #7257, #7260, #7262, #7266, #7290, #7293, #7294, #7297, #7298, #7308, #7315, #7322, #7323, #7324, #7325, #7326, #7327, #7329, #7336, #7337, #7339, #7356, #7365, #7367, #7370, #7371, #7372, #7373, #7389, #7390, #7410, #7417, #7418, #7419, #7440, #7455, #7461, #7464, #7465, #7467, #7468, #7469, #7470, #7471, #7474, #7476, #7492, #7495, #7526, #7583, #7588, #7629, #7630, #7631, #7632, #7649, #7663, #7664, #7666, #7682, #7700, #7701, #7708, #7714, #7715, #7716, #7718, #7719, #7720, #7721, #7722, #7732, #7737, #7738, #7739, #7740, #7742, #7743, #7744, #7747, #7748, #7749, #7754, #7756, #7778, #7789, #7791, #7793, #7794, #7795, #7796, #7822, #7832, #7855, #7856, #7859, #7860, #7861, #7862, #7863, #7864, #7865, #7866, #7868, #7869, #7871, #7872, #7880, #7884, #7885, #7886, #7890, #7904, #7911, #7917, #7919, #7932, #7971, #7982, #7988, #7990, #7993, #7994, #7995, #7996, #7997, #7998, #7999, #8000, #8001, #8003, #8005, #8008, #8009, #8012, #8013, #8016, #8018, #8019, #8023, #8049, #8055, #8069, #8070, #8071, #8072, #8073, #8074, #8075, #8076, #8077, #8081, #8082, #8083, #8084, #8085, #8086, #8087, #8088, #8090, #8100, #8101, #8115, #8120, #8124, #8126, #8129, #8143, #8149, #8150, #8152, #8153, #8157, #8162, #8198, #8215
