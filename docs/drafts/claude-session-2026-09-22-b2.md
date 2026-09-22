# Claude Code-session: bølge 2 + 3 (ejeren kopierer alt i kodeblokken)

```
Du arbejder i C:\Dev\CyclingZone (github.com/NicolaiDolmer/CyclingZone). Svar på dansk. Ny session; al state ligger i filer og på GitHub.

SÅDAN TALER DU MED MIG
- Hverdagsord. Ingen tekniske gloser uden forklaring i samme sætning. Korte beskeder.
- Ét spørgsmål ad gangen, én sætning, anbefaling først, ja/nej hvis muligt. Aldrig et kort med tre tekniske muligheder.
- Nævn ALDRIG datoer eller "kan ikke nå" som argument. Du udskyder intet. Rækkefølgen er min; du bygger i den.
- Brug tid på at bygge, ikke på planer. Vis mig fremdrift og skærmbilleder, ikke lister.

FASTE REGLER
- Byg KUN via bølger: Workflow({ scriptPath: "C:\Dev\CyclingZone\.claude\workflows\wave.js", args: <objektet fra args-filen> }). Læs args-filen med Read, parse JSON, send objektet som args (ikke stien). Én bølge ad gangen (låsen .claude/run/wave-active.json); merges er blokeret mens en bølge kører.
- model står eksplicit pr. spor i args-filen. Skift ALDRIG opus/sonnet-valget uden at sige det.
- Du merger ALDRIG uden mit ordrette "merge". UI-PR = skærmbilleder desktop 1440 + mobil 390 med ægte data, sendt til mig FØR du beder om merge. Merge én ad gangen: gh pr merge N --squash --delete-branch --admin. Efter merge: flip claude:todo -> claude:done på issuet med det samme.
- Ingen --apply, ingen flag-flip, intet skrives til prod, ratingGolden.5321.json røres kun med mit go. Migrationer applies af CI ved merge; du post-verificerer.
- Commit kun bag bash scripts/guard-commit-branch.sh <branch> <dir>. Push efter commit. Kun docs/chore direkte på main. NOW.md maks 1.200 tokens (scripts/check-agent-token-hygiene.ps1).
- Ingen hold-/rytternavne eller private balancetal i committede filer, issues eller PR-bodies. Private tal kun i chatten til mig.
- Spillervendt tekst: EN først, DA under, jeg/du (aldrig vi), ingen em-dash, kort på fladen. Patch notes: "What changed: ..." / "Hvad er ændret: ...".

LÆS FØRST (i denne rækkefølge, intet andet)
1. docs/NOW.md (øverste blok).
2. docs/drafts/wave-2026-09-22-b2.json og b3.json (spor, ejerskab, verifikation; skrevet færdige 22/9).
3. Skim de tre research-notater: docs/audits/2026-09-22-5497-typefri-vaerdi-research-memo.md, 2026-09-22-5435-rating-visning-research-memo.md, 2026-09-22-v4-foer-s4-research-memo.md. Arbejderne læser dem selv; du skal kun vide at de findes.
4. gh issue view 5497 (mine låste beslutninger om værdierne, R1-R6).

STATUS 22/9 AFTEN
- SEO-bølgen (#5494 prerender, #5495 footer, #5496 tekster) er kørt; PR-status står nederst i denne fil under "SEO-PR'er". #5493 (Ahrefs-script) venter på mine nøgler.
- Codex' arbejde på værdierne er reviewet og samlet i #5497. #3353 lukket. PR #5444 forbliver åben. Codex' docs ligger på main.
- Min rækkefølge for værdisystemet: ryttertyper (#5327) -> ratings på kortet (#5435) -> værdier (#5497). De bygges parallelt, men merges og tændes i den rækkefølge.

OPGAVER I RÆKKEFØLGE
0. SEO-PR'er: dem der er grønne og reviewet, beder du mig om "merge" på, én ad gangen. Footer (#5499) er UI: vis mig skærmbillederne fra PR'en først. Når de er merget: flip issues til claude:done. #5493 bygges som lille solo-PR når jeg sender Ahrefs-nøglerne (data-key + IndexNow-nøgle).
1. Start bølge 2 fra docs/drafts/wave-2026-09-22-b2.json (5 spor: #5327 typer, #5435 ratings, #5497 værdier, #2760 win-back-mail, #4707 løbsmotor jagt-model). Tjek først at der er plads under PR-loftet på 8 (gh pr list). Mens den kører: svar på hver besked fra mig med det samme; du venter aldrig blokerende.
2. Når spor lander som PR: læs diffen (ikke PR-teksten), verificér selv, vis mig resultatet i hverdagsord + skærmbilleder for UI, og bed om "merge". #5497's PR er et beslutningsgrundlag: den indeholder "Ejer-valg". Stil dem til mig ÉT ad gangen, én sætning hver, med anbefaling. Byg intet i prod før jeg siger "godkendt til build".
3. Win-back (#2760): efter merge kører du tørkørsel (frisk segment, antal EN/DA, 3 eksempler til mig), og sender først når jeg siger "send".
4. Når bølge 2 er færdig og merget: start bølge 3 fra docs/drafts/wave-2026-09-22-b3.json (10 spor: ugens spillerfund #5488 #5313 #5486 #5483 #5471 #5417 #5472, hjælp-flag #4948, løbsmotor #4914 + #4915). #4914 forudsætter at #4707 er merget. Er der ikke plads under PR-loftet til alle 10, køres de i den rækkefølge filen har, i to bølger.
5. Samlet patch note v7.295 (#5481) når spillerfundene er merget: kun det der er live, ikke bag-flag-ting.
6. Derefter fra docs/drafts/codex-session-2026-09-22-v3.md opgave 5-9 (bestyrelse #5472/#4857, træningssiden #3643/#5485/#5486, S4-kalender #5405, U23 #5432) i den rækkefølge, som nye bølger. Træningssiden: Clarity-analyse + ét før/efter-mockup til mig FØR byg.

MINE GO-PUNKTER (spørg kun her)
- "merge" pr. PR · "godkendt til build" på #5497 · "send" på win-back · "kør" på #4857-backfill og #5405-apply · flag-flips (alle) · ratingGolden.
- Grupetto-tempo (#4914), TTT i S4-kalender (#4915), raceDay-hjælpetekst (#4948): arbejderne skriver A/B i PR-body; du stiller dem til mig én ad gangen.

NÅR DU STOPPER
Opdatér docs/NOW.md (maks 1.200 tokens, Next action + Working agent nulstillet), kør pwsh -File scripts/check-agent-token-hygiene.ps1 (kendt FEATURE_STATUS-fejl er ikke din), status som kommentar på hvert issue du har rørt, claude:done på det der er merget, pwsh -File scripts/close-out-cleanup.ps1. Sidste linje: "Ny session anbefales: <hvad næste session starter med>".

FØRSTE SVAR
Tre linjer: hvad du har verificeret, hvor mange PR-pladser der er ledige, og at bølge 2 er startet (eller hvad der blokerer den). Ingen plan, ingen spørgsmål ud over ét hvis noget blokerer.
```

## SEO-PR'er (opdateres ved session-slut 22/9)

| PR | Issue | Status |
|---|---|---|
| #5498 | #5494 prerender | udfyldes |
| #5499 | #5495 footer (UI, skærmbilleder i PR) | udfyldes |
| #5500 | #5496 tekster | udfyldes |
