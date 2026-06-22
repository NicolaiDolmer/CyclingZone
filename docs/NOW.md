# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (22/6 — LAUNCH LIVE ✅): auktion-korrekthed (#1694/#1693) + landing-header (#1697) merged + deployet. Næste store session = launch-bug-batch fra Discord-feedback (spillere møder dem NU).** Permanent frisk sæson 1 live; recovery: backup `cyclingzone-20260622-153339` (verify-restore VERIFIED) + PITR.
> - **Merged i dag (launch-batch):** #1709/#1710 kalender-cadence · #1713/#1714/#1716/#1717/#1718/#1719/#1720/#1721 UX-batch · **#1694/#1693 auktion-korrekthed** (squad-fuld hard-blokerer bud + vundet-pris i CZ$) · **#1697 landing-header solid** · v5.93/v5.95/v5.96 patch-notes. Prod-backups: teams_balance_backup_20260622, dedup_bk_*, training_day_runs_backup_20260622 (drop når stabilt — #1733).
> - **Næste prioritet (launch-bugs, Discord-sweep 22/6):** #1748 rytter-dobbeltadgang (auktion+transfer — beslægtet med #1694) · #1740 auto-bud "overbudt"-fejl · #1742 pensionerede under frie ungdom · #1739 AI-hold bliver i division ved oprykning · #1745/#1750/#1738/#1741/#1746/#1747/#1749/#1743/#1744. Polish: #1672 skades-"0 dage" · #1674 vis alder · #1671 sortér Alle-fane.
> - **Ejer-beslutninger (åbne):** #1276 PCM-IP (rytternavne i public repo) · #1278 spiller-comms (founder-voice, du voicer) · #1487-budget (evne-nerf live, budget separat) · #929 leaked-pw · #691 key-rotation · #940 NPS.
> - **Hygiejne:** #1650 feature-liveness 'audit'-check fejler på alle PRs (6 findings, ikke-required men støj). #1693a lukket by-design (fejringspopup + notifikation = bevidst 2 lag). [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Claude · Code (Opus 4.8) · 2026-06-22 — orchestrating 4 parallelle worktree-sessions: #1748/#1740/#1743 (auktion/akademi-korrekthed) + #1744 (akademi-UX) + #1672 (skade-bug) + #1674/#1671 (rytter-visning).

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701; (a) op/nedrykning gated sæson 3).
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
