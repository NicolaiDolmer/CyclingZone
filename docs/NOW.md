# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (23/6 — LAUNCH LIVE ✅): launch-bug-batch SHIPPED (auktion/akademi-korrekthed #1748/#1740/#1743 verificeret live i prod). Næste = resten af launch-bugs (#1742, #1739, #1745, #1741, #1738 …) — kan køres som ny parallel-fleet.** Permanent frisk sæson 1 live; recovery: backup `cyclingzone-20260622-153339` (VERIFIED) + PITR.
> - **Merged 22-23/6 (launch-batch):** kalender-cadence + UX-batch (#1709-1721) · #1694/#1693 + **#1748/#1740/#1743 auktion/akademi-korrekthed** (RLS-migration live: 68 intake skjult, 12.604 ryttere læsbare for anon) · #1697 landing-header · **#1672 skades-dage · #1744 akademi-bekræftelse · #1674/#1671 rytter-alder+sort** · v5.93-5.98 patch-notes.
> - **Næste prioritet (launch-bugs):** #1742 pensionerede under frie ungdom · #1739 AI-hold bliver i division · #1745 op/nedrykning-visning · #1741 transferhistorik · #1738 bestyrelse-DNA · #1746/#1747/#1749/#1750. Systemisk: **#1755** rytter-oversigt-konsistens + universel sort. Cleanup: #1756 stale academy_intake.
> - **Ejer-beslutninger (åbne):** #1276 PCM-IP · #1278 spiller-comms (du voicer) · #1487-budget · #929 leaked-pw · #691 key-rotation · #940 NPS.
> - **Hygiejne:** #1650 feature-liveness 'audit'-check fejler på alle PRs (ikke-required støj). #1733 drop prod-backup-tabeller når stabilt. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701; (a) op/nedrykning gated sæson 3).
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
