# Codex-prompt 22/9 (ejeren kopierer selv ind i Codex)

> Skrevet af Claude Code 22/9 middag efter kontrol-sessionen. Merget i dag: #5477 · #5478 (patch note v7.293) · #5465 (skader i løbsdage, bag flag) · #5469 (finale-kalibrering) · #5475 (indbakke-crash) · #5468 (Codex-bølger). Rækkefølgen herunder følger MASTERPLAN "gør det lovede færdigt" + brand først. Ejeren vælger.

```
Du arbejder i C:\Dev\CyclingZone (github.com/NicolaiDolmer/CyclingZone). Svar mig på dansk.
Læs FØRST: AGENTS.md, CLAUDE.md, docs/NOW.md, docs/MASTERPLAN.md (øverste blok), docs/TONE_OF_VOICE.md, docs/PARALLEL_WORKTREE_ORCHESTRATION.md (Codex-afsnittet, nyt i dag).

FASTE REGLER
- Eget worktree + egen branch pr. opgave (scripts/new-worktree.ps1). Skriv ALDRIG i hoved-checkoutet.
- Commit kun bag scripts/guard-commit-branch.sh <branch> <dir>. Push efter commit. PR-body = templaten, Brugerverifikation "- [x]", "Refs #N".
- Du merger ALDRIG. Go = mit ordrette "merge". UI-PR = skærmbilleder desktop 1440 + mobil 390 med ægte data i PR'en.
- Ingen --apply, ingen flag-flip, intet skrives til prod. Ingen hold-/rytternavne i committede filer.
- Spillervendt tekst: EN først, DA under, jeg/du (aldrig vi), ingen em-dash, kort på fladen.
- Tunge kørsler: pwsh -File scripts/verify-lock.ps1 -Max 2 -- <kommando>. scripts/preflight-pr.ps1 før push. Maks 8 åbne PR'er (kode-loft).
- Parallelt arbejde KUN via bølge-indgangen fra #5468 (wave-active.json med runtime=codex). Første bølge efter #5468 SKAL være ét docs-spor med ownership docs/audits/5468-first-wave-smoke.md. Slet aldrig .claude/run/* du ikke selv ejer.
- Ét spørgsmål ad gangen, kort, anbefaling først. Udskyd intet selv. Stop og vis resultatet efter hver opgave.

OPGAVER i rækkefølge:

1. BRAND: spillerfund fra ugen (én PR pr. issue, patch note-linje i hver).
   a) #5471 rangliste på mobil: ét hold fylder hele tabellen uden navn i D1+D2 (formodet Founder-mærket). Repro på prod-data (SELECT), rod-årsag, fix + test.
   b) #5313 indbakken åbner øverst; skal åbne ved nyeste besked.
   c) #5417 Race Center mobil: "View details" viser ikke løbet.
   d) #5456 + #5418 skader: er Echelon Drills' +2/+3-bonus og skadesrisikoen efter de tre nye træningsformer for høj? FØRST tal (SELECT på rider_condition/rider_development_log, sidste 14 dage vs. før 12/9), vis mig dem, INGEN ændring af risiko uden mit go.

2. BESTYRELSEN færdig (85 %): #5472 den nye bestyrelsesside bryder desktop-layoutet (smalt vindue + fuld skærm) + i18n-hullerne fra beta ("speaks"-fejlen, manglende ord). Derefter #4857-backfill som DRY-RUN (2 hold uden board_relations) og vis mig diff; apply kun på mit "kør". Flip #4859 og sletning #4858 er mine.

3. MOBIL-TRÆNING PARITET (#3643): #5465 er merget, rebase på main. Minimum før flaget kan tændes for alle: skadet/status i rækken · vej til rytterens ugeplan fra telefonen (eller fjern den døde "Gå til rosteret"-knap) · dagens træningsrapport + "ændringer gælder fra i morgen". Dernæst sortering på score + hjælpelink, link til rytterprofil, multi-select, dayClose/runDayNow-divergensen. Android, skærmbilleder 390 px.

4. S4-KALENDER (#5405): #5469 er merget, tre finale-afvigelser tilbage (hilly slutter udbrud · cobbles slutter fladt · cobbles slutter udbrud). Ret dem afgrænset (samme scope-regel som #5469: bånd/vægte, ingen generator-omlægning; fælles varianter ligger i draft #5476 og er IKKE besluttet). Tørkørsel uden --uniform-tilt, vis mig scorecard. --apply er mit go pr. kørsel.

5. NATURLIG ROLLE (#5435): KUN model A, INGEN loft-tal (mine beslutninger 21/9 i issuets to seneste kommentarer). Spec §2 leverance 1. Forudsætning #5423 rettes først i egen PR. Rating må kun stige; ratingGolden.5321.json kun med mit go. Branch + Vercel-preview; før/efter-billeder af rytterprofil, Mit hold, rytterdatabasen (desktop + mobil).

6. SAMLET PATCH NOTE v7.295 (én PR til sidst): #5475 indbakke-crash rettet · det fra opgave 1 der er merget. Skader i løbsdage og kalibrering er bag flag/ikke spillervendt endnu: INGEN linje før flip-dagen. v7.294 er reserveret af #5461 (værdiskiftet, merges på kørselsdagen).

7. U23 (kun hvis 1-4 er i PR): #5432 RPC'erne har hård 8-cap i SQL, så 12/10-lofterne er uvirksomme; ret som migration + test. A2-migrationen (league_divisions.squad, races.squad) som PR, apply post-merge via auto-migrate.

NÅR DU STOPPER FOR I DAG: opdatér docs/NOW.md (maks 1.200 tokens; "Next action" + "Working agent" nulstillet), kør pwsh -File scripts/check-agent-token-hygiene.ps1, status som kommentar på hvert issue du har rørt, flip claude:todo -> claude:done på det der er merget.
```
