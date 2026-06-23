# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (23/6 morgen — natbølge SHIPPED): 13 PR'er merged til main + patch-note v5.99. Backend live via Railway; frontend afventer Vercel-deploy (hobby rate-limit ~24t → vent på reset eller Vercel Pro). 3 PR'er venter på DIG:** **#1767** (konto e-mail/brugernavn — `database/*.sql`-migration, du merger), **#1764** (academy-reconcile — du kører scriptet), **#1760** (op/nedrykning — KRÆVER beslutning, se nedenfor). Recovery: backup `cyclingzone-20260622-153339` (VERIFIED) + PITR.
> - **Merged (natbølge `wf_8f8a17e2-dc5` + 2 review-bølger):** #1735, #1742, #1739, #1650/#1669 (backend, live) · #1666 security · #1676 træthed-recovery · #1741, #1738/#1750, #1747, #1749, #1755, #1675 (frontend, afventer Vercel) · #1772 CI-fix. Alle adversarisk reviewet; #1746/#1666/#1755 hærdet efter review. Artifact: [night-wave-2026-06-23](audits/night-wave-2026-06-23.md).
> - **⚠️ #1760 (op/nedrykning) = needs-fix, KRÆVER beslutning** (per-pulje-visning modsiger backend per-division-mekanik; design-fork bundet til [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152)). Valg A (anbefalet): division-bred zone + "pr. division"-tekst (matcher koden). Valg B: per-pulje-backend + luk #1152 først. #1240 (board fjern/erstat-mål) udskudt til #1187-B.
> - **Ejer-beslutninger (åbne):** #1276 PCM-IP · #1278 spiller-comms (du voicer) · #1487-budget · #929 leaked-pw · #691 key-rotation · #940 NPS.
> - **Hygiejne:** Vercel hobby rate-limit (overvej Pro før næste bølge). `audit`-CI-check er ikke-required støj. #1733 drop prod-backup-tabeller når stabilt. 30 fleet-worktrees ryddes. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701). **Op/nedrykning: ejer-besluttet 23/6 = aktivér NU (intet låst), per-pulje — gennemregnet forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ([spec](superpowers/specs/2026-06-23-promotion-relegation-design.md)) afventer godkendelse før build.**
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
