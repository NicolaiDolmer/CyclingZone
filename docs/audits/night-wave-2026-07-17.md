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

### Chunk B + C — ALDRIG LAUNCHED (se Afvigelser)

#2449, #2518, #2444, #2414, #2440, #2535, #2462, #2522, #2451, #2523, #2524, #2526, #2508, #2450, #2453, #2529, #2411 — alle urørte, står stadig `claude:todo`. Reserven (#2479/#2415/#2430) urørt.

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
