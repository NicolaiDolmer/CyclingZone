# Claude-session 23/9: bølge 3 + værdivalg + udfordr status quo

> Ejeren kopierer alt under stregen ind i en ny Claude Code-session.
> **Indstillinger (valgt af forrige session):** model Opus 5.5 · indsats (effort) **xhigh** · fast mode **fra** · permission mode auto. Workers: model pr. spor som i args-filen (opus til motor/økonomi, sonnet til små UI-/doc-spor).
> Token-mål: brug budgettet fuldt ud inden torsdag. Det gør du med bølger der kører hele tiden, ikke med lange planer.

---

Du arbejder i C:\Dev\CyclingZone (github.com/NicolaiDolmer/CyclingZone). Svar på dansk. Ny session; al state ligger i filer og på GitHub.

SÅDAN TALER DU MED MIG
- Hverdagsord. Ingen tekniske gloser uden forklaring i samme sætning. Korte beskeder.
- Ét spørgsmål ad gangen, én sætning, anbefaling først, ja/nej hvis muligt.
- Nævn ALDRIG datoer eller "kan ikke nå" som argument. Du udskyder intet. Rækkefølgen er min.
- Byg, vis fremdrift og skærmbilleder. Ingen lange lister.

PARALLEL MED FORRIGE SESSION (vigtigt de første timer)
- Sessionen fra 22/9 aften lukker ned ved siden af dig. Den EJER: merge af PR #5505 (løbsmotor-jagt) og PR #5501 (ratings på kortet, inkl. en lille badge-bølge), og close-out af docs/NOW.md.
- Du rører IKKE #5505, #5501 eller docs/NOW.md, før dens close-out-commit (`docs(close-out)…`) ligger på main. Tjek med `git --no-pager log origin/main --oneline -15`.
- Bølgelåsen er fælles: start først en bølge når `.claude/run/wave-active.json` ikke findes. Merges én ad gangen, aldrig mens en bølge kører.

FASTE REGLER
- Byg KUN via bølger: Workflow({ scriptPath: "C:\Dev\CyclingZone\.claude\workflows\wave.js", args: <objektet> }). Læs args-filen med Read, parse JSON, send objektet (ikke stien). Skal et spor køre på en branch med åben PR: `allowExistingPr: true`.
- model står eksplicit pr. spor. Skift ALDRIG opus/sonnet uden at sige det.
- Du merger ALDRIG uden mit ordrette "merge". UI-PR = skærmbilleder desktop 1440 + mobil 390 med ÆGTE data, sendt som fil FØR du beder om merge. Merge: `gh pr merge N --squash --delete-branch --admin`, og vent på at CI er helt grøn først (også backend-tests). Efter merge: flip claude:todo -> claude:done straks, medmindre issuet har arbejde tilbage (så kommentar i stedet).
- Ægte-data-skærmbilleder (lært 22/9): preview-frontenden taler med PROD-backenden, så nye endpoints findes ikke på preview før merge. Kontakter bag `/api/display-flags` slås til lokalt med localStorage (fx `cz_rider_best_role_display=1`). Login: åbn preview-login i Playwright-MCP-browseren (det er et synligt Chrome-vindue på ejerens skærm), ejeren logger selv ind, du tager billederne med `browser_run_code_unsafe` og gemmer under `.playwright-mcp/` (gitignoreret). Byg ét samlet før/efter-billede.
- Ingen --apply, ingen flag-flip, intet skrives til prod, ratingGolden.5321.json røres kun med mit go. Migrationer applies af CI ved merge; du post-verificerer.
- Commit kun bag `bash scripts/guard-commit-branch.sh <branch> <dir>`. Push efter commit. Kun docs/chore direkte på main. `git --no-pager` altid.
- Ingen hold-/rytternavne eller private balancetal i committede filer, issues eller PR-bodies. Private tal kun i chatten.
- Spillervendt tekst: EN først, DA under, jeg/du (aldrig vi), ingen em-dash, kort på fladen.

LÆS FØRST (kun dette)
1. docs/NOW.md øverste blok (efter forrige sessions close-out).
2. docs/drafts/wave-2026-09-22-b3.json (10 spor).
3. `gh pr view 5502` (værdier: beslutningsgrundlag med "Ejer-valg") og `gh issue view 5327 --comments` (seneste kommentar 22/9: sprinter-talent-fundet).

STATUS 22/9 SENT
- Merget 22/9: #5504 win-back-mailtekst (EN+DA, ordret; placering som "4th"/"nr. 4"), #5503 ryttertype-kontakt (ingen spillereffekt; kontakten er ikke koblet på kaldestederne).
- Ventede på mit "merge" ved overlevering: #5505 og #5501 (forrige session ejer dem).
- Åbne og parkerede: #5461 (merges på værdi-kørselsdagen), #5444 (Codex-draft, åben til erstatning), #5281 (flip-dagen), #5502 (værdivalg, merges ikke).
- Fund 22/9 der skal bruges: (a) `riders.best_role`/`best_role_rating` er TOMME for alle aktive ryttere i prod; de fyldes først af værdi-kørslen. (b) I prod er sprintere en almindelig type, men sjældne blandt unge store talenter; årsagen er potentialets fordeling pr. type, ikke type-trækket. (c) Arbejder-PR-bodies påstod ting der ikke passede (en preview-parameter der ikke findes i koden). Verificér påstande mod koden, ikke teksten.

OPGAVER I RÆKKEFØLGE
1. **Win-back tørkørsel (#2760):** tjek først #2760's kommentarer (er den lavet?). Ellers: frisk segment (30 dage uden login + mailsamtykke + suppression), antal EN/DA, 3 eksempler til mig. Send KUN på mit "send". Flaget tændes kun under selve kørslen.
2. **Værdivalg (#5502):** stil PR'ens "Ejer-valg" til mig ét ad gangen, én sætning hver, med anbefaling. Den blokerende rest (udvikl-og-sælg-grænsen er rød) forklarer du i hverdagsord FØR valgene. De faktiske tal (markedsvægt og loft) får jeg i chatten, ikke i PR'en. Intet bygges før jeg siger "godkendt til build".
3. **Bølge 3** fra b3.json, i filens rækkefølge. PR-loftet er 8; 4 er parkeret, så der er plads til 4 spor ad gangen: kør spor 1-4, derefter 5-8 når de første er merget, derefter 9-10. #4914 kræver at #5505 er merget. Grupetto-tempo (#4914), TTT i S4 (#4915) og raceDay-hjælpetekst (#4948) har A/B i PR-body: ét spørgsmål ad gangen.
4. **Nyt spor #5327-B (opus, investigate-først):** find hvorfor sprintere sjældent får højt potentiale (akademi-intake, pool-import, potentiale-trækket pr. type), mål på prod read-only, ret det rigtige sted, OG kobl `primaryTypeMode` på kaldestederne (aiTeamGenerator.js, fictionalLaunchPopulation.js, starterSquadAllocator.js) bag samme kontakt. Før/efter-tabel for unge store talenter pr. type i chatten til mig.
5. Samlet patch note v7.295 (#5481) når spillerfundene er merget og live: kun det der er live. Hjemmeside (PatchNotesPage.jsx, "What changed: ..." / "Hvad er ændret: ...") + Discord-tekst KUN EN som udkast til mig (jeg poster selv).
6. Derefter fra docs/drafts/codex-session-2026-09-22-v3.md opgave 5-9 som nye bølger. Træningssiden: Clarity-analyse + ét før/efter-mockup til mig FØR byg.

UDFORDR STATUS QUO (sideløbende, i pauserne mens bølger kører)
Mit mål: verdens bedste managerspil og et levebrød. Din opgave er at finde hvor vores MÅDE at arbejde på står i vejen for det, med bevis fra denne uge, ikke meninger. Startpunkter (bekræft eller afkræft hver med data fra git/GitHub/prod read-only):
- **"Bag kontakt" som standard:** hvor meget færdigbygget kode venter på flip lige nu, og hvor meget af det kan ikke tændes, fordi en ende mangler (fx #5327-kontakten uden kobling)? Forslag: "færdig" = kan tændes og er testet tændt.
- **Flip-dagen:** hvor mange kontakter og kørsler skal tændes samtidig til sæson 4 (træning, v4-motor, rating-visning, værdier, typer)? Forslag: en tændingsplan i trin med rollback pr. trin.
- **Løser vi spillerens problem eller opgavens formulering?** 22/9: type-kontakten løste ikke klagen. Forslag: hver spillerklage får et prod-tjek af selve klagen FØR byg.
- **Flaskehalsen er mig:** hvor mange timer stod PR'er klar og ventede på mit go i denne uge? Hvilke go'er kunne erstattes af en fast regel? (Røde linjer der BLIVER hos mig: prod-skrivninger, flips, penge, spillerbeskeder, race-motor-gen-tænding.)
- **Parkerede PR'er æder PR-loftet:** 4 af 8 pladser er optaget af flip-dags-PR'er. Er det rigtige sted for dem en åben PR?
- **Verifikation:** arbejdere påstår ting der ikke passer, og reviewer-agenten fangede det ikke. Hvad skal reviewer-trinnet i wave.js tjekke mod koden/runtime?
Leverance: højst 5 forslag, hvert med "i dag / bevis / forslag / pris", stillet til mig ÉT ad gangen. Det jeg siger ja til, bliver et issue (tjek dubletter først) eller en lille bølge. Genåbn ingen låste beslutninger (NOW.md + issues).

MINE GO-PUNKTER (spørg kun her)
"merge" pr. PR · "godkendt til build" på #5497/#5502 · "send" på win-back · "kør" på #4857-backfill og #5405-apply · alle flag-flips · ratingGolden · ja/nej til hvert status quo-forslag.

NÅR DU STOPPER
Opdatér docs/NOW.md (maks 1.200 tokens, Next action + Working agent nulstillet), kør `pwsh -File scripts/check-agent-token-hygiene.ps1`, status som kommentar på hvert issue du har rørt, claude:done på det der er merget, `pwsh -File scripts/close-out-cleanup.ps1`. Skriv en ny sessions-prompt i samme stil som denne, med et nyt status quo-afsnit. Sidste linje: "Ny session anbefales: <hvad næste session starter med>".

FØRSTE SVAR
Tre linjer: om forrige session har lukket (close-out på main ja/nej), hvor mange PR-pladser der er ledige, og hvad du er gået i gang med. Ét spørgsmål kun hvis noget blokerer.
