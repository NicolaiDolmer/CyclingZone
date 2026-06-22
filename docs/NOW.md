# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (22/6): FOREVER-RELAUNCH + post-relaunch UX-batch GENNEMFØRT ✅ — næste = browser-verify + spiller-comms (ejer-koordineret) + merge #1711.** Permanent frisk sæson 1 LIVE. Recovery-net: backup `cyclingzone-20260622-153339` (verify-restore VERIFIED) + PITR (archive_mode=on). **Post-verify grøn:** 7 live puljer per-division-kalender (101 løb scheduled + 432 profiler/etape-tider), AI-fyld 143×8, 25 managers i div 3 (div 4 tom), frisk marked 799, founder-badges 25, board pending_5yr, flags on, #1137-progression aktiveret (peakAge=28).
> - **Merged til main i dag:** #1709 (kalender-wiring) · #1710 (cadence-fix tæt-pakket 2/dag) · v5.93 patch-notes (#1708).
> - **Post-relaunch UX-batch (22/6):** #1713 akademi-pris · #1714 kalender-de-dup (regen'et live, 0 dubletter, alle 7 puljer) · #1716 træning-reset · #1717 startbalance 500k (migration) · #1718 standings div 1+2 · #1719/#1720 fyring+kontraktforlængelse · #1721 board verificeret fuldt aktiv · v5.95 patch-notes. Prod-data ændret m. backups: teams_balance_backup_20260622, dedup_bk_*, training_day_runs_backup_20260622 (drop når stabilt). Browser-verify udestår.
> - **PR #1711 (relaunch fast-follow, ejer merger):** `academyHealSweep` is_ai-filter (fiksede 564 strandede AI-academy-kuld — ryddet i prod) + `SEASON_RIDER_PROGRESSION_ENABLED` true (#1137, aktiveres sæson 1→2-transition).
> - **COMMS (bevidst udskudt — ejer-valg 22/6):** in-app broadcast + Discord = ejer voicer (founder-ToV); jeg leverer udkast/fakta når du er klar. Patch-notes v5.93 allerede live.
> - **FAST-FOLLOW (efter comms):** fuld **140-etaper/5-per-dag/28-dages-rekalibrering** (rører `race_days_total` → board/sponsor/progression, kræver SIMULERING — spawned task) · Discord-sweep #7/#13/#14/#15 · frontend de-slop #3/#4/#8 · ægte højdeprofiler #1021. **Åbne ejer:** #1276 PCM-IP · #929 leaked-pw · #691 key-rotation · #940 NPS. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701; (a) op/nedrykning gated sæson 3).
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
