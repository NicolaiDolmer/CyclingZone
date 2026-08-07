# Natbølge 2026-08-07 (aften/nat, 15 hovedopgaver + 2 ekstra, orkestreret parallel-session)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | ~17:15 → ~02:00 (8/8) |
| Agenter launched / fuldført / strandede | 15 (9 ordinære + 4 recovery + 2 ekstra) / 15 / 4 strandede undervejs, alle reddet via TaskStop + recovery i samme worktree |
| PR'er åbnet / merged | 15 / 13 (2 drafts afventer ejer-go: #3539 + #3498-draften) |
| Issues → claude:done | #3495 #3497 #3502 #3454 #3505 #3506 #3507 #3508 #3509 #3510 #3519 #3520 #3521 + #3522/#3523 (lukket uden PR) |
| gh-401-retries | 0 observeret |
| Recoveries (type) | 4 (uncommitted-i-worktree: 3 · stashed-i-worktree: 1) |
| Preflight | IKKE kørt (fejl: runbook ikke læst før launch; se learnings) |

## Leverancer

- **Blok A (bugs, merged):** #3509 gold-CTA-prioritet (PR #3526) · #3495 tusindtalsseparator-pengebug m. delt amountInput-helper (PR #3532) · #3508 disponibel saldo m. delt availableBalance-helper (PR #3535) · #3506 standings-scope AI-inkluderet (PR #3536) · #3507 rangliste-link + gc/classic-split (PR #3537) · #3510 ErrorState + skeleton-defaults (PR #3538)
- **Blok B (UI, ejer-godkendt + merged):** #3454 Akademi→T2 + T2-container-guard (PR #3528) · #3497 grå stjerner fjernet, 12 steder + forward-guard (PR #3533) · #3520 rytter-popup i holdudtagelsen (PR #3534)
- **Blok C (forudsætninger):** #3505 board_critical klik-mål + Board-filter (PR #3525) · #3502 board-crons genoplivet, per-hold-gate + rollout-floor 15/8 (PR #3527; fund: 149 holds bulk-auto-accept afværget)
- **Blok D (spillerønsker):** #3519 synlige KOM/sprint-pointtotaler m. parity-test (PR #3530) · #3521 Transfers-badge via inboxPending-kilden (PR #3531, sidegevinst: realtime-kanal-kollision fixet) · #3522 lukket uden PR (hjælpen dækkede allerede siden 10/7; discoverability-hul dokumenteret) · #3523 lukket uden PR (tilsigtet #1995-defer-design verificeret end-to-end i prod, Kai M. Liang-casen; kommunikations-hul dokumenteret m. anbefaling)
- **Ekstra (proaktiv-mandat, drafts til ejer-go):** #3300 akademi-badge på træningssiden (PR #3539) · #3498 admin-UI-oprydning (draft, PR-nr. i issue-tråden)
- **Afledt:** bundle-budget 894→896→898 (dokumenteret i _note, forenings-sum re-målt ved denne close-out) · patch note v7.106 (#3497) + samlet v7.107 (denne PR) · help.json: pointtotal-synlighed tilføjet trøje-afsnittet (EN+DA)

## Afvigelser/læringer

- Runbook ikke læst før launch → op til 5 parallelle fulde e2e-suiter gav kontention: suite-tid 15-25 min → 2+ timer + flake-storme (op til 31 falske fejl/kørsel). Omlagt til seriel test-slot: 9,6 min / 0 fejl. Fuld postmortem: `.claude/learnings/2026-08-07-night-wave-parallel-e2e-contention.md`
- 4 agenter strandede i passiv baggrunds-venten (kendt PC-svaghed: background-bash flusher ikke output gennem tail, fundet af #3510-agenten). Alle reddet uden tab af arbejde; forward-guards i learnings.
- perf-gate afslørede opbrugt bundle-budget (0,1 KB); hævet efter konvention i to trin med måling.
- Kendte opfølgninger til ejer-beslutning: RiderComparePage mangler alders-visning efter grå-tone-fjernelse · racehub-boardet ikke dækket af #3520-popup · free agents vises i alle divisions-filtre på ranglisten (præeksisterende) · dedikeret preview-scenarie for AI-hold i standings-seed.
