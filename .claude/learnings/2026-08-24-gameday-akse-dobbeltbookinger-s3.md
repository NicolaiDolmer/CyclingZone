# 2026-08-24: game_day-aksen skrev slot-indeks, 1.855 ryttere dobbeltbooket ved S3-start

## Hvad skete
Kalender-generatoren (`raceCalendarLanePacker.js`) skrev `race_stage_schedule.game_day` som internt slot-indeks (op til 85 i en 27-dages sæson) for tier 1-3; kun D4 fik den reelle løbsdag. Alt der kører på game_day-aksen blev skævt: kalender-visningen ("Race day N"), OG `binding_span`/#3420-EXCLUDE-constrainten, som derfor håndhævede "1 rytter = 1 løb/dag" mod forkerte dage. Auto-udtagelsen lagde 1.855 ryttere i to løb på samme IRL-dag (D1 414 / D2 608 / D3 833) — opdaget aftenen før første løbsdag via spiller-rapporter om "udstrakte etapeløb" (symptomet, ikke sygdommen).

## Hvorfor den slap igennem
- Constrainten VAR grøn — den validerede bare den forkerte akse. En invariant er kun så god som datagrundlaget den måler på.
- Generalprøven af cutoveren verificerede entries-antal ("0 puljer uden felt"), ikke akse-konsistens.
- Genganger: #1823 var samme fejlklasse i S1 (798 dobbeltbookinger). Klassen blev repareret, ikke umuliggjort.

## Reparationen (#4155, PR #4158, prod 24/8 ~00:45)
Staging-generalprøve ×3 fangede to forkerte strategier FØR prod: (1) dato-baseret konflikt-opløsning efterlod span-overlaps, (2) ren span-grådighed tømte hele felter (10.404 slettede entries, løb med 0 deltagere). Rigtig strategi = #1823-mønsteret: slet auto-entries, reparér aksen, lad den binding-bevidste generator genopbygge. Undervejs udvidede ejeren scope med D1-tæthedskrav (5-6 etaper/IRL-dag) — løst som transportproblem (solver) med 3 endagsløb + 3 etapeløbs-starter flyttet; regional forsyningsanalyse viste at kravet var umuligt uden dato-flytninger.

## Læringer
1. **Verificér AKSEN, ikke kun invarianten.** Post-transition-verify skal måle `game_day == reel løbsdag` og span-overlaps direkte (nu #4159: DB-trigger + lane-packer-fix + transition-gate).
2. **Staging-generalprøven betalte sig 3×** — begge forkastede strategier ville have været prod-katastrofer (tomme felter / uløselige constraint-brud).
3. **Kapacitetsregning før lovning:** "komprimér løbene" OG "5-6/dag" OG "faste endagsløb" var samlet uopfyldeligt — regn det regionale udbud/efterspørgsel FØR man vælger fix-form, ellers jagter man et umuligt mål i småjusteringer.
4. To hændelser af samme klasse = klassen skal gøres umulig i DATABASEN, ikke i endnu et applikationslag (#3420-erfaringen gælder også for kildedata).

Refs #4155 #4158 #4159 #3420 #1823
