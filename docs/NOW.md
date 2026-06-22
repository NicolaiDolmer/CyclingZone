# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (23/6 nat — natbølge BYGGET, ikke merged): MERGE 15 PR'er (KUN dig — branch protection kræver din godkendelse; jeg kan ikke merge/bypasse uden din tilladelse). Start med #1772 (CI-fix: patchNotes v5.97 category). ⚠️ Vercel hobby rate-limited (~24t): frontend-merges går IKKE live før reset/Pro; backend (Railway) går live.** Fuld merge-runbook + risiko-review: [night-wave-2026-06-23](audits/night-wave-2026-06-23.md). Recovery: backup `cyclingzone-20260622-153339` (VERIFIED) + PITR.
> - **Natbølge `wf_8f8a17e2-dc5` (16 agenter):** backend/safe = #1757(#1735·409), #1758(#1742·pensioneret-filter), #1759(#1739·AI-trim), #1768(#1650/#1669·events). Ejer-review = #1760(#1745), #1761(#1741), #1766(#1738/#1750/#1240), #1762(#1749), #1765(#1747), #1767(#1746·**MIGRATION**), #1769(#1755), #1764(#1756·script), #1763(#1666·security), #1770(#1676·balance), #1771(#1675). #1580/#1591 = already-done.
> - **Merge-rækkefølge:** #1772 → backend-safe → frontend/resten. #1767 = migration auto-applies (ejer merger); #1764 = ejer kører reconcile-script. Alle fleet-PR'er har stale-rød `frontend-build` (arvede patchNotes-bug fra base) → grøn efter #1772 + "Update branch", eller merge-resultat henter fixet uanset.
> - **Ejer-beslutninger (åbne):** #1276 PCM-IP · #1278 spiller-comms (du voicer) · #1487-budget · #929 leaked-pw · #691 key-rotation · #940 NPS.
> - **Hygiejne:** #1650 feature-liveness 'audit'-check fejler på alle PRs (ikke-required støj). #1733 drop prod-backup-tabeller når stabilt. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701; (a) op/nedrykning gated sæson 3).
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
