# Session-prompt: Merge-togets fortsaettelse (20/8 efter kl. 20)

> Skrevet ved aften-sessionens close-out ca. kl. 18. Ejeren tjekker trin 7
> i ro og orden efter kl. 20 og melder go. ALT er verificeret og staged -
> denne session skal primaert EKSEKVERE, ikke bygge. Een beslutning ad
> gangen, kontekst i kortet. Hard rules 24-28 gaelder.

Laes docs/NOW.md, markér dig aktiv. OBS: hoved-checkoutet er optaget af en
race-planning-prototype-session (branch chore/race-planning-prototype-preview)
- arbejd KUN i worktrees, commit docs/main-ting via midlertidigt worktree.

## Tilstand (verificeret ved close-out)

**Merged i aften:** PR #4019 spejder-modning (7.157, #3997 done, PR #4008
lukket) · PR #4020 mark-alle-laest (#4017 done) · PR #4003 harness (chore).

**Toget - merges i PRAECIS denne raekkefoelge (patch note-numre = bindende
merge-orden, se .claude/learnings/2026-08-20-patch-note-numre-tildeles-i-merge-orden.md):**

1. **PR #3798 trin 7 (7.158)** - VED EJER-GO. Worktree C:/Dev/CyclingZone-worktrees/3746-trin7.
   Fuld lokal e2e koert 20/8 (527 passed; 3708-webkit-flake passerer isoleret),
   preflight groen, ejer har set kvitterings-screenshots (pr-screens/3924-*.png).
2. **PR #4013 Supabase-perf (7.159)** - ejer-mandat "ind foer cutover", intet
   nyt go kraevet. Worktree C:/Dev/CyclingZone-worktrees/4013-perf.
   EFTER merge: apply database/2026-08-20-4010-race-results-stage-window-index.sql
   via Supabase MCP (#2642-rammer) - filen har BEVIDST ingen BEGIN/COMMIT
   (CREATE INDEX CONCURRENTLY); post-verify-queries i bunden af filen.
3. **PR #4012 etapetype variant C (7.160)** - ejer valgte variant C visuelt,
   intet nyt go kraevet. Worktree .claude/worktrees/agent-a55634667ea24bada.
4. **PR #4021 pension-banner (7.161)** - ejer-godkendt visuelt ("Godkendt").
   Worktree C:/Dev/CyclingZone-worktrees/2748-pension. Inbox-scriptet
   (notifyRetirement2748.mjs) koeres FOERST ved soendagens cutover, staar i drejebogen.
5. **PR #4018 finance (7.162)** - ejer-go givet ("godkendt nu"). Worktree
   .claude/worktrees/agent-ae4807b3767150663. FOER merge: verificer fuld
   e2e - lokal koersel blev afbrudt ved session-luk; tjek `gh pr checks 4018`
   (CI koerer alle specs) og genkør evt. `npm run test:e2e` i worktreet.
   Ejer-feedback ved go: #4025 tekst-trim er OPFOELGNING, ikke denne PR.

**Pr. vogn-procedure (serielle konflikter er FORVENTEDE):** efter hvert merge
flytter mains patchNotes-top sig → naeste vogn faar konflikt. Loes: merge
origin/main ind i vognens worktree, laeg vognens entry OEVERST over mains nye
top (nummeret er allerede rigtigt), `node -e "import('./frontend/src/data/patchNotes.js').then(...)"`-
parse-tjek, frontend `node --test`, push, vent paa MERGEABLE, squash-merge med
`(#PR-nr)`-suffix i subject. Bundle-budget: trin 7 saetter 892, #4018 satte 889
fra 885 - ved #4018-vognen skal budgettet genloeses oven paa 892 (maal med
`node scripts/check-bundle-budget.mjs` og saet maalt+margin ~2,5-3 KB, dokumentér i _note).

## Trin 7-kaeden (efter merge af #3798, fra udrulnings-prompten 19/8)

1. Verificer merge: `gh pr view 3798 --json mergedAt` OG laes indholdet paa main.
2. Migration: database/2026-08-18-3746-dev-transition-dismiss.sql (idempotent, post-verify i header).
3. Backfill: `node backend/scripts/dev/lofterApply3746.mjs` dry-run mod prod →
   VIS TALLENE (aerligt tal: 4.247 pladser/2.134 ryttere over nyt loft) →
   EJER-STOP → ved ja: `--apply --jeg-har-set-dry-runnet`. Backup-tabel verificeres foer skrivning.
4. Refit: `node backend/scripts/fitRiderTypesBaseline.js --caps` mod NYE prod-caps, commit riderTypesBaseline.json.
5. Indbakke: `node backend/scripts/dev/notifyTransition3746.mjs` dry-run → modtagertal → ejer-ja → `--apply`.
6. Prod-verify: engangspanel paa ejerens konto, loft-visning profil/scouting/holdside, Railway-log uden 500'er, Sentry stille.
7. Ejeren poster docs/discord/2026-08-16-trin7-potentiale-fart.md (opdateret 20/8 med de nye traeningsflader).
8. Label-flip per #3803 punkt 4: #3746/#3794/#3788/#3787/#3651/#3679/#3714/#3785; #3721/#3979/#3980 efter verifikation.
9. Staging-oprydning (Supabase-branch staging-3746-trin7 + Railway cz-staging-3746) KUN naar ejeren melder testen faerdig.

## Efter kaeden

- **W7 hjaelpetekster som workflow-fan-out** (ejer-godkendt vaerktoej): #3714
  (er scout-baandet en garanti) · #3623 (de 8 ryttertyper-oversigt) · #3456
  (traening koerer/restituerer + 'Arbejd') · #3412 (aldersnedgang). En worker
  pr. issue i egne worktrees, max 3 tunge, orkestrator ejer e2e-slottet;
  spawn-prompter KRAEVER commit pr. delfix + push hvert 30. min. Tjek issuernes
  nyeste kommentarer for ejer-svar fra 20/8. NYT PRINCIP (ejer 20/8, #4025 +
  memory feedback-kort-paa-fladen-manualer-i-hjaelp): fuld prosa i help.json,
  KORT paa fladen.
- Patch notes-sync + NOW/MASTERPLAN + token-hygiejne ved close-out.
- Ejer-paamindelser: #patch-notes-samleopslag (7.148-7.152, + evt. 7.157-linje) ·
  loerdag: dispatch restore-drill.yml manuelt · #2853 e-mail-loop fredag.

## Aabne opfoelgninger oprettet i aften

#4023 laanerente cash/non-cash-inkonsistens (fra #4018-revisionen) · #4024
hardcodet "season 3" i forecast-fodnote · #4025 tekst-trim paa oekonomiflader.

## Regler der bed i aften

Patch note-numre tildeles i merge-orden (postmortem-fil ovenfor) · hoved-
checkoutet kan skifte branch under dig (fremmede sessioner) - arbejd i
worktrees · agent-deploys til Railway-staging er klassifikator-blokeret
(ejerens `railway up`) · session-injektion i browser blokeres af classifier -
brug VITE_PREVIEW_MOCK-flowet til autentificerede screenshots.
