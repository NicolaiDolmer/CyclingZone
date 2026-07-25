# Lørdagsbølge 3 — 2026-07-25 aften (dag-bølge med ejer til stede)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | ~17:10 → ~21:45 |
| Agenter launched / fuldført / døde | 14 (13 + 1 opfølger) / 14 / 0 tabt — men 9 masse-stallede ~2 t og blev genoplivet |
| PR'er åbnet / merged | 14 / 14 (13 bølge-PR'er + patch-notes #2980) |
| Issues → claude:done | #2882 #2888 #2895 #2898 #2899 #2906 #2912 #2919 #2920 #2921 #2924 #2925 #2943 #2945 #2951 #2952 #2962 (17) |
| Nye issues oprettet | #2962 (lukket samme aften) · #2974 · #2976 |
| gh-401-retries | preflight-probe: 0 (1. forsøg ok); spredte retries via wrapper under bølgen |
| Recoveries (type) | 8× TaskStop+SendMessage-resume (transcript intakt, 100 % leverede efter genoplivning) + 2× resume af auktions-sporet |
| Preflight | GO ~17:05 (.codex.local/night-wave-preflight.json) |

## Leverancer (spillervendt)
Personlig sæsonslut-besked (#2924, klar til søndagens cutover) · kom-i-gang-kort (#2925, live mandag) · scouting-notifikation (#2945) · auktions-pensionsbadge (#2943) · gældsfairness + frys-besked (#2912/#2919/#2920) · trup-tabel-løft (#2888/#2906, 2 ejer-runder) · Discord-resultat-pålidelighed (#2882) · HoF/paginering del 1+2 (#2951/#2962, inkl. aktiv 5.212-rækkers admin-bug) · transitions-observabilitet (#2921) · fuld-sim-fejltjek (#2898) · indexes (#2895, post-verificeret i prod) · Railway healthcheck (#2899). Designrunde #2905 leveret som input — ejer-beslutning: fælles design-session fra bunden næste gang.

## Afvigelser/læringer (detaljer i .claude/learnings/2026-07-25-wave3-mass-stall-and-guard-preflight.md)
- **Masse-stall:** 9 af 13 agenter stoppede stille uden completion-notifikation; opdaget via ground truth (0 worktree-writes), IKKE via transcript-mtime (skrives først ved completion — blindgyde). Recovery: TaskStop + SendMessage-resume bevarer transcript-kontekst; alle leverede efter genoplivning (indexes-sporet på minutter).
- **Bølge-kontrakten manglede CI-guard-scripts** (tone-em-dash, i18n-leaks, swallowed-catches, warning-budget) → 3 undgåelige CI-runder tidligt. Midtvejs-broadcast lukkede klassen; skal ind i kontrakt-skabelonen permanent.
- **3 parallelle sessioner** (Sponsorvalg #2955, deps/v7 #2959, bølgen) gav base-drift: no-dupe-keys i merge-ref, react-router-dom-import brød i CI men ikke lokalt, kryds-PR-konflikt i seasonTransition. Løst centralt pr. runbook (merge intentionerne). update-branch, ikke rerun, ved main-afhængige fixes; 0-steps-cancelled = infra → rerun.
- **Orkestrator-proces-fejl:** flaky-test-fix pushet til main FØR lokal verifikation (ufuldstændig node_modules maskerede resultatet; kæden gatede ikke på testen). Fixet viste sig validt, men rækkefølgen var forkert.
- **Preview-gated feature** (#2925) usynlig på preview-build → ejer-friktion ("spild ikke min tid med et build"). Memory-regel opdateret: gated features skal have preview-synlig vej ELLER eksplicit "ikke synlig på preview fordi X".
- **Første subscription nogensinde** landede 17:45 under bølgen (Alunta checkout.completed) → audit-whitelist-entry pensioneret på main som unblocker.
- Agent-tool-fanout (baggrund, ingen barriere) i stedet for Workflow-kald: per-agent-notifikationer virkede, men masse-stall viser at chunking-reglen (6-8 ad gangen) også gælder her.
