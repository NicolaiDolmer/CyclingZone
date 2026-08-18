# Sæsonskifte-pakke S2→S3 (#3901)

**Dato:** 2026-08-18 (session) · **Cutover:** søndag 23/8 · **S3 starter:** mandag 24/8 (`seasons.start_date = 2026-08-24`, verificeret Supabase 18/8)
**Ejer-direktiv:** #3901 (17/8, ordret citeret i issuet). Denne fil er IKKE committet — hovedtråden reviewer og beslutter hvad der skal bruges. Intet er postet på GitHub/Discord.

Alt er verificeret mod kode (filsti:linje), git-log (commit-hash), GitHub-issues (nummer + state) eller prod-DB (Supabase MCP, kun SELECT). Hvor jeg ikke kunne verificere, står der "ukendt".

---

## 1. Retrospektiv S1→S2 — "må ikke gentages"-tjekliste

| # | Fund fra S1→S2 | Kilde | Status til S2→S3 |
|---|---|---|---|
| 1a | 22 af 156 hold manglede `season_started`-notifikationen (kun 134/156 fik den 27/7) | #3101 (OPEN), fund 27/7 | **Sandsynligvis afhjulpet, ikke bekræftet.** Root cause pegede på for smal menneske-hold-diskriminator. `emitSeasonStartedNotifications` (`backend/lib/seasonTransition.js:135-193`) bruger nu den FULDE 4-flags-diskriminator (`is_ai=false, is_bank=false, is_frozen=false, is_test_account=false`) — hærdet som del af #2847-fixet (PR #3873, commit `e8d19e9e`, **merged i dag 18/8**). Ingen dedikeret dry-run mod #3101's konkrete "22 af 156"-tal er kørt. **Anbefaling: kør optælling af `notifications type='season_started'` mod eligible-listen dagen efter S2→S3-cutover, FØR issuet lukkes.** |
| 1b | Ingen notifikation nævner sponsorbeløbet — spillerne ved ikke om pengene er landet | #3101 (samme issue) | **IKKE fikset.** Verificeret 18/8: `notif.seasonStarted.message` i `frontend/public/locales/en/backendMessages.json` er stadig "A new season has begun. Check your dashboard for your board's goals and your squad for the season ahead." — intet beløb. Koden (`seasonTransition.js:171-172`) sender stadig kun `SEASON_STARTED_FALLBACK_MESSAGE`, ingen sponsor-parameter. **Reel risiko for S2→S3** — samme spørgsmålsklasse ("er sponsorpengene udbetalt?") vil sandsynligvis komme igen. |
| 2 | Sæsonskiftet nulstiller træthed men bar formen uændret ind i S2 — beslutningen var aldrig truffet | #3096 (stadig OPEN på GitHub, men se status) | **Fikset i praksis, issue ikke lukket.** `app_config.season_form_reset_mode = "decay"` er LIVE i prod (verificeret 18/8 via SQL), med `decay_target=50`, `decay_factor=0.25` — ryttere går ind i næste sæson med formen trukket 75 % mod neutral 50. Bygget via commit `04ae787c` (#3232) + claim-guard `3f76c378` (#3249). **Anbefaling:** luk #3096 med reference til den live config, eller flyt den til `claude:done` — den henstår som åben selvom beslutningen ER truffet og implementeret. |
| 3 | Nye holds starter-kontrakter udløb ved førstkommende sæsonslut — Easy Riders mistede 9 af 12 ryttere dagen efter oprettelse | #3037 (**CLOSED 18/8 i dag**) | **Fikset.** `fix(contracts): starter-kontrakter faar minimum 2 saesoner (#3037)`, commit `7c88bbce` (PR #3882), merged og lukket i dag. Nye hold oprettet sent i en sæson mister ikke længere hele truppen ved næste skifte. |
| 4 | Spillerønske: 1 døgns offseason-buffer så driften har et verifikationsvindue uden løbspres | #3467 + duplikat #3140 (begge OPEN, 0 kommentarer på nogen af dem) | **IKKE besluttet, IKKE bygget.** Verificeret 18/8: `seasons` viser sæson 3 `start_date = 2026-08-24` — samme dag/dagen efter cutoveren søndag 23/8, ingen bufferdag indlagt. Ejeren har aldrig svaret på forslaget. **Reel S2→S3-risiko, samme klasse spillerønske som sidst — går videre uadresseret.** |
| 5 | 61-61-pointtie ved D3-cutlinen blev reelt afgjort af navne-alfabetet, ikke sport (Guds hånd vs. HWT Rockets, 26/7) | #3036 (**CLOSED**, PR #3210, commit `f77afee0`) | **Fikset, men SNÆVERT scopet — ny risiko identificeret 18/8.** Countback-kæden (klassementssejre → etape-podier → bedste etape/GC-placering → navn) ligger KUN i `rankTeamsGlobally` (`backend/lib/pyramidCompression.js:87-136`), som er det ENGANGS-værktøj S1→S2 brugte. Den LØBENDE `rank_in_division`-beregning som S2→S3's STANDARD op/nedrykningsmotor bruger (`backend/lib/economyEngine.js:2544-2566`, `processDivisionEnd`) har **ingen countback** — komparatoren er kun `rightEffective - leftEffective` og returnerer `0` ved lige point, hvilket lader JS's stable sort afgøre rækkefølgen efter objekt-indsættelsesorden (ikke sport, ikke alfabet — reelt vilkårligt). **Samme fejlklasse som #3036 kan gentage sig ved enhver cutline i S2→S3 (D1↔D2, D2↔D3, D3↔D4), fordi S2→S3 kører den STANDARD motor (se afsnit 4), ikke pyramidCompression.** Anbefaling: portér countback-komparatoren ind i `economyEngine.js`'s rank-beregning før 23/8, eller aktivt acceptere risikoen og sige det til ejeren. |

**Supplerende, mindre fund (ikke i ejerens liste, fundet ved gennemgang af `.claude/learnings/`):**
- `season_ended`-notifikationen blev aldrig sendt til spillere uden divisionsskifte (0 rækker nogensinde) — fikset 26/7, #2745 (CLOSED). Ikke en risiko for S2→S3.
- Cutover-drift 26/7 (postmortem `2026-07-26-cutover-in-list-cliff-fk-audit-og-saeson-alder.md`): (a) ubundne `.in()`-kald med mange UUID'er kan ramme URL-loft — kør en grep-audit på cutover-scriptets kodesti FØR kørsel; (b) audit-FK'er uden `ON DELETE`-regel kan blokere oprydning — kør FK-census FØR masseoperationer (#2259, stadig OPEN, ~20 backup-tabeller + uindekserede FK'er venter); (c) "alder" ved et sæsonskifte er altid tvetydig (afsluttet vs. kommende sæson) — pensionsregler skal eksplicit vælge spiller-synlig alder. Rene proces-lærdomme til den der kører cutoveren, ingen kodeændring nødvendig hvis proceduren følges.
- **Bestyrelses-rework "Mandatet" (#3514, epic, spec godkendt 7/8)** har sin egen launch-sekvens forankret til 23/8 ("migration ved S2→S3-cutover... Fase 0 + 1 merged og dry-run-godkendt senest 21/8"). Verificeret 18/8: 3 af 4 "Fase 0-selvstændige" underissues er stadig OPEN (#3494, #2261, #1237 — kun #3502 er lukket). **Dette er en reel S2→S3-risiko der IKKE stod i ejerens liste** — se afsnit 2 og "Kritiske huller" nedenfor.

---

## 2. Kommunikationsplan (ons 19/8 → man 24/8)

**Grundprincip:** spillerne skal høre om ændringer FRA os, ikke opdage dem selv (samme ejer-beslutning som lå bag Discord-udkastet 17/8). Alle beskeder nedenfor er udkast — **ejeren poster selv, intet sendes af Claude.**

### Tidslinje

| Hvornår | Hvad sker | Handling |
|---|---|---|
| **Ons 19/8 – tors 20/8** | Ro-periode. Ingen nye ændringer annonceres endnu. | Brug vinduet til at få #3514-status afklaret (se risiko nedenfor) og evt. beslutte #3467/#3140 (buffer-dag). |
| **Fre 21/8** | Intern deadline for "Mandatet"-epicens Fase 0+1 (dry-run-godkendt) — jf. `docs/slices/09-board-mandate-rework-MASTER.md`. | **Ejer-tjek:** er Fase 0+1 klar? Hvis nej, skal Besked 1 nedenfor IKKE nævne bestyrelses-mandatet, eller nævne det med forbehold. |
| **Senest lør 22/8** | Besked 3 (Lønnen) skal være postet — jf. `docs/discord/2026-08-17-cutover-beskeder.md` linje 7. | Ejeren poster besked 3 fra det eksisterende udkast (ikke gentaget her). |
| **FØR søn 23/8** | Besked 1 (Race-day-motoren) og Besked 2 (Værdierne) SKAL være postet — ejer-beslutning 17/8. | Ejeren poster begge fra `docs/discord/2026-08-17-cutover-beskeder.md`. **Denne pakke tilføjer to NYE udkast nedenfor:** D1-oprykning (afsnit 4) og "hvad skal du nå inden søndag"-tjeklisten. |
| **Søn 23/8** | Sæson 2 slutter. Cutoveren kører (season-end → pyramide-/divisionsflytning → sponsor/løn-kørsel → sæson 3 'active'). | Ingen ny spillerbesked nødvendig samme dag ud over de allerede planlagte — men overvåg #3101-notifikationstallet (se afsnit 1, punkt 1a). |
| **Man 24/8** | Sæson 3 er 'active' (`start_date` i DB). Ingen bufferdag (se retro-punkt 4) — spillerne møder S3 med det samme. | Overvej en kort "Season 3 is live"-kvittering, evt. med D1-oprykningsresultatet (hvem rykkede op) hvis afgjort samme dag. |
| **Man 24/8 – fortsat** | Opfølgning: bekræft season_started-tal (1a), håndtér evt. UI-flip for Mandatet hvis Fase 0+1 lander sent (kill-switch er rollback, ikke beta-gate, ifølge #3514). | — |

### Hvad ændrer sig — kort liste til spillerne (input til en samlet "hvad du skal vide"-besked, hvis ejeren ønsker én)

1. **Race-day-motoren** — dækket af Besked 1 (allerede skrevet, se `docs/discord/2026-08-17-cutover-beskeder.md`).
2. **Værdier + løn** — dækket af Besked 2 og 3 (samme fil).
3. **Ungdomsauktioner kører videre uændret** — ingen kodeændring fundet der stopper akademi-intake ved sæsonskiftet; `seasonAcademyIntake.js` kører uafhængigt af `season_end_skip_division_movement`. **Bekræft eksplicit i en besked at intet ændrer sig her**, så spillerne ikke gætter.
4. **Nyt mandat-system ("Mandatet")** — **UKENDT om det er klar til 23/8.** Se risiko nedenfor. Nævn det IKKE som en sikker ting før status er bekræftet.
5. **Oprykning til Division 1** — ny plan, se afsnit 4. Skal kommunikeres FØR cutoveren, fordi den afgør hvad spillere i D2 kan opnå.

### Udkast: "Hvad skal du nå inden søndag" (til posting FØR 23/8, sammen med Besked 1/2)

**EN**
> **Season 2 ends Sunday 23 August. A few things to check before then:**
> - Any pending transfer offers you want accepted or rejected should be resolved before the season closes — open offers do not carry over automatically.
> - Contracts expiring at season end are released as usual; check your squad if you are close to a contract cliff.
> - Youth academy intake and auctions continue running as normal through the changeover — no action needed there.
> - Season 3 starts Monday 24 August, right after the changeover. There is no rest day between seasons this time, so book your squad for early Season 3 races before you sign off Sunday.

**DA**
> **Sæson 2 slutter søndag 23. august. Et par ting at få styr på inden:**
> - Åbne byttetilbud du vil acceptere eller afvise, bør afgøres inden sæsonen lukker — åbne tilbud følger ikke automatisk med over.
> - Kontrakter der udløber ved sæsonslut, frigives som normalt; tjek din trup hvis du er tæt på en kontraktklippe.
> - Ungdomsakademiets intake og auktioner kører videre som normalt hen over skiftet — ingen handling nødvendig der.
> - Sæson 3 starter mandag 24. august, lige efter skiftet. Der er ingen hviledag mellem sæsonerne denne gang, så book din trup til de tidlige sæson 3-løb inden du logger af søndag.

*Kilder/forbehold: kontraktfrigivelse ved sæsonslut = `backend/lib/economyEngine.js` (kontrakt-udløbsfase), verificeret aktiv. Akademi-kontinuitet: `seasonAcademyIntake.js` har ingen afhængighed af sæsonskifte-flagene, gennemsøgt 18/8 — men ingen dedikeret test af "akademiet kører uafbrudt hen over cutover" er fundet, så påstanden er kode-læsning, ikke et kørt scenarie. Ingen hviledag: `seasons`-tabellen, `start_date` for sæson 3 = 2026-08-24, verificeret 18/8.*

### Kritiske S2→S3-risici der IKKE er dækket af ejerens oprindelige liste

1. **"Mandatet" (#3514) har uklar leveringsstatus mod 21/8-deadline.** 3 af 4 forudsætnings-issues er OPEN 18/8, fem dage før cutoveren. Hvis migrationen ikke er dry-run-godkendt til tiden, bør Besked 1 IKKE love et nyt bestyrelsessystem søndag. **Skal afklares med ejeren inden nogen kommunikation om bestyrelsen postes.**
2. **Countback-tiebreak-hullet i den STANDARD op/nedrykningsmotor** (retro-punkt 5) — kan gentage 61-61-scenariet ved enhver cutline i S2→S3, inklusive selve D1-oprykningen (se afsnit 4).
3. **Sponsorbeløb mangler stadig i season_started-notifikationen** (retro-punkt 1b) — vil sandsynligvis generere samme "er pengene landet?"-spørgsmål som sidst.
4. **Ingen bufferdag** — hvis noget går galt cutover-nat, er der ingen "stille dag" til at rette det før S3-løbene begynder mandag (jf. thelambas oprindelige pointe i #3467).

---

## 3. Feedback-digest (website + forum)

**Kilder:** `player_feedback`-tabellen (10 rækker total i prod pr. 18/8 — færre end de ~40 der blev bedt om, fordi der reelt kun findes 10) og `forum_posts`/`forum_replies` for de seneste 14 dage (siden 4/8), begge hentet via Supabase MCP (kun SELECT). Brugernavne er ikke hentet — kun division, for at anonymisere.

### Website-feedback (alle 10 rækker i tabellen)

| Dato | Fra | Emne | Allerede fikset/planlagt? | Forslag til svar (EN) |
|---|---|---|---|---|
| 15/8 | D2-manager | Beskriver en modbud/auktion-sekvens hvor det er uklart hvad der sker hvis et modbud accepteres mens rytteren samtidig er på auktion med bud | Ukendt — intet matchende issue fundet. Ren proces-uklarhed, ikke nødvendigvis en bug. | "Thanks for the detailed walkthrough — that's a real edge case. When a counter-offer is accepted while the rider is also live on auction, [ukendt hvad koden faktisk gør her — bør verificeres FØR svar sendes]. I'll get this checked and follow up." |
| 11/8 | D2-manager | Forhandlet byttetilbud kunne ikke afvises, "Ugyldig handling" på /transfers | **Fikset.** #3669 (CLOSED 15/8) — samme fejl, samme side. | "This is fixed — a negotiated swap offer can now be rejected properly. Sorry for the wait, thanks for flagging it." |
| 9/8 | D2-manager | Ingen information i 8 timer under en driftsforstyrrelse, efterlyser volontører/mere kommunikation | Ikke en bug — direkte feedback om kommunikationsniveau. Relateret til #2236 (community outreach, OPEN) og den forumtråd samme dag hvor ejeren efterlyste netop volontører. | "Fair point, and it's part of why I'm building out a volunteer team for exactly this — community mods and a faster response loop. Thanks for the patience during that outage." |
| 9/8 | D2-manager | Fyrede/solgte ryttere for at købe en rytter der efterfølgende blev annulleret, usikker på lån/køb-status | Matcher forum-tråden 9/8 om akademi-bug ("skills at 99, obscene priser") — samme incident-vindue. **Fikset samme dag** (#3576, CLOSED 11/8). | "This was part of the same-day pricing bug — should be resolved now. If your specific purchase is still stuck, reply here with the rider/team and I'll check the transaction directly." |
| 1/8 | D2-manager | Idé: et "form"-træningsfokus til ryttere der har nået max i alle skills | Ingen match — ny idé, ikke tidligere set. | "Interesting idea — logging it as a feature suggestion. No promises on timing, but it's a real gap once a rider caps out." |
| 30/7 | D3-manager | Vandt en etape i går, men 1-års-plan (1 etapesejr-mål) blev ikke registreret som opfyldt | Ukendt — intet matchende issue fundet i søgning. Bør undersøges (mulig board-goal-evalueringsfejl). | "Thanks for flagging — I'll check the board goal evaluation for that stage win specifically and get back to you." |
| 27/7 | D2-manager | Klik på en løbsbesked fører til sæson-rangliste i stedet for etaperesultatet | Muligvis relateret til #3373 (dashboard-resultatlinks, CLOSED 5/8), men det dækkede en anden linktype (senest-resultater-listen, ikke besked-links). **Ikke bekræftet samme bug.** | "This may already be fixed as part of a related dashboard link fix — I'll verify the specific notification link you're describing still works correctly." |
| 27/7 | D2-manager | Efter oprykning til D2 forblev ryttere bundet til D3-løb; fejlbesked ved holdudtagelse nævner ikke hvilket løb konflikten er med | Ingen match fundet. Sammensat af to ting: (a) mulig data-lag ved divisionsskifte, (b) generel UX-mangel (fejlbesked uden kontekst). Relevant for S2→S3 hvis mønstret gentager sig ved D1-oprykningen. | "Thanks — this looks like a timing issue around the division move itself, worth checking again at the next changeover. I'll also improve the error message to name the conflicting race." |
| 27/7 | D2-manager | Efter oprykning: samme "ryttere fastlåst til forkert division"-problem, gentaget | Se ovenstående — samme rapportør, opfølgning. | (samme som ovenfor) |
| 23/7 | D2-manager | Modtilbud i en bytte-transaktion viste forkert betalingsretning (positivt beløb blev vist som "du sender" i stedet for "du modtager") | **Fikset.** #2843 (CLOSED 26/7), 3 dage efter rapporten. | "Fixed shortly after you reported it — counter-offer payment direction now displays correctly." |

**Mønster på tværs af de to 27/7-rapporter:** begge handler om ryttere der forbliver bundet til den GAMLE divisions løb lige efter en divisionsflytning. Da S2→S3 flytter reelt flere hold (retro-punkt 5, standardmotoren + ny D1-oprykning), er dette værd at holde øje med proaktivt lige efter 23/8-cutoveren, ikke kun reaktivt.

### Forum (seneste 14 dage, 7 tråde, 4/8-18/8)

| Tråd (anonymiseret emne) | Kerne | Allerede dækket? | Forslag til svar (EN) |
|---|---|---|---|
| "Is Development dead now?" (26 svar, D2-manager startede, lang debat) | Efter ryttertype/loft-korrektionen (uge 10-17/8) føler flere at udvikling ikke længere er en farbar vej til toppen — unge talenter er allerede loft-ramte langt under topspillernes niveau. Sideemne: oplevet 18 %-"risiko" ved træning af de vigtigste evner (Intervals/Sprint) gør udvikling utryg. | **Delvist.** Loft-korrektionen er allerede forklaret i Discord-udkast Besked 1 (`2026-08-17-cutover-beskeder.md`) — men den besked handler om AI-rytternes lofter, IKKE den generelle bekymring tråden rejser om egne rytteres udviklingsloft. Den oplevede "18 % setback-risiko" ved hård træning **matcher #3758** (CLOSED, ejer-beslutning 14/8: setback fjernes fra spillet — målt til **0 udløsninger nogensinde** i prod). Dvs. spillerne oplever en risiko der reelt aldrig har ramt nogen, og som allerede er besluttet fjernet fra koden. | "Good news on the risk side specifically: the 'setback' mechanic tied to hard training on race-winning skills is being removed — it turned out to have never actually triggered for a single rider in production, so there's nothing to lose by training hard. On the broader caps question: the type/ceiling correction was about making caps honest, not about closing off development as a path — that's still very much intended to be viable, and I hear the concern about the gap it opens up in the short term." |
| "New update: Rider types" (5 svar) | Spørgsmål om reversibilitet af type-ændringen, og en konkret klage: en 19-årig skiftede fra bjergrytter til sprinter "natten over", træning følt spildt. Forslag: giv ryttere/manager mulighed for at anmode om type-skift som en board-request. | Type-ændringen selv er en kendt, forklaret korrektion (samme sæt ændringer som Besked 1 refererer). Type-skift-forslaget er en ny idé uden matchende issue. | "The re-typing was a one-time correction, not something that recurs — sorry that one landed on a rider you'd already committed training to. The 'request a type change' idea is a good one, I'm noting it as a feature suggestion for the board-request system." |
| "Academy" (5 svar, akut) | Akademiet forsvandt midlertidigt fra klubhuset 9/8, ingen nye emner at hente. | **Fikset samme uge.** #3576 (CLOSED 11/8) — akademiet stod tomt efter en 9/8-oprydning selvom spillerne fik mail om et nyt kuld. Ejeren svarede allerede direkte i tråden ("It's back again... if nothing arrives today, I will make sure it will come tomorrow"). | Allerede besvaret af ejeren i tråden — ingen yderligere handling nødvendig, men kan lukkes som "verificeret løst" hvis ejeren ønsker en opfølgende kvittering. |
| "Would you like to help Cycling Zone?" (0 svar) | Ejeren selv efterlyser frivillige (Discord/forum-moderatorer, beta-testere, fair-play-detektiv, feature/roadmap-hjælp) | Ejerens eget opslag — ikke spillerfeedback der kræver svar, men relevant kontekst: matcher direkte den 9/8-website-feedback om manglende information under driftsforstyrrelsen. | Ingen svar nødvendigt — men værd at følge op på om nogen har budt ind, uafhængigt af denne pakke. |
| "Questions from a new player" (6 svar, generel Q&A-tråd) | Åben spørgetråd, ingen enkeltstående problem at handle på. | N/A | N/A |
| "How can we improve the forum?" (2 svar) | Ejerens eget opslag om at forbedre forummet. | N/A | N/A |
| "Question: Profile riders and Popularity" (1 svar, 18/8) | Spørgsmål om forskellen på to rytter-stats. | Ukendt om allerede besvaret fyldestgørende i tråden — ikke læst i detalje (uden for feedback-scope, ren Q&A). | N/A |

**Opsummering:** 10 website-feedback + 7 forumtråde (heraf 3 med reelt handlingsbehov). 3 af website-punkterne er allerede fikset (svartid 2-4 dage efter rapport i alle tre tilfælde). 2 punkter (board-plan-mål ikke registreret, besked-link til forkert side) er ikke undersøgt og bør have egne issues, hvis ejeren vil have dem fulgt op. Det klareste "kommunikations-hul" er **setback-frygten i "Is Development dead now?"**-tråden — spillerne er bange for en mekanisme (#3758) der aldrig har eksisteret i praksis, og som allerede er besluttet fjernet. Det er let at lukke med ét opslag.

---

## 4. D1-oprykningsplan S2→S3

### Hvordan S1→S2-fordelingen faktisk foregik (verificeret i kode)

S1→S2 brugte **IKKE** den normale op/nedrykningsmotor. Det var en engangs **pyramide-komprimering** (#2851, `backend/lib/pyramidCompression.js` + `backend/scripts/compressPyramid.js`), fordi praktisk talt alle rigtige hold sad i samme lag efter sæson 1:

1. **Global rangering** af ALLE menneskehold på tværs af alle puljer (`rankTeamsGlobally`) — `total_points → gc_wins → stage_wins → klassementssejre → etape-podier → bedste etapeplacering → bedste GC-placering → navn → id` (countback-kæden blev tilføjet EFTER en 61-61-tie 26/7, #3036).
2. **Fordeling efter rang** (`distributeCompression`): rang 1-48 → Division 2 (2 puljer, "slange"-fordelt så styrke spredes), rang 49-144 → Division 3 (4 puljer), resten → Division 4 (kun de 2 første puljer, så nye/svage hold får medspillere).
3. **Division 1 blev IKKE rørt.** Ingen hold flyttede ind eller ud af D1 i dette skifte — kommentaren i koden er eksplicit: "D1 røres ikke." D1 var og er 24 AI-hold, 0 rigtige hold (verificeret i prod 18/8).
4. Den normale motor blev midlertidigt slukket via flaget `season_end_skip_division_movement = 'on'` under S1→S2, og skulle sættes tilbage til `'off'` bagefter "så S2→S3 kører motorens regler igen" (kodekommentar, `backend/lib/seasonEndMovementFlag.js:1-10`, refererer #2164).

**Verificeret 18/8: flaget står på `'off'` i prod lige nu.** Det betyder S2→S3 som udgangspunkt IKKE kører en ny pyramide-komprimering — den kører den **normale, løbende** op/nedrykningsmotor.

### Hvad den normale motor faktisk gør (og hvad den vil gøre ved D1)

`processDivisionEnd` (`backend/lib/economyEngine.js:2145-2242`, #1152, ejer-besluttet 23/6-2026):

- **Pr. pulje**, ikke globalt: de øverste `PROMOTION_SLOTS = 2` rigtige hold i HVER pulje rykker op til puljens **forælder-pulje** i tieren over.
- Division 2 har **2 puljer** (verificeret i `league_divisions`, 18/8), og begge puljers forælder er den ENE Division 1-pulje.
- Det betyder: hvis motoren kører uændret, rykker **4 hold** op i D1 til S3 (2 fra hver D2-pulje) — de 2 bedst placerede i hver pulje, IKKE de 4 bedst placerede i D2 som helhed.
- D1 er i dag 100 % AI (24 AI, 0 rigtige), så ingen rigtige hold rykker ned fra D1 (AI flyttes aldrig, `if (s.team?.is_ai) continue`). AI-fyldet efterreguleres bagefter så puljen holder `POOL_TARGET_SIZE = 24`.
- Rangeringen der afgør "top 2 pr. pulje" er `season_standings.rank_in_division`, beregnet i `economyEngine.js:2540-2566` — **denne beregning har IKKE countback-kæden fra #3036** (se retro-punkt 5). Uafgjorte placeringer ved cutlinen kan derfor stadig blive afgjort tilfældigt, ikke sportsligt.

### Konflikten der skal afklares

Ejeren har svaret **"Yes same again"** på et spillerspørgsmål om D1-kvalifikation, med reference til "global rangering som sidste sæson" (Discord #questions-and-answers 17/8, @chipped26 → @bobby2106, citeret i #3901's issue-body — selve spørgsmålets fulde ordlyd er ikke hentet i denne session).

Det er en reel uoverensstemmelse med hvad koden gør som udgangspunkt lige nu:

- **"Global rangering som sidste gang"** = metoden fra `rankTeamsGlobally`/`distributeCompression` — ALLE D2-hold rangeret på tværs af begge puljer, og de bedste (uanset hvilken pulje de sad i) rykker op.
- **Motorens default (flag = off)** = PER PULJE — top 2 fra hver af de 2 D2-puljer, uanset om en pulje samlet set var stærkere end den anden.

Med kun 2 puljer og `PROMOTION_SLOTS = 2` giver de to metoder **samme resultat, HVIS** de 4 bedste D2-hold globalt tilfældigvis fordeler sig 2+2 på puljerne. Er fordelingen skæv (fx pulje A har 3 hold der ville være i global top 4, pulje B har kun 1), giver de to metoder **forskellige** hold i D1 til S3.

### Åbne spørgsmål ejeren skal afgøre

1. **Metode:** skal D1-oprykningen for S2→S3 køre som (a) den normale per-pulje-motor (default, ingen handling krævet), eller (b) en ny engangs-global-rangering ligesom S1→S2 (kræver at nogen bygger/kører en variant af `compressPyramid.js` scopet til kun D2→D1, og sætter skip-flaget 'on' for netop den overgang)? Koden afgør det IKKE selv — flaget står i dag på 'off', hvilket vil køre (a), medmindre nogen aktivt ændrer det.
2. **Antal oprykkere:** hvis metode (a) fastholdes, er svaret automatisk 4 (2×2). Hvis (b) vælges, skal antallet besluttes eksplicit (samme 4? Flere, fordi D2 nu er dobbelt så stor en talentmasse som ved S1→S2's komprimering?).
3. **Tiebreak ved cutlinen:** countback-kæden fra #3036 er ikke koblet ind i den løbende `rank_in_division`-beregning der driver metode (a). Skal den porteres derind før 23/8, eller accepteres risikoen for en ren-point-tie afgjort vilkårligt?
4. **Hvornår er resultatet kendt og klar til kommunikation:** samme dag som cutoveren (23/8), eller mandag (24/8) når sæson 3 er 'active'?

**Anbefaling (ikke en beslutning — ejerens kald):** Da forskellen mellem de to metoder kun er synlig hvis D2-puljerne er skævt stærke, er det billigste første skridt at KØRE en dry-run af begge metoder mod de faktiske S2-standings kort før 23/8 og se om de rent faktisk giver samme 4 hold. Giver de samme resultat, er spørgsmålet akademisk og motoren kan køre uændret. Giver de forskelligt resultat, er det et reelt valg der skal træffes og kommunikeres FØR cutoveren, ikke efter.

### Spillervendt udkast (afventer ejerens metode-valg — sæt "4 hold, top 2 fra hver Division 2-pulje" ind, ELLER opdatér til den globale variant, alt efter beslutning i punkt 1-2 ovenfor)

**EN**
> **Promotion to Division 1: how it works this time**
>
> Same principle as last season's changeover: promotion to Division 1 is decided by where you finish in Division 2. [PLACEHOLDER — indsæt præcis mekanik når ejeren har besluttet punkt 1-2 ovenfor, fx: "The top 2 teams in each of the two Division 2 groups move up — 4 teams total."]
>
> Ties at the promotion line are broken by [PLACEHOLDER — afhænger af punkt 3: countback-kæde eller "not yet decided, flag it if it happens to you"].
>
> The promoted teams will be confirmed [PLACEHOLDER — dato, punkt 4].

**DA**
> **Oprykning til Division 1: sådan foregår det denne gang**
>
> Samme princip som ved forrige sæsonskifte: oprykning til Division 1 afgøres af din placering i Division 2. [PLACEHOLDER — indsæt præcis mekanik når ejeren har besluttet punkt 1-2 ovenfor, fx: "De to bedste hold i hver af de to Division 2-puljer rykker op — 4 hold i alt."]
>
> Uafgjorte placeringer ved oprykningsgrænsen afgøres ved [PLACEHOLDER — afhænger af punkt 3].
>
> De oprykkede hold bekræftes [PLACEHOLDER — dato, punkt 4].

---

## Kilder brugt i denne session

- GitHub: #3901, #3101, #3096, #3037, #3467, #3140, #3036, #2842, #2164, #3546, #3758, #3669, #3576, #2843, #3373, #3514 + `gh issue list --search "season"` (60 resultater gennemgået)
- Git-log: `7c88bbce` (#3037/#3882), `f77afee0` (#3036/#3210), `e8d19e9e` (#2847/#3873), `04ae787c` + `3f76c378` (#3232/#3249)
- Kode: `backend/lib/seasonTransition.js`, `backend/lib/pyramidCompression.js`, `backend/lib/economyEngine.js` (processDivisionEnd, rank_in_division-beregning), `backend/lib/economyConstants.js`, `backend/lib/seasonEndMovementFlag.js`, `backend/lib/seasonFormReset.js`, `frontend/public/locales/en/backendMessages.json`
- Prod-DB (Supabase MCP, kun SELECT, projekt `ghwvkxzhsbbltzfnuhhz`): `app_config`, `seasons`, `teams`/`league_divisions` (division/pulje-optælling), `player_feedback` (10 rækker), `forum_posts`/`forum_replies` (14 dage)
- `.claude/learnings/2026-07-23-season-ended-never-created.md`, `.claude/learnings/2026-07-26-cutover-in-list-cliff-fk-audit-og-saeson-alder.md`
- `docs/discord/2026-08-17-cutover-beskeder.md` (genbrugt som anker, ikke omskrevet)
- `docs/slices/09-board-mandate-rework-MASTER.md`, issue #3514


---

## EFTERSKRIFT: D1-beslutningen LAAST (ejer, KS3 18/8)

Afsnit 4's aabne spoergsmaal er afgjort: gentag den globale komprimering S2->S3 INKLUSIVE D1. Rangliste = den synlige globale rangliste (standings?tab=global). Top 24 -> D1, AI viger, resten fordeles nedad som sidst, motor-flag 'on' under skiftet. Countback er allerede i komprimeringen, saa tiebreak-hullet i economyEngine er ikke soendags-kritisk. Byg + dry-run: branch feat/3901-s3-komprimering. Beslutning dokumenteret paa #3901.
