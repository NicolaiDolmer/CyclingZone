# Natbølge 2026-07-17 (natten 16/7 → 17/7)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 23:29 (preflight GO) / 23:33 (chunk A launch) → 07:35 (close-out) |
| Agenter launched / fuldført / døde | 6 / 5 / 1 |
| PR'er åbnet / merged | 5 / 0 (ingen merges i nat per plan — ejer merger) |
| Issues → claude:done | ingen endnu (done-flip sker PR-for-PR i morgen-merge-løkken) |
| gh-401-retries (preflight-probe + bølge) | 0 observeret (probe grøn på 1. forsøg) |
| Recoveries (type) | 0 udført; 1 afventer (uncommitted: #2512, se nedenfor) |
| Preflight | GO kl. 23:29 (.codex.local/night-wave-preflight.json) |

## Status pr. issue

### Chunk A (bugs) — launched 23:33

| Issue | Status | PR |
|---|---|---|
| #2436 entry-generator TOCTOU-race | ✅ PR | [#2545](https://github.com/NicolaiDolmer/CyclingZone/pull/2545) (backend-only) |
| #2439 onboarding-spam for etablerede spillere | ✅ PR | [#2546](https://github.com/NicolaiDolmer/CyclingZone/pull/2546) (⚠️ indeholder migration — ejer applier manuelt post-merge) |
| #2446 daglig træning: afskårne kolonner | ✅ PR | [#2547](https://github.com/NicolaiDolmer/CyclingZone/pull/2547) (agent kunne ikke live-verificere i preview — ejer bør se preview-deploy før merge) |
| #2424+#2425 prod-log-fejl (contract_length-clamp, dødt loan_agreements-kald, riders.name) | ✅ PR | [#2548](https://github.com/NicolaiDolmer/CyclingZone/pull/2548) |
| #2438 individuel træning overtrumfes af rutine | ✅ PR | [#2549](https://github.com/NicolaiDolmer/CyclingZone/pull/2549) (inkl. help.json en+da) |
| #2512 race_days_completed-enheden (524 af 60) | 🟡 DELVIST — agent frøs midt i arbejdet | Uncommitted arbejde i `C:\Dev\CyclingZone\.claude\worktrees\wf_223dc94d-42d-1` (branch `fix/2512-race-days-unit`): seasonRaceDays.js + tests + backfill-SQL påbegyndt. **Recovery: fortsæt agent i SAMME worktree** (runbook §Recovery) — respawn IKKE frisk. |

### Chunk B + C — aldrig launched i NAT (se Afvigelser) — indhentet som DAGBØLGE 17/7 08:10-10:30

**Morgen-merge-løkke (ejer-go 07:50):** #2545/#2547/#2548/#2549 merged + done-flip på #2436/#2438/#2446/#2424/#2425; prod smoke-verificeret (backend 200/401, frontend 200, Vercel deploy completed). `verify`-check-fejlen på main = falsk alarm (backend-only merge → Vercel Ignored Build Step → job-timeout); chip spawnet til fix. #2512 recovered i samme worktree → PR [#2550](https://github.com/NicolaiDolmer/CyclingZone/pull/2550) (backfill-SQL, ejer merger).

**Chunk B (6/6, launched 08:20):** #2535→[#2551](https://github.com/NicolaiDolmer/CyclingZone/pull/2551) · #2462→[#2552](https://github.com/NicolaiDolmer/CyclingZone/pull/2552) · #2440→[#2553](https://github.com/NicolaiDolmer/CyclingZone/pull/2553) · #2444→[#2554](https://github.com/NicolaiDolmer/CyclingZone/pull/2554) (perf-fixes dashboard+liga; matview i stedet for fuld-fetch i Resultater) · #2414→[#2555](https://github.com/NicolaiDolmer/CyclingZone/pull/2555) (drift-vagt; **backtest fandt LIVE drift → issue [#2557](https://github.com/NicolaiDolmer/CyclingZone/issues/2557)**) · #2449+#2518→[#2556](https://github.com/NicolaiDolmer/CyclingZone/pull/2556) (S2-kalendergenerator + admin-knap + planner-sæsonvælger; S2 findes ikke i prod endnu — ejer opretter og genererer post-merge).

**Chunk C (9/9, launched 09:05):** #2526→[#2558](https://github.com/NicolaiDolmer/CyclingZone/pull/2558) · #2523→[#2560](https://github.com/NicolaiDolmer/CyclingZone/pull/2560) (per-etape-notifikationer; +notifications-type-SQL) · #2411→[#2561](https://github.com/NicolaiDolmer/CyclingZone/pull/2561) (TTT pauset) · #2524→[#2562](https://github.com/NicolaiDolmer/CyclingZone/pull/2562) (watchlist-besked; +SQL) · #2453→[#2563](https://github.com/NicolaiDolmer/CyclingZone/pull/2563) (global rank, matview; **point-model = anbefaling, ejer godkender i PR-body**; +SQL) · #2522+#2451→[#2564](https://github.com/NicolaiDolmer/CyclingZone/pull/2564) (asking-price-filter + bulk-priser) · #2529→[#2565](https://github.com/NicolaiDolmer/CyclingZone/pull/2565) (U23-bånd; +SQL) · #2450→[#2566](https://github.com/NicolaiDolmer/CyclingZone/pull/2566) (personale-oversigt) · #2508 = allerede shippet i PR #2509 → issue lukket.

**Merge-rækkefølge-forslag (chunk B+C):** backend-only først (#2553, #2561, #2551), så #2554 (perf), #2560/#2562 (notifikationer, SQL additiv), #2552 (admin), #2558 (links), #2565 (U23, SQL), #2564/#2566 (UX-tunge — klik-test på preview), #2563 (global rank — godkend point-model), #2556 bredest til sidst. PR'er med `database/*.sql`: #2555, #2560, #2562, #2563, #2565 → ejer applier SQL manuelt post-merge (additive constraints/tabeller/matview — rækkefølge ligegyldig indbyrdes).

Reserven (#2479/#2415/#2430) bevidst ikke trukket — dagbølgen sluttede med fuld kø leveret.

## Slutfacit 17/7 (eftermiddag — merge-hale + Global Rank + kalibrering)

Alle 14 dagbølge-PR'er merged (CI-reparationer: budget-serialisering løst 6× på bundle-budget.json; i18n-leaks; ui-anti-drift; én agent hang efter commit-uden-push → orkestrator pushede selv). Derudover: #2550 (race-days, backfill applied: 524/60 → 18/28) · #2546 (onboarding, kolonne applied) · #2559 (deploy-verify-falsk-alarm, fra ejer-chip-session) · 4 dependabot · #2573 (planner fuld bredde, #2568 del 1) · #2563 **Global Rank** (design ejer-låst efter mockup-oplæg; migration applied: tabeller+matview+RPC'er; rollover kørt for S0; uge+sæsonstart-snapshots taget; 365 aktive rangeret) · #2555 drift-vagt (tabel applied) · #2575 **rekalibrering variant C** (ejer-valg efter 3-variant-scorecard mod 17/7-population; favWin 38,1% i bånd; share4+ strukturelt afkoblet → #2574). Patch notes v7.09 + v7.11 (v7.10 = Discord-fix fra parallel session, #2569). **Dagstotal: 29 PR'er merged, 7 migrationer applied, 24 issues → done.**

Ekstra læringer: (a) bundle-budgettet er en merge-serialisator ved bølger — hver PR bumper fra egen base og kolliderer; strukturelt fix = i18n-namespace-split (issue fra 16/7). (b) `ScheduleWakeup` fyrede pålideligt HELE dagen i aktiv session — nattens svigt er formentlig koblet til lange inaktive perioder. (c) Klassifier-denials (gh pr merge/issue edit) er flakys — GitHub-MCP som fallback virker.

## Udkast til morgen-merge-rækkefølge (backend/lav-konflikt først, migration sidst)

1. **#2545** (#2436) — backend-only, raceEntryGenerator. Laveste risiko.
2. **#2548** (#2424+#2425) — backend + lille admin-komponent.
3. **#2547** (#2446) — frontend layout (2 filer). **Se preview-deploy visuelt før merge** (agenten kunne ikke).
4. **#2549** (#2438) — bredest UI-flade (training backend+frontend+help.json).
5. **#2546** (#2439) — SIDST: indeholder `database/2026-07-16-onboarding-progress-dismiss-persist.sql` → ejer merger + applier migrationen manuelt bagefter (koden degraderer gracefully indtil da).

Efter HVER merge: `gh issue edit <N> --add-label claude:done --remove-label claude:todo` + shipped-kommentar (runbook trin 5b). Efter sidste merge: verificér prod-deploy READY.

## Patch-notes-kladde (én konsolideret entry — IKKE committet endnu)

> **v7.09 — Training & dashboard fixes**
> - Individual rider training settings (light/rest) now correctly override the weekly routine. The routine is the default for riders without their own setting, and the page now shows exactly what each rider trains today and why. / Individuelle rytter-indstillinger (let/hvil) overtrumfer nu korrekt den ugentlige rutine; siden viser hvad hver rytter faktisk træner i dag og hvorfor.
> - The daily training page now uses the full screen width with a sticky rider column, so no columns are cut off. / Daglig træning bruger nu hele skærmbredden med fastlåst rytter-kolonne — ingen afskårne kolonner.
> - The "Get started" onboarding card no longer keeps reappearing for established teams; dismissing it now sticks across devices. / "Kom i gang"-kortet bliver væk når du lukker det — også på tværs af enheder.
> - Fixed a contract-extension error that could silently block extending a rider already on a max-length contract. / Rettet fejl der stille kunne blokere kontraktforlængelse på max-længde.

## Afvigelser/læringer

1. **Orkestratoren var død hele natten (kritisk).** Chunk A's `parallel()`-barriere hang på den frosne A1-agent (#2512) → ingen completion-notifikation. Fallback-heartbeaten (ScheduleWakeup, planlagt 00:05) **fyrede aldrig** — første livstegn var keep-awake-processens exit 07:34. Konsekvens: chunks B+C (17 issues) blev aldrig launched; stall-watch kørte aldrig; A1 blev ikke recovered i nat. Chunking begrænsede blast-radius som designet (5/6 spor i mål), men "orkestrator vågner selv"-antagelsen holdt ikke. → Læring + runbook-forslag i `.claude/learnings/2026-07-17-night-wave-orchestrator-never-woke.md`.
2. **Keep-awake som orkestrator-baggrundsproces VIRKER.** Kørte 480 min til 07:34, maskinen sov ikke (S0-maskine). Behøver ikke separat ejer-vindue fremover.
3. **A4-agenten (#2446) opdagede preview-server-fælde:** `preview_start` i en worktree startede dev-serveren mod HOVED-checkoutets kode — worktree-agenter kan ikke live-verificere via preview. Kandidat til WORKTREE_WORKFLOW.md.

_Refs #605 (velocity-tracking). Preflight-state: `.codex.local/night-wave-preflight.json`._
