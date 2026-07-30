# -*- coding: utf-8 -*-
"""Fil GitHub-issues fra Discord-ugesweep 2026-07-30 (dedupet + adversarielt verificeret).
Kørsel: python scripts/discord/.file-issues-2026-07-30.py
Idempotens: tjekker via gh search om titlen allerede findes før oprettelse.
"""
import subprocess, sys, tempfile, os, json, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
G = "1504615050831466669"
SWEEP = "Ugesweep 2026-07-30 (`scripts/discord/.sweep-2026-07-30.md`, cutoff 23/7 00:00 UTC)."

ISSUES = [
dict(
title="[feature] Off-season: 1 dags buffer mellem sæsonslut og næste sæsonstart",
labels=["enhancement","cat:user-feature","needs-decision","claude:todo"],
body=f"""## Kilde
Discord #feedback-and-ideas ("Season planner virtually useless right now :(", https://discord.com/channels/{G}/1530824671443030117, @thelamba 26/7) + #questions-and-answers (https://discord.com/channels/{G}/1521446924975083520, @thelamba 25/7, @valverde4ever_37726 enig). {SWEEP}

## Ønske
Sæsonen slutter søndag aften og næste sæson starter mandag — reelt har managerne kun mandag morgen til at planlægge hele den nye sæson (planner, lineups, sponsorvalg, kontrakter). Forslag: mindst én dags "off-season" mellem sæsonerne, hvor kalenderen for næste sæson er synlig og planneren kan bruges, men ingen løb køres.

> "I really think we should have a day's off-season so there's any time at all to actually work with this."
> "it basically means you only have Monday morning to set up the new season. That does not feel great."

## Analyse
Rammer direkte S1→S2-erfaringen 26-27/7 (DB-pres, låste ryttere, planner der viste forkert division — #3018). En bufferdag ville også aflaste driften ved sæsonskiftet (cutover-verifikation uden live-løb). Ejer-beslutning: længde (1 dag?), om AI-motorer pauser, og om det koster en kalenderdag.

## Relaterede
#3018 (planner viste forkert divisions-kalender) · #2752/#2361 (sæsonafslutnings-indhold/ritual) · #2846 (S2-cutover-verifikation)
"""),
dict(
title="[bug] Bestyrelsens 5-års-plan tæller ikke stjerne-ryttere som bestyrelsen selv anerkender",
labels=["bug","cat:bug","claude:todo"],
body=f"""## Kilde
Discord #feedback-and-ideas ("Renown"-tråden, https://discord.com/channels/{G}/1529223008932069497, @adorable_chipmunk_89342 28/7, 2 screenshots). {SWEEP}

## Rapport
Bestyrelsen anerkender to ryttere som havende nok point til at tælle som "stjerner" — men samme bestyrelses 5-års-plan tæller dem ikke med ("the same board seems to forget it in the 5-year plan").

> "According to my board, I have two star riders with enough points for them to acknowledge as stars. But the same board seems to forget it in the 5-year plan"

## Analyse
Sandsynligvis to forskellige tællinger/kilder for "stjerne-rytter" i board-modulet (anerkendelses-visning vs. 5-års-plan-mål). Find begge beregninger og saml dem på én SSOT. Bemærk: IKKE samme rod som #1208 (star-score frossen på uci_points) eller #2261 (High profile rammer middelmådige) — dette er en intern inkonsistens mellem to board-flader.

## Relaterede
#1208 · #2261 · #2723 (renown usynligt udenfor boardroom)
"""),
dict(
title="[bug] Klik på intake-kandidat giver \"rider not found\"",
labels=["bug","cat:bug","claude:todo"],
body=f"""## Kilde
Discord #bugs ("Intake candidates \\"rider not found\\"", https://discord.com/channels/{G}/1532299823913631755, @falcor9014 30/7, 2 screenshots). {SWEEP}

## Rapport
Klik på en akademi-intake-kandidat viser fejlen "rider not found" i stedet for rytterprofilen. Medspiller-hypotese (@friisisch): kandidat-ryttere oprettes først i `riders`-tabellen når de signes/afvises, så profil-lookup'et fejler indtil da.

## Analyse
Enten (a) gør kandidat-kortet ikke-klikbart / vis en kandidat-specifik visning i stedet for rytterprofil-link, eller (b) opret rytter-rækken ved kandidat-generering. Tjek intake-kandidaternes datamodel: findes de i `riders` eller kun i en intake-tabel? Beslægtet fejlklasse: #2627/#2648/#2672 (intake-'offered'-rækker gjorde ryttere usynlige i databasen).

## Relaterede
#2627 · #2648 · #2672 (alle lukkede — intake-synlighed)
"""),
dict(
title="[bug] Intet loft på gentagne kontraktforlængelser — lav løn kan låses til sæson 11+ (academy og senior)",
labels=["bug","cat:bug","cat:balance","claude:todo"],
body=f"""## Kilde
Discord #bugs ("Unlimited contract extension for academy riders", https://discord.com/channels/{G}/1532291063807606786, @friisisch 30/7; @adorable_chipmunk_89342 bekræfter samme adfærd for senior-kontrakter). Ejer-svar i tråden: "Yea thanks! Will absolutely be removed from the game" — dvs. problem+retning er ejer-bekræftet. {SWEEP}

## Rapport
Man kan forlænge en rytters kontrakt igen og igen i samme session og dermed låse en lav løn helt frem til sæson 11+ (testet af rapportøren).

> "it seems as though it is possible to just keep extending the contracts of academy riders"

## Kode-verifikation (fra sweep-analysen)
`POST /api/riders/:id/extend-contract` (backend/routes/api.js ca. 1319-1361) har intet loft på antal forlængelser pr. rytter — kun owner/retired-tjek + løn-stignings-guard (#2237 Lag 2). #2424/PR #2548 clampede kun `contract_length` pr. forlængelse til 1-3 sæsoner; gentagne kald flytter stadig `contract_end_season` ubegrænset.

## Forslag
Cap på hvor langt ude i fremtiden `contract_end_season` må ligge (fx nuværende sæson + 3), håndhævet server-side. Overvej også re-pricing ved forlængelse (løn følger aktuel værdi, ikke gammel kontrakt).

## Relaterede
#2424 (lukket, længde-clamp pr. kald) · #2237 (løn-guard) · #1720
"""),
dict(
title="[bug] Bestyrelsen reagerer begejstret på løb fra en division holdet ikke er i",
labels=["bug","cat:bug","claude:todo"],
body=f"""## Kilde
Discord #bugs ("Board ecstatic over races I didn't partake in", https://discord.com/channels/{G}/1531768877627871343, @thelamba 28/7, screenshot). {SWEEP}

## Rapport
Manager i Division 2 ser bestyrelsen reagere begejstret på 3 løb, som er Division 3-løb holdet slet ikke deltog i.

> "Those 3 are Division 3 races. I'm in division 2. Why is the board so happy about that?"

## Analyse
Uafklaret om det er en visningsfejl eller reel krydskontaminering i board-reaktions-datagrundlaget (fx division-/tier-ufiltreret query efter S2-oprykningerne). Tjek om board-reaktioner filtrerer på holdets egne entries eller på divisionens/gruppens løb. Beslægtet mønster: #3095 (board-mål injiceres uden tier-tjek).

## Relaterede
#3095 · #3070 (ryttere låst i forrige sæsons løb efter oprykning — samme S2-oprykningsbølge)
"""),
dict(
title="[investigation] Solo-enkeltstart: \"ryttere ofres\"/resultater opgives — to tynde rapporter samme dag",
labels=["bug","cat:bug","needs-ai-triage","claude:todo"],
body=f"""## Kilde
Discord #bugs ("Solo Time-trail", https://discord.com/channels/{G}/1531677731329282330, @ez4prebren 28/7, 2 screenshots) + #dansk-snak (https://discord.com/channels/{G}/1505478569969582182, samme spiller 28/7: "ved solo-enkeltstart der lige er kørt, bliver andre ryttere offret. Bare lige til info"). {SWEEP}

## Rapport
To korte rapporter om samme fænomen fra to kanaler: ved en solo-enkeltstart (ITT) ser ryttere ud til at "opgive"/"blive ofret" på deres egne resultater. Ingen forklarende tekst udover titlerne; screenshots findes i trådene.

## Analyse
Sandsynlig hypotese: sacrifice-/domestique-logik (arbejder-roller) anvendes i ITT, hvor hver rytter burde køre sit eget løb — dvs. rolle-tildeling eller "work for captain"-effekt bør være no-op i solo-TT. Verificér i race-motoren om ITT-simulationen genbruger klassiker-/etape-rollelogik. Start med at se screenshots i trådene for at fastslå symptomet præcist.

## Relaterede
Ingen eksisterende issue dækker ITT-rolle/sacrifice-adfærd (søgt bredt i åbne+lukkede).
"""),
dict(
title="[investigation] Holdværdi driver dagligt nedad for nogle managere (ældre ryttere) efter S2-start",
labels=["type:investigation","cat:balance","claude:todo"],
body=f"""## Kilde
Discord #general (https://discord.com/channels/{G}/1504952590486474805, @chipped26 28-29/7, @valverde4ever_37726 + @friisisch 29-30/7). {SWEEP}

## Rapport
@chipped26: holdets samlede værdi ser ud til at falde hver dag i starten af S2 — særligt ældre ryttere tabte værdi dag 1, steg, og faldt igen. @valverde4ever: modsat billede, hans unge rytteres værdi stiger pænt. @friisisch gætter på resultat-kobling.

> "Is it just me or does team value seem to be going down everyday"

## Analyse
Muligvis helt korrekt adfærd (alders-decay + resultatvægtning i værdimodel v4) — men så er den ulæselig for spillerne. Undersøg: (a) er dag-til-dag-drift for ældre ryttere i S2 inden for forventet bånd, (b) er der en S2-specifik effekt (sæson-alders-bump fra #3071/#3081-klassen) der dobbelt-rammer ældre ryttere, (c) bør rytterprofilen vise værdi-forklaring (alder/form/resultater) så drift ikke føles som en bug.

## Relaterede
#2799 (lukket, v4-outliers) · #2798 (værdimodel læk af skjult potentiale) · #3071/#3081 (sæson-alders-fejlklasse)
"""),
dict(
title="[feature] Sponsor race-day-udbetalinger løbende i stedet for klumpsum ved sæsonslut",
labels=["enhancement","cat:user-feature","needs-decision","claude:todo"],
body=f"""## Kilde
Discord #questions-and-answers (https://discord.com/channels/{G}/1521446924975083520, @snorkalot 28/7; @valverde4ever_37726, @adorable_chipmunk_89342 enige). {SWEEP}

## Rapport
Spillerne kan ikke se at race-day-sponsorpenge er kommet ind og opdager så at udbetalingen (tilsyneladende) først sker senere/ved sæsonslut. Ønske: progressiv udbetaling pr. kørt race-day, ligesom point og præmiepenge.

> "When are the race day profits paid out? Not daily? The sponsor money. I don't think I've received anything yet"
> "Would have loved for that to be a progressive thing instead of an end of season thing"

## Analyse
To-delt: (1) verificér den faktiske udbetalingskadence i koden og dokumentér den i UI/hjælp (spillerne gætter i dag), (2) ejer-beslutning om at ændre kadencen til løbende (bedre feedback-loop + likviditet gennem sæsonen; koster at cash-flow-kurven ændres ift. balancen). Hænger sammen med hele sponsor-informationsproblemet fra ugen (#2889 race-day-definition, #3020 flad cap på tværs af divisioner).

## Relaterede
#2889 · #3020 · #933 (sponsor-økonomi-epic) · #2753 (preview viser gross)
"""),
dict(
title="[docs] Afklar i UI/hjælp: forbedrer scouting-netværket også vurderingen af egne ryttere?",
labels=["documentation","question","claude:todo"],
body=f"""## Kilde
Discord #dansk-snak (https://discord.com/channels/{G}/1505478569969582182, @knud_r_flink 28/7 — ubesvaret i tråden). {SWEEP}

## Rapport
> "Scouting-netværk, gælder det også bedre vurdering af egne ryttere?"

Spørgsmålet blev ikke besvaret — featurens dækning er ikke tydelig i UI eller hjælp.

## Handling
Verificér i koden hvad scouting-netværket faktisk påvirker (kun eksterne/free agents, eller også præcision på egne rytteres viste ratings/potentiale) og skriv svaret ind i help.json (en+da) + evt. tooltip på scouting-siden. Ingen ny mekanik — kun afklaring.

## Relaterede
#2721 (scouting-historik) · #1149/#1109 (scouting-kerne)
"""),
dict(
title="[balance] Etape-evnevægte summer kun til 88% — og ITT-resultater korrelerer ikke synligt med ACC/SPR",
labels=["cat:balance","needs-ai-triage","claude:todo"],
body=f"""## Kilde
Discord #dansk-snak (https://discord.com/channels/{G}/1505478569969582182, @valverde4ever_37726 + @thelamba + @friisisch + @soren1207, 29/7 12:24-12:51 — 4 spillere, ~30 min fælles analyse, 3 screenshots/grafer). {SWEEP}

## Rapport
Spillerne analyserede en enkeltstart og fandt: (1) de spillersynlige procent-vægte for evner på etapen summer kun til 88% — hvad dækker de manglende 12%? (2) ingen synlig sammenhæng mellem ACC/SPR og hvem der overperformer — "min sprinter vinder enkeltstarten" den ikke burde vinde.

> "Når de der % hvor meget hvert egenskab tæller til en etape kun giver 88%.. Skal man så gå ud fra at der er 12% man ikke ved hvad tæller fra?"

## Analyse
To adskilte spor: (a) **Transparens-bug**: hvis visningen normaliserer forkert eller udelader vægte (fx nedkørsel/positionering), skal visningen fikses så den summer til 100% eller eksplicit viser resten. (b) **Balance-verifikation**: kør ITT-harness mod ægte population og mål korrelation mellem viste vægte og faktiske resultater — spillernes observation antyder at ITT-modellen vægter anderledes end det viste. Simulér-før-ship-princippet (#1101-klassen) gælder.

## Relaterede
#2731 (maxRiderWinRate-kalibrering) · #2789/#2771 (lukkede, prolog/distance-gap-model) · #3115 (udbruds-omkostning uklar — samme transparens-familie)
"""),
dict(
title="[bug] Vækst-cap ser ud til ikke at ramme oprykkede ex-akademi-ryttere — +2/session rapporteret",
labels=["bug","cat:balance","needs-ai-triage","claude:todo"],
body=f"""## Kilde
Discord #dansk-snak (https://discord.com/channels/{G}/1505478569969582182, @thelamba + @valverde4ever_37726 + @friisisch, 30/7 05:18-07:20 — 3 uafhængige rapporter, 2 screenshots). {SWEEP}

## Rapport
Ryttere stiger +2 i én evne på én træningssession (spillerne troede cap = +1), og nogle ryttere står på 100% af progressions-baren uden at stige. Spiller-hypotese: udviklings-cappet (indført mod for hurtig ungdomsvækst) rammer kun akademi-ryttere — ikke ryttere der er rykket op i seniortruppen.

> "Troede ikke at man kunne stige +2 længere!"
> "Det Cap der blev lavet på udviklingen, blev det kun lavet på akademiryttere, for så skal det vel også laves til dem der ikke er"

## Kode-verifikation (fra sweep-analysen)
`backend/lib/dailyTrainingEngine.js` (ca. linje 214/239/242): HARD_DAILY_CAP + INTERIM_RATE_MULT styres af `isAcademyAge(age)` (16-21 år), IKKE af akademi-tilhørsforhold — så spiller-hypotesen er teknisk forkert, MEN symptomet (+2/session) er reelt og kan skyldes forkert alders-input efter oprykning (sæson-alders-fejlklassen fra #3071/#3081/#3089) eller en sti uden om cappet. 100%-bar-uden-stigning tyder desuden på afrundings-/visningsfejl i progressions-baren.

## Handling
Reproducér mod prod-data: find rytterne fra screenshots, tjek deres `age`-input i trænings-kørslen og om cappet blev anvendt. Fix rod-årsagen + tilføj invariant-test (max +1/session for 16-21).

## Relaterede
#1938 (lukket, ungdomsvækst-cap) · #3071 · #3081 · #3089 (sæson-alders-fejlklasse)
"""),
dict(
title="[docs] Forklar træningsværdi for færdigudviklede 28+-ryttere — er hvile strategisk bedre?",
labels=["documentation","claude:todo"],
body=f"""## Kilde
Discord #dansk-snak (https://discord.com/channels/{G}/1505478569969582182, @arongreve 30/7 — kun uformelt medspiller-svar). {SWEEP}

## Rapport
> "Når ens ryttere er færdigudviklet i deres træningfokus? [...] er det så ikke bedst bare at køre hvile i træning?"

## Handling
Verificér den faktiske mekanik (påvirker træning form/decline/fastholdelse for 28+ når fokus-evnen er maxet?) og skriv svaret i help.json (en+da) + evt. hint i trænings-UI'et når en rytter er færdigudviklet. Hænger sammen med #2887 (senior-træningsstattens uklare effekt) — overvej at løse dokumentationsdelen samlet.

## Relaterede
#2887 · #2337 (periodisering)
"""),
dict(
title="[design] Bestyrelses-tilfredshed/omdømme opleves som humør-dræber op til sæsonslut-bonus",
labels=["needs-decision","cat:user-feature","claude:todo"],
body=f"""## Kilde
Discord #dansk-snak (https://discord.com/channels/{G}/1505478569969582182, @adorable_chipmunk_89342 28/7 — ejer bad selv om at få det skrevet ud i feedback-kanal; teksten ligger 3x i #moderation-log som forward). {SWEEP}

## Rapport
Spilleren er bekymret for at bestyrelsens omdømme-/tilfredshedsmål trækker humør og en evt. sæsonslut-bonus ned pga. noget der kan være en fejl (jf. stjerne-tælle-inkonsistensen) — "må bestyrelsen finde noget andet at gå op i, så ikke de ødelægger humøret og et evt bonus offer når sæsonen er slut".

## Analyse
Tre sammenhængende problemer gør omdømme-målene til en frustrationskilde: (1) renown er usynligt udenfor boardroom (#2723 — 42/67 hold har signature_rider-mål de ikke kan handle på), (2) board tæller inkonsistent (nyt issue om 5-års-planen), (3) konsekvensen (bonus/humør) rammer ved sæsonslut uden at spilleren har haft handlemulighed undervejs. Ejer-beslutning: skal omdømme-relaterede board-mål neddrosles/gøres bonus-neutrale indtil renown er synligt og beregningen er konsistent?

## Relaterede
#2723 (prio-løft-kandidat jf. NOW.md) · #1208 · #2261
"""),
dict(
title="[fair-play] Community-flagget transfer 29/7: rytter til nyoprettet hold uden anden aktivitet — manuel review",
labels=["epic:fair-play","manual-review","claude:todo"],
body=f"""## Kilde
Discord #transfer-history (https://discord.com/channels/{G}/1522704675722231960, @thelamba 29/7 05:37 UTC, umiddelbart efter bot-posten om transferen). {SWEEP}

## Rapport
> "This transfer to a new club who has done nothing else at all along with this auction is sus imo"

Transferen: Koen Peeters, Borregaard Racing → Liverpool Racing. Flaget: modtagerholdet er nyoprettet og har ingen anden aktivitet.

## Handling (neutral review — ingen konklusion draget)
Manuel gennemgang efter #3131-rammerne: (1) klareringspris vs. medianen (husk #2226-læringen: 0,49× er NORMAL median — lav pris alene er ikke signal), (2) kontienes oprettelses-/aktivitetsmønster, (3) om der er værdioverførsel mellem forbundne konti (det forbudte pr. ejer-beslutning 30/7 — delt IP alene må aldrig flagge). Bemærk at identitets-telemetri (#3132) endnu ikke logger, så IP-evidens er begrænset bagudrettet. Dokumentér resultatet i issuet uanset udfald — community-tippet fortjener et svar.

## Relaterede
#3131 (epic) · #3132-#3139 · #2226 (detektor-spec falsificeret 30/7)
"""),
dict(
title="[ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteringsgennemgang",
labels=["cat:ai-ops","priority:high","claude:todo"],
body=f"""## Kilde
Discord #feedback-from-dolmer (https://discord.com/channels/{G}/1522915781766283296, ejeren 26/7 10:16 UTC). {SWEEP}

## Direktiv (ejerens egne ord)
> "Jeg vil have nedbragt vores backlog til omkring 200 opgaver - Eller færre. Indenfor 7-14 dage."
> "Der har været alt for mange fejl, errors og bugs i en alt for lang periode."

Delmål fra beskeden: (1) luk alle claude:done-issues der er 100% verificerede, (2) ret manglende done-markeringer, (3) find og saml dubletter, (4) fuld prioriteringsgennemgang af GitHub, (5) generelt færre fejl fremover.

## Status ved filing (30/7)
514 åbne issues → mål ~200 = der skal lukkes/samles ~314. Deadline-vindue: 2-9/8. Direktivet var ikke afspejlet i NOW.md/MASTERPLAN — dette issue gør det synligt og sporbart. Værktøj: `github-housekeeping`-skillen (audit + state-maskine-cleanup) + audit-close-aggressive-mandatet (luk verificerede i bulk).

## Foreslået eksekvering
1-2 dedikerede housekeeping-sessioner: done-audit-sweep → dublet-clustering → wontfix/ikke-planlagt-kandidater til ejer-batch-beslutning (A/B-liste, ikke åben liste).

## Relaterede
#2758 (daglig Discord-triage + ugentlig done-audit-rutine) · #605 (token-budget)
"""),
]

created = []
for i, spec in enumerate(ISSUES):
    title = spec["title"]
    # idempotens: findes et åbent/lukket issue med (næsten) samme titel allerede?
    q = subprocess.run(["gh", "search", "issues", "--repo", "NicolaiDolmer/CyclingZone",
                        title.split("] ", 1)[-1][:50], "--json", "number,title", "--limit", "5"],
                       capture_output=True, text=True, encoding="utf-8")
    hits = json.loads(q.stdout or "[]")
    if any(h["title"].strip().lower() == title.strip().lower() for h in hits):
        print(f"SKIP (findes): {title}")
        continue
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(spec["body"])
        path = f.name
    args = ["gh", "issue", "create", "--repo", "NicolaiDolmer/CyclingZone",
            "--title", title, "--body-file", path]
    for lb in spec["labels"]:
        args += ["--label", lb]
    r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8")
    os.unlink(path)
    if r.returncode != 0:
        print(f"FEJL: {title}\n{r.stderr}")
    else:
        url = (r.stdout or "").strip().splitlines()[-1]
        created.append((title, url))
        print(f"OPRETTET: {url}  {title}")

print(f"\n{len(created)} issues oprettet.")
