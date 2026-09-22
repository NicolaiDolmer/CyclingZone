# Codex-prompt 22/9 v2 (ejeren kopierer selv ind i Codex)

> Skrevet af Claude Code 22/9 eftermiddag efter kontrol-sessionen. Merget i dag: #5477 · #5478 (v7.293) · #5465 (skader bag flag) · #5469 · #5475 · #5468. Ejer-beslutninger 22/9: #5281 venter til flip-dagen (bonus slukkes af flaget) · #3512 lukket, #5327 omskrevet · #5444 splittes · værdiskiftet kører når ejeren har set gammel/ny værdi i admin. Rækkefølgen herunder er ejer-godkendt i prioritet: værdiskiftet først.

```
Du arbejder i C:\Dev\CyclingZone (github.com/NicolaiDolmer/CyclingZone). Svar mig på dansk.
Læs FØRST: AGENTS.md, CLAUDE.md, docs/NOW.md, docs/MASTERPLAN.md (øverste blok), docs/TONE_OF_VOICE.md, docs/PARALLEL_WORKTREE_ORCHESTRATION.md (Codex-afsnittet), docs/design/PAGE_TEMPLATES.md.

FASTE REGLER
- Eget worktree + egen branch pr. opgave (scripts/new-worktree.ps1). Skriv ALDRIG i hoved-checkoutet.
- Commit kun bag scripts/guard-commit-branch.sh <branch> <dir>. Push efter commit. PR-body = templaten, Brugerverifikation "- [x]", "Refs #N". PR-nummer i titlen.
- Du merger ALDRIG. Go = mit ordrette "merge". UI-PR = skærmbilleder desktop 1440 + mobil 390 med ægte data i PR'en. Når en PR med #N i titlen merges, flipper du #N til claude:done i samme tur.
- Ingen --apply, ingen flag-flip, intet skrives til prod. Ingen hold-/rytternavne i committede filer.
- Spillervendt tekst: EN først, DA under, jeg/du (aldrig vi), ingen em-dash, kort på fladen. Patch notes: "What changed: ..." / "Hvad er ændret: ...", 1-2 sætninger.
- Tunge kørsler: pwsh -File scripts/verify-lock.ps1 -Max 2 -- <kommando>. scripts/preflight-pr.ps1 før push. Maks 8 åbne PR'er.
- Stablede PR'er (base = anden PR's branch) retargetes til main FØR basen merges; ellers lukker GitHub dem (bidt 22/9).
- Bølger kun via indgangen fra #5468 (wave-active.json, runtime=codex). Første bølge efter #5468 = ét docs-spor (#5482). Slet aldrig .claude/run/* du ikke ejer.
- Ét spørgsmål ad gangen, kort, anbefaling først. Udskyd intet selv. Stop og vis resultatet efter hver opgave.

OPGAVER i rækkefølge:

1. VÆRDISKIFTET, FORHÅNDSVISNING I ADMIN (#5443). Ejer-krav: se gammel og ny værdi pr. rytter i spillet FØR kørslen. I dag findes kun backend/scripts/dev/valuationV5DryRun5443.mjs (CSV lokalt) og en gammel admin-side til det forrige skifte. Byg i ÉN PR:
   a) tabel value_transition_preview_5443 (rider_id, team_id, primary_type, valuation_type, value_before, value_after, diff, computed_at) som migration i database/ (idempotent; auto-migrate applier post-merge),
   b) valuationV5DryRun5443.mjs upserter til tabellen (behold CSV),
   c) GET /api/admin/value-transition-5443 (requireOwner, read-only, paginering + sortering på diff, filter på hold/type, totaler pr. hold),
   d) T2-side admin/value-transition-5443 efter docs/design/PAGE_TEMPLATES.md (overblik først: totaler op/ned/samlet holdværdi, så tabel; tabular figures; ingen nyt design),
   e) FJERN den gamle side frontend/src/pages/AdminValueTransitionPage.jsx (+ adminValueTransitionShape.js + test), endpoints /admin/market-value-level-correction/gate og /dry-run i backend/routes/api.js (~13774-13816) og route/link i App.jsx/Layout.jsx. Type-dæmpningen blev flippet 23/8, intet bruger dem. Rør IKKE RiderLevelCorrectionReceipt.jsx eller NotificationsPage.jsx (spillervendt).
   Skærmbilleder af den nye side med tørkørselsdata. Stop, vis mig.
   Derefter #5461: rebase mod main (patchNotes.js har v7.293; 7.294 er stadig næste), ret tone (præfiks, 1-2 sætninger, jeg-stemme), dato = "KØRSELSDAG" som placeholder jeg retter. Merges først på kørselsdagen.

2. #5444 SPLIT (ejer-go 22/9). Ny branch fra main, kopiér KUN: backend/scripts/dev/v4RefitDryRun5443.mjs, v4RefitCompare5443.mjs, marketV3AndEvent5443.mjs, unfreezeSelection5443.js + test, scorecard-/fit-udvidelser, SQL-forslag til backup-tabel. Nul live-filer. Chore-PR. Når merget: luk #5444 med kommentar.

3. #5327 ARKETYPE, LILLE UDSNIT (ejer-go 22/9). Træk rytterens PRIMÆRE type fra DEFAULT_DISTRIBUTION i archetypeDistribution.js (kalender-efterspørgsel + FLOOR_PCT 8,5) i stedet for TIER_TYPE_WEIGHTS, bag app_config-kontakt (default off), på #5269's own-priors-underlag. Ingen signatur-boost. Verifikation: før/efter-fordeling på 1.000 genererede ryttere i PR-body + sim-harness grønt. Mål: beta før S4.

4. BRAND, ugens spillerfund (én PR pr. issue, patch note-linje i hver): #5471 rangliste på mobil, ét hold fylder tabellen uden navn · #5313 indbakken skal åbne ved nyeste besked · #5417 Race Center mobil "View details" viser ikke løbet · #5456 + #5418 skader/Echelon: TAL FØRST (SELECT, sidste 14 dage vs. før 12/9), vis mig dem, ingen ændring uden mit go. #5483 hjælpetekst national kerne (≥4 ryttere OG ≥35 %, boardIdentity.js:307) kan tages med som lille docs-PR.

5. BESTYRELSEN færdig: #5472 desktop-layout + i18n-huller fra beta. Derefter #4857-backfill som DRY-RUN (2 hold uden board_relations), vis diff; apply kun på mit "kør".

6. MOBIL-TRÆNING PARITET (#3643), rebase på main (#5465 er inde): skadet/status i rækken · vej til ugeplan fra telefonen (eller fjern død knap) · dagens rapport + "gælder fra i morgen". Dernæst sortering/hjælpelink/profil-link/multi-select/dayClose-divergens. Android, 390 px.

7. S4-KALENDER (#5405): ret de tre finale-afvigelser afgrænset (bånd/vægte, samme scope som #5469). Fælles varianter er en ejerbeslutning (#5480), byg dem IKKE. Tørkørsel uden --uniform-tilt, vis scorecard. --apply er mit go pr. kørsel.

8. NATURLIG ROLLE (#5435): KUN model A, INGEN loft-tal. #5423 først i egen PR. Rating må kun stige. Vercel-preview + før/efter-billeder (rytterprofil, Mit hold, rytterdatabase; desktop + mobil).

9. SAMLET PATCH NOTE v7.295 (#5481): #5475 indbakke-crash + det fra opgave 4 der er merget. Skader i løbsdage/kalibrering er bag flag: ingen linje før flip-dagen.

10. U23 (kun hvis 1-5 er i PR): #5432 hård 8-cap i RPC'erne → migration + test; A2-migration (league_divisions.squad, races.squad) som PR, apply post-merge.

NÅR DU STOPPER FOR I DAG: opdatér docs/NOW.md (maks 1.200 tokens; "Next action" + "Working agent" nulstillet), kør pwsh -File scripts/check-agent-token-hygiene.ps1, status som kommentar på hvert issue du har rørt, flip claude:todo -> claude:done på det der er merget.
```
