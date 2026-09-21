# Codex-prompt 21/9 (ejeren kopierer selv ind i Codex)

> Skrevet af Claude Code 21/9 aften. Claude-tokens er knappe resten af dagen; Codex tager over. Rækkefølgen er Claudes anbefaling, ejeren vælger. Prompten herunder er selvbærende.

```
Du arbejder i C:\Dev\CyclingZone (github.com/NicolaiDolmer/CyclingZone). Svar mig på dansk.
Læs FØRST: AGENTS.md, CLAUDE.md, docs/NOW.md, docs/MASTERPLAN.md (øverste blok), docs/TONE_OF_VOICE.md.

FASTE REGLER (bider hver gang)
- Eget worktree + egen branch pr. opgave via scripts/new-worktree.ps1. Skriv ALDRIG i hoved-checkoutet, heller ikke .claude/launch.json.
- Commit kun bag scripts/guard-commit-branch.sh <branch> <dir>. Push efter commit. PR-body = templaten med Brugerverifikation "- [x]", "Refs #N" (aldrig Closes).
- Du merger ALDRIG. Go = ejerens ordrette "merge". UI-PR = skærmbilleder (desktop 1440 + mobil 390, ægte data) i PR'en.
- Ingen --apply, ingen flag-flip, intet skrives til prod. Kun SELECT. Ingen hold-/rytternavne eller rytter-id'er i committede filer.
- Spillervendt tekst: EN først, DA under, jeg/du (aldrig vi), ingen em-dash, KORT på fladen (prosa hører til i help.json).
- Tunge verifikationer gennem: pwsh -File scripts/verify-lock.ps1 -Max 2 -- <kommando>. Kør scripts/preflight-pr.ps1 før push.
- Spørg mig ét spørgsmål ad gangen, kort, med din anbefaling først. Udskyd intet selv.

KOLLISIONER: Claude har 4 åbne bølge-spor. RØR IKKE disse filer før deres PR'er er merget:
backend/lib/raceStageProfileGenerator.js · backend/lib/dailyTrainingEngine.js · backend/lib/raceRunner.js · backend/lib/riderEligibility.js · backend/lib/raceSelection.js · backend/lib/selectionAutoFill.js · backend/lib/notificationTypes.js · frontend/src/pages/AcademyPage.jsx · frontend/src/hooks/useAcademy.js · frontend/src/lib/training.js · frontend/src/components/ConditionChips.jsx · frontend/public/locales/*/help.json · frontend/public/locales/*/notifications.json · frontend/public/locales/*/academy.json.
PR'er: #5460 (S4-kalibrering) · #5461 (værdiskifte patch note, DRAFT til kørselsdagen; bruger v7.293) · Graduation Day #2491 · skader i løbsdage #5462 · assistent-besked #4759. Tjek `gh pr list` først.

OPGAVER, i denne rækkefølge (stop og vis mig resultatet efter hver):

1. CODEX-BØLGER (#5467). Læs issuet + BEGGE Claude-kommentarer 21/9 (den sidste er min beslutning: Codex skal kunne køre fulde bølge-sessioner som Claudes wave.js, ikke begrænses). Start med trin 2: capability-probe + dry-run på ufarlige fixture-opgaver i din egen runtime. Dokumentér hvad der er teknisk håndhævet og hvad der kun er prosa. Byg derefter en Codex-bølge-indgang der GENBRUGER scripts/make-wave-brief.mjs, new-worktree.ps1, verify-lock.ps1, merge-queue.ps1, wave-freeze.mjs. Krav: (a) skriv/respektér .claude/run/wave-active.json med runtime-felt, så Claude og Codex aldrig kører bølge samtidig uden at se hinanden; (b) luk #4016's blinde vinkel (Claude kan ikke se Codex' sessioner); (c) loftet på 5 åbne PR'er som KODE i begge indgange; (d) uafhængig reviewer pr. spor; (e) oprydning der kun rammer bølgens egne ressourcer. Ret docs/AGENT_ARCHITECTURE.md (Manus er ude) og tilføj et Codex-afsnit i docs/PARALLEL_WORKTREE_ORCHESTRATION.md. Rør ikke .claude/workflows/wave.js' adfærd uden at vise mig diffen først.

2. NATURLIG ROLLE + BEDSTE ROLLE NU (#5435). Mine beslutninger 21/9 står i issuets to seneste kommentarer: KUN model A, og INGEN loft-tal i visningen. Spec: docs/superpowers/specs/2026-09-11-ryttertype-visning-og-punch-loft-design.md §2 (kun leverance 1, visning). Forudsætning: #5423 (rytterprofilens hero bruger en håndskrevet select) rettes FØRST i egen PR. Rating-reglen 17/9: tallet må kun stige; ratingGolden.5321.json opdateres kun med mit go. Byg som branch med Vercel-preview; jeg viser spillerne den før merge. Send mig før/efter-billeder af rytterprofil, Mit hold og rytterdatabasen (desktop + mobil) med Nicolò Caruso og Mario S. Iglesias.

3. MOBIL-TRÆNING, PARITET (#3643, Claudes audit-kommentar 21/9). Vent til #5462 har en PR, og rebase på den. Minimum før flaget kan tændes for alle: (1) skadet/status synlig i rækken, (2) vej til rytterens egen ugeplan fra telefonen (eller fjern den døde "Gå til rosteret"-knap), (3) dagens træningsrapport + "ændringer gælder fra i morgen" i den nye visning. Dernæst: sortering på score + hjælpelink ved scoren, link til rytterprofilen, multi-select, og dayClose-/runDayNow-divergensen i mobil-knappen. Jeg har Android, aldrig iOS-tjek. Skærmbilleder 390 px i PR'en.

4. PATCH NOTE for forum-links (#5463 er merget uden). Næste frie version i frontend/src/data/patchNotes.js (v7.293 er reserveret af #5461: brug den, og skriv i #5461 at den skal rykke til næste nummer ved merge). Tekst EN + DA, kort. Før/efter-billede af et forumindlæg med et link.

5. /ROADMAP = ROADBOOKEN (#5387). Siden skal matche mit opslag i #the-roadbook 15/9 (docs/drafts/roadbook-discord-2026-09-15.md), med ærlig status pr. punkt. Mockup først, byg efter mit valg.

Når du er færdig for i dag: opdatér docs/NOW.md (maks 1.200 tokens; "Next action" + "Working agent" nulstillet), kør pwsh -File scripts/check-agent-token-hygiene.ps1, og skriv status som kommentar på hvert issue du har rørt.
```
