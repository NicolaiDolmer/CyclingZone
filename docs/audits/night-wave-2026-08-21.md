# Natbølge 2026-08-21

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 23:47 → 07:55 (incl. morgen-recovery af 2 stallede spor) |
| Agenter launched / fuldført / døde | 21 / 19 / 2 (begge reddet af orkestrator) |
| PR'er åbnet / merged | 14 / 6 (+2 på auto-merge: #4046, #4057) |
| Issues → claude:done | #3980, #3994, #4038, #3963, #3983, #4035, #4031, #4023, #4024, #4014, #3978, #3988 |
| Verify-gate-fangster | #3980/#3994 lukket m. evidens; #3988 allerede løst; #4001 blokeret af låst ejer-beslutning; #4004 IKKE løst (modsat antaget) |
| gh-401-retries | Preflight: 0 (1. forsøg ok); bølge: håndteret via gh-retry-wrapper |
| Recoveries (type) | 2 (uncommitted-i-worktree: 1 → PR #4057; intet-spor: 1 → redone som PR #4060) |
| Preflight | GO kl. 23:44 (.codex.local/night-wave-preflight.json) |

## Til ejer-go (morgen)

- **UI-PR'er (visuelt go):** #4052 W7-hjælpetekster · #4053 loft-visning (draft) · #4054 watchlist-ikoner · #4055 evne-sort i udtagelse · #4056 fyr akademirytter (draft) · #4060 /pro moms+pro-rata-copy
- **Beslutninger:** #4004 (auktions-transparens er reelt IKKE bygget — needs-decision består) · #4001 (låst "symbolsk værdi accepteret" vs. ønsket fix før søndag) · #4005 punkt 3 (præcis formulering fra friisisch)
- **Investigations klar:** #3966/#3965 (træning/punch → designsession) · #3981/#4006 (digest-forskydning/done-mismatch)

## Afvigelser/læringer

- **2 agenter hang 6-7 timer** (chunk 2 fix-3896 frøs 01:11 m. færdig ukommitteret diff; chunk 3 feat-4005 frøs 02:12 uden spor). Rod-årsag: anti-hang-lag 3+4 (periodisk stall-watch + per-agent timeout) blev ikke etableret ved launch — completion-notifikation var eneste vækning. Postmortem: `.claude/learnings/2026-08-21-natboelge-barrier-hang-ingen-watchdog.md`. Bindende næste bølge: uafhængig watchdog oprettes i samme tur som launch.
- **Security-flag på 2 auto-merges:** #4052 (UI-legend i hjælpe-PR) — auto-merge afvæbnet af orkestrator, venter visuelt go. #4047 (ops-vagter) self-merged af agent — backend-only, men diff-review udestår hos orkestrator + verifikation af første workflow-kørsel.
- **Backlog-sweep gav 0 lukninger** (konservativ instruks). Næste gang: orkestrator-drevet evidens-runde i stedet.
- Verify-first-gaten (indført efter ejer-korrektion i går aftes) fangede 4 forkerte antagelser FØR spildt byggearbejde.

Refs #605.
