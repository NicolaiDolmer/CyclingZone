# Prompt: morgensession tir 6/10 (Claude Code)

Kopiér alt under stregen ind som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`. Anbefalet: **Opus**, indsats høj. Codex-prompten til natarbejde ligger nederst (valgfri).

---

Morgensession 6/10. Fortsættelse af planlægningssessionen 5/10 (#6148). **Undersøg altid før du spørger:** læs issuets ejer-kommentarer, søg PR'er og mål prod, før et beslutningskort. Kort stilles 4 ad gangen i popup, med nøgletal i selve spørgsmålet. Udskyd aldrig noget uden aftale, og skriv aldrig egne tidsskøn.

**Læs først**
1. `docs/NOW.md` og `docs/MASTERPLAN.md` (uge 41 + Roadmap · Planned)
2. `docs/superpowers/plans/2026-10-05-2027-list.md` (2027-listen, venter på UI-sektionen)
3. Issue #6157 (alle motor-diagnoser 5/10 ligger som kommentarer på #6187 #6185 #5978 #6201 #6199 #6200 #6137 #3460 #5951)

**Tjek først (verificér i prod)**
- #6129: har de 20 ryttere trænet aftenen 5/10 (`training_rider_ticks` 5/10), ingen ny `needs_reconciliation`, og er Sentry CYCLINGZONE-7X stille? Sæt da known_issue #6129 til fixed.
- #6153: ingen 500 på `/api/rankings/*` siden 5/10 10:40; de nye `p_concurrently`-kald bruges.
- Merge-køen 5/10: #6195 #6197 #6180 #6183. Post-verify. Patch note 7.341 er den skrevet og merget?
- Staging: blev `refresh-staging.ps1 -Full` færdig? Kør derefter `scripts/staging/anonymize-staging.sql` og pseudonymisér `auth.users` (ejer-go 5/10: erstat med syntetiske), isolationstjek grønt, og #6170-prerequisites. Så kan Codex måle.

**Morgenblok (ejer, 4 kort ad gangen)**
1. **Udvikling 2.0 D1-D7 (#6110)** + ekstra kort #4765 (svaghedernes rate). Var aftalt 4-5/10, og byggeriet er aftalt fra 6/10. **Første prioritet.**
2. **Løbsmotoren:** ét samlet billede med alle diagnoser, derefter designsamtaler ét punkt ad gangen, visuelt. Rækkefølge: eget hold jagter (#6187) → hvem må i udbrud + størrelse (#5978 #6201) → afsat udbryder (#6185) → tidsmodel stigning/nedkørsel (#6199 + #6200, én fælles model) → Spar kræfter (#3460) → v4-grænser + scorecard (#2557) → løbsfilm (#6137) → tekster (#6186 #5059). **Form og formtoppe (#6156) bygges først, når resten er undersøgt og designet** (ejer 5/10). Ingen known_issue for #6156 (embargo, beslutning 3 i spec 4/10).
3. **#6053 Programmer, vælg rytter først** (beta): ejeren var ikke helt glad. Se på det sammen med ham.
4. **Train now → alle?** Discord 3-5/10: ingen beta-fejlmeldinger (kanalerne tavse siden 1/10); reelt 37 tryk fra 13 hold 1-5/10. Bed om beta-feedback samtidig med sæsonmatrixen, og afgør derefter.
5. **Sæsonmatrix mobil (#5124):** bed beta-testerne om feedback i dag (ejer 5/10); skriv opslaget i ejerens tone (EN, DA under).
6. **#5864 udløbne kontrakter** (236 ryttere, B "straks" 28/9): PR #6198 klar (rod-årsag: sæsonskiftets kontraktudløb tog kun seniortruppen). Merge → dry-run → ejeren ser listen live → `--apply --owner-go=5864-production --approved-list=<hash>`.
7b. **#6184 timeouts:** PR #6196 klar. Linjerne er tomgangs-keep-alive, ikke dræbte kald; rettelser: N+1 i selection-warning-sweep og board-auto-accept, stallWatchdog LIMIT 1, nyt race_results-indeks (CONCURRENTLY). **Rører boardAutoAccept.js ligesom #6197: synk efter #6197-merge.** Go-kort fra diffen.
7c. Forslag fra #6197-workeren: Boardroom mangler flueben, selvom planen er underskrevet (52 pending 3-års + 35 1-års planer på menneskehold), så det bør undersøges og oprettes som issue.
7. **#6130**: tørkørsel for de 6 hold uden mandat → go.

**Nye fra Discord 5/10:** #6206 EXP-ikon U23/junior · #6207 rutematch 56 vs 51 · #6208 rapport hele point vs %% (idé) · **#6209 omdømme-sortering (ejer lovede rettelse 3/10 "in the coming week")** · #6210 to point i samme evne på én dag. Ubesvaret på Discord: "vi kunne træne når som helst, men nu kører den kl. 20?" (Q&A 2/10) · program med andet på løbsdag 2 og 4 (beta 4/10) · hvilke 7 tæller i omdømme. Holdet "Dolmer Racing" udgiver sig muligvis for ejeren.

**Denne uge (aftalt 5/10)**
#6184 timeouts (PR #6196) · #708 grants før 30/10 · #5979 · #5940 + #5916 visning · #6138 · #6062 billing · #6121 Sentry v11 (privacy-gate) · #4714 beslut + indfør · Holdarbejde-opfyldning (#5268 A; 7.739 NULL) · #6202 Vercel-builds · roadmap-opfølgning #6174 #6175 #6172 #6165 #6164 · 2027-sektion på roadmappet (UI-PR, ejer ser skærmbillede) · #6203 søgning · #6204 admin-faner/filtre/sortering · #6205 sync MASTERPLAN↔roadmap↔roadbook (høj).
**Før S5 (25/10):** #6109 · #5865 · #5842 (tidspunkt) · #5833 afstemning (startdag, slutdag, pausens længde) · ungdoms-upkeep 0 i S5 meldes ud. **Uge 43-46:** #6190.
**Næste roadbook-opslag:** #5268-historien · #5912-svar · upkeep 0 i S5 · #5833-afstemning · (fog of war-afstemning #5107 senere på ugen).
**Ejer-skridt:** aflæs Vercel Usage · nedgradér/sluk staging efter målingen (ca. 100 kr/md).

**Regler der bed 5/10 (gemt i memory):** wave via `Workflow({name:"wave"})`, ikke scriptPath · `active` = Idé på roadmappet · tjek embargo før known_issue · roadmap + MASTERPLAN opdateres i samme tur som hver beslutning.

---

## Valgfrit: Codex-nat (bundne opgaver, én PR hver, ingen prod-skrivning, ingen merge)
`node scripts/codex-wave.mjs plan.json --run` med spor: #708 (GRANT-skabelon + audit + CI-vagt) · #6202 (Vercel ignoreCommand: byg kun ved frontend-ændring) · #5916 + #5940 (sponsor- og præmie-visning, copy EN+DA efter TONE_OF_VOICE) · #6138 (scoutmission 5 vs 4). Codex må ikke røre løbsmotoren eller #6156.
