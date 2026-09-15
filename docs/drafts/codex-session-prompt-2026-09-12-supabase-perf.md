# Codex-sessionsprompt 12/9 2026: Supabase-rest (#5176) → perf top 3 (#5177)

> **Til ejeren (ikke en del af prompten).** Skrevet af Claude 12/9 kl. 18:30 ud fra `docs/NOW.md`, MASTERPLAN og issue-teksterne. Start Codex fra repo-roden: `cd C:\Dev\CyclingZone; codex`. Vælg det højeste reasoning-niveau Codex tilbyder. Kør IKKE en Claude-byggebølge samtidig; Claude må gerne lave read-only, go-kort og merges imens, da Codex sidder i sin egen worktree og skriver sig ind i `🤖 Working agent`. Når Codex melder "PR klar", er det dig der siger ordret "merge". Bytter du rækkefølgen (#5177 først), så ret kun afsnittet "Opgave 1/2". Rammen (Del B + Del C) står i `docs/agents/CODEX_PROMPTS.md`; prompten kalder dem. Kopiér alt under stregen.

---

Du er Codex i CyclingZone (browserbaseret cykel-managerspil, open beta, live på cyclingzone.org, sæson 3 kører til 27/9 med etaper kl. 11-19 dansk tid). Ejeren er solo-udvikler og sidder med. Svar på dansk. Skriv kort, konkret, med tal og filnavne. Sig "ikke verificeret" når du ikke har set det selv; gæt aldrig et feltnavn eller en tilstand.

## 0. Ramme (udfør før alt andet)

1. Læs `docs/agents/CODEX_PROMPTS.md`. Udfør **Del B** (daglig session-start) trin 1-6 nu, ordret. Det inkluderer: læs `CLAUDE.md` (du auto-loader den ikke), `git fetch --prune origin && git status -sb`, læs `docs/NOW.md`, og skriv `Codex — #5176 Supabase-rest (worktree fix-5176-matviews-behind-backend)` i feltet `🤖 Working agent` og push det STRAKS. Claude kan ikke se dig køre (#4016); det felt er den eneste lås.
2. Står der allerede en anden aktiv session i `🤖 Working agent` → STOP og spørg.
3. Opret worktree: `pwsh -File scripts/new-worktree.ps1 -Branch fix/5176-matviews-behind-backend`. Alt arbejde sker derinde. Hoved-checkoutet `C:\Dev\CyclingZone` er ejerens og Claudes; rør det kun for NOW.md-låsen.
4. Commit KUN bag guarden: `bash scripts/guard-commit-branch.sh <branch> <worktree-sti> && git -C <worktree-sti> commit -F <msg-fil>`. Kendt fælde (#5094): resolves `bash` ikke på PATH, så fejler guarden tavst. Kør `bash --version` én gang først; virker det ikke, brug `& "C:\Program Files\Git\bin\bash.exe"` og tjek at guarden faktisk kørte (exit 0, tavs). Commit-beskeder: `fix(security): ... (Refs #5176)`, sidste linje `Co-Authored-By: Codex <noreply@openai.com>`.
5. Læs FØR kode (hard rule 30, SSOT'er): `docs/SUPABASE_SECURITY_ADVISORS.md` (status pr. lint), `docs/GAME_INVARIANTS.md`, `database/schema-snapshot.json` (kolonnenavne; `riders` har `firstname`/`lastname`, ikke `name`). Opgave 2 kræver også Del C fra CODEX_PROMPTS.md.
6. Rør ALDRIG: `docs/NOW.md` ud over låse-feltet, `docs/MASTERPLAN.md`, `frontend/src/pages/PatchNotesPage.jsx`, `help.json`, `.claude/`, `.claude/workflows/wave.js`, `.claude/launch.json`, `scripts/ui-slop-baseline.json`, race engine (`backend/lib/engine/`), `backend/lib/economyEngine.js`, `backend/lib/boardWeekendFinalization.js` (#5182 afventer designsession med ejeren, genåbn ikke). Anvend ALDRIG en migration selv (ingen `execute_sql`/`apply_migration` mod prod); `database/*.sql` køres af `auto-migrate.yml` ved merge. Dump aldrig secret-værdier (`railway variables`, `vercel env ls`, `cat .env*`, `env` er forbudt).

## 1. Opgave 1 (primær): #5176, Supabase security-advisors fra 7 WARN til 0 inden 18/9

Baggrund: efter #5166 (11/9) står 7 WARN tilbage. Reglen (#5153) er at en WARN aldrig må stå over 7 dage; fristen er 18/9. Issue-teksten har tabellen; gentag den ikke, brug den.

### Spor 1a: de 4 matviews bag backend (kode)

`rider_rankings_mv`, `global_rank_mv`, `team_standings_ext_mv`, `team_race_points_mv` er læsbare for `authenticated` og læses direkte fra frontend (issuet siger 9 filer/10 reads; kandidater: `frontend/src/hooks/useGlobalRank.js`, `useRiderRankings.js`, `lib/seasonHonours.js`, `lib/dashboardMovementSignals.js`, `pages/StandingsPage.jsx`, `RiderRankingsPage.jsx`, `TeamProfilePage.jsx`, `SeasonEndPage.jsx`, `components/GlobalRankWidget.jsx`, `SeasonHonours.jsx`, `TeamStatsTab.jsx`, `TeamResultsTab.jsx`; find selv det præcise sæt med grep og læg listen i PR-body).

Gør sådan:
1. Kortlæg hver read: hvilken view, hvilke kolonner, hvilke filtre, hvor ofte (mount/poll). Læg tabellen i PR-body FØR du skriver kode; den er kontrakten.
2. Vælg pr. read: (A) eksisterende backend-endpoint udvidet, (B) nyt backend-endpoint i `backend/routes/` med zod-validering ved route-grænsen (#5158-retningen: nye filer i TypeScript), eller (C) `SECURITY INVOKER`-RPC med eksplicit kolonneliste. Standard er B; brug C kun hvis en read er så tæt på databasen at et endpoint kun ville være et pass-through. Skriv begrundelsen i én linje pr. read.
3. Frontend: skift reads til endpoint/RPC, behold komponenternes props/shape, så kun datalaget ændres. `frontend/src/preview/mockHandlers.js` + `seedData.js` skal stadig give preview-mock samme data (ejeren tester på preview før live, altid Android/Chrome, aldrig iOS).
4. Migration `database/<dato>-5176-revoke-matview-select.sql`: `REVOKE SELECT ON ... FROM authenticated, anon` for de 4 views, idempotent (tåler genkørsel), og GRANT til `service_role` eksplicit. Læg en verify-blok som kommentar nederst (den SQL Claude kører post-merge).
5. Tests: `node --test` for nye endpoints (happy path + 401/403 + tom sæson), frontend-hooks med mock-svar. Eksisterende tests der læser views direkte (fx `SeasonEndPage.*.test.js`) opdateres, ikke slettes.

### Spor 1b: de 3 definer-fund (dokumentation + beslutningsforslag, INGEN policy-ændring uden go)

- `is_admin()`: bruges i 61 policies `TO authenticated`; advisor-fundet er falsk positiv for os. Skriv accept-begrundelse i `docs/SUPABASE_SECURITY_ADVISORS.md` med dato og hvordan det re-verificeres. Alternativet (flyt til ikke-eksponeret skema + wrapper) beskrives med pris/gevinst, men implementeres ikke i denne PR.
- `founder_public_list()`: vurdér `SECURITY INVOKER` + policy på den underliggende tabel. Skriv fund + anbefaling; implementér KUN hvis det er rent (ingen adfærdsændring for spillere), ellers separat forslag.
- `is_offered_intake_rider(uuid)`: ejer-beslutning. Skal udloggede (anon) kunne læse `riders`? Policyen `Public read riders` (roles=public) kalder funktionen; anon får i dag 42501 (fail-closed, learning 2026-07-18). Find de offentlige sider der ville miste data hvis policyen scopes `TO authenticated` (landing, /roadmap, delte profiler, OG-billeder). Aflevér som A/B med 👍/👎 og din anbefaling. Ændr intet før ejeren svarer.

### Verifikation og aflevering (opgave 1)

TIER FULL, fordi backend + frontend + migration + >6 filer: `pwsh -File scripts/verify-local.ps1`, derefter i `frontend/`: `npm run lint`, `node --test`, `npm run build`. Kør i FORGRUNDEN og vent på output; en "baggrundsjob kører" er ikke et resultat. Derefter `pwsh -File scripts/preflight-pr.ps1` (PR-body-krav står i headeren). Loop-guard: 2 røde CI-kørsler på samme symptom → STOP og spørg.

Push tidligt: draft-PR inden 30 min, push mindst hvert 15. minut. PR-titel `fix(security): matviews bag backend + advisors-rest dokumenteret (Refs #5176)`. Brug PR-skabelonen; feltet Brugerverifikation som `- [x]` med hvad ejeren skal tjekke på preview (stillinger, ranglister, sæsonafslutning, dashboard-widget). "Refs", ikke "Closes"; ejeren lukker via label-maskinen. Patch note: ingen (skriv i PR-body: "ikke spillerrettet, ingen adfærdsændring"). PR-body slutter med `🤖 Generated with Codex`.

Når CI er grøn: meld tilbage med en tabel (spor | ændret | selv tjekket | antaget) og vent på ordret "merge". Ved "merge": `pwsh -File scripts/merge-queue.ps1 -Pr "<nr>"` (én ad gangen, aldrig manuelt `gh pr merge`). Efter merge: flip label `claude:todo` → `claude:done` på #5176 straks, kommentér issuet med hvad der er verificeret og hvad Claude skal post-verificere (advisor-tal efter migrationen).

## 2. Opgave 2 (kun efter ejeren siger "næste"): #5177, perf top 3 fra baseline 11/9

Ny worktree pr. spor, tre separate PR'er, ét spor ad gangen. Læs FØRST `docs/metrics/perf-baseline-2026-09-11.md` og Del C i CODEX_PROMPTS.md (frontend-kontrakt; CI-guards `lint-ui-slop`, `check-anti-slop`, `lint-t2-container-guard` skal køres lokalt før push, og baselinen må aldrig udvides).

1. **Footer-CLS** (`frontend/src/components/Brand.jsx`, wordmark-img uden width/height): eksplicit width/height + aspect-ratio. Mål: CLS forside 0,29 → under 0,1, også /login og /roadmap. Mindste PR først; den beviser målemetoden.
2. **/roadmap** (Perf 49 mobil, LCP 5,7 s, CLS 0,52): (a) reservér plads/skeleton til listen, (b) fjern render-blokerende CSS/JS over folden, lazy-load resten. Ingen designændring; skabelon og tokens bevares.
3. **index-chunk 233 KB gzip**: kør `rollup-plugin-visualizer`, find de 5 største bidrag i entry, flyt route-specifikt + charts (CategoricalChart 89 KB) til lazy chunks. Mål: entry under 180 KB gzip, LCP mobil forside 4,1 s → under 2,5 s. OBS: chunk-navne og boot-vagten blev lige rettet (#5165/#5168/#5173); ændr ikke `manualChunks`-navngivning eller reload-logik, kun hvad der ligger i entry.

Måling pr. spor: Lighthouse mobil, 3 kørsler, median, før og efter, mod baseline-tabellen; opdatér baseline-filen i samme PR. Tærskler: LCP ≤ 2,5 s mobil, CLS ≤ 0,1, Perf ≥ 90 på offentlige sider. Rammer et spor ikke tærsklen, så rapportér det målte tal, påstå ikke "forbedret". Verifikation: `npm run lint`, `node --test`, build, `node scripts/verify-affected.mjs`; spor 2-3 også `npm run test:e2e`. Patch note: skriv et EN/DA-udkast (to linjer, `docs/TONE_OF_VOICE.md`: "jeg/I", aldrig "vi") i PR-body; ejeren afgør om det går i den samlede 7.271-note. Screenshots før/efter (desktop + mobil) i PR-body, hard rule 26.

## 3. Arbejdsform hele sessionen

- Én beslutning ad gangen til ejeren, med tal og kontekst i selve spørgsmålet; aldrig en liste med 10 spørgsmål. Tekniske valg tager du selv.
- Spørg ved 70-95 % sikkerhed. Under 70 %: undersøg først. Over 95 %: gør det.
- Tidsstempler i dansk tid (Europe/Copenhagen); kør `Get-Date` før du logger noget.
- Blokerende kommandoer: aldrig `git diff` uden `--no-pager`, aldrig `gh pr checks --watch` i forgrunden. Lokalt verify → push → videre; tjek CI bagefter med `gh pr checks <nr>`.
- Finder du noget uden for scope (bug, dead code, dublet): søg dubletter med `gh issue list --search`, opret ét issue med klar tekst, fortsæt. Ret det ikke i samme PR medmindre det er nødvendigt for sporet.
- Meld status for hver 45. minut, også når intet er færdigt: hvad er gjort, hvad er næste, hvad blokerer.

## 4. Close-out (obligatorisk, uanset hvor langt du nåede)

1. Alt committet + pushet på branchen; worktree efterlades ren (ingen ucommitterede filer).
2. Issue-kommentar på #5176 (og #5177 hvis rørt): tabel med spor | status | verificeret hvordan | udestår. Postmortem ved bugfix: `.claude/learnings/2026-09-12-<slug>.md`.
3. Nulstil `🤖 Working agent` til `Ingen aktiv session` i `docs/NOW.md` og push (kun det felt).
4. `pwsh -File scripts/check-agent-token-hygiene.ps1` skal ende på 0 fail. Kendt undtagelse 12/9: `AGENTS.md` står på 6.576 tokens mod loft 6.500 (siden #5142-mergen 11/9). Den fejl må du rapportere, ikke rette; trim aldrig `AGENTS.md` selv. Alle andre linjer skal være OK/WARN.
5. `pwsh -File scripts/close-out-cleanup.ps1` (dry-run; `-Execute` kun for dine egne efterladte processer).
6. Sidste besked til ejeren: tre linjer. Hvad er merget, hvad venter på go, hvad Claude skal post-verificere. Foreslå "Næste session starter med #N ...".
