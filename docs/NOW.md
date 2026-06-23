# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (23/6 — op/nedrykning BYGGET): review/merge klare PR'er + byg #1760-visningen. Venter på DIG:** **[#1783](https://github.com/NicolaiDolmer/CyclingZone/pull/1783)** (op/nedrykning-engine — kerne-økonomi, INGEN migration, 2127 tests grønne, ejer-review), **#1767** (konto — `database/*.sql`-migration, du merger), **#1764** (academy-script — du kører), **#1782** (akademi-idempotens, ikke-min). Recovery: backup `cyclingzone-20260622-153339` (VERIFIED) + PITR.
> - **Natbølge 23/6 (merged):** 13 PR'er (#1735/#1742/#1739/#1650/#1669/#1666/#1676 + frontend #1741/#1738/#1750/#1747/#1749/#1755/#1675 + #1772 CI-fix). Backend live (Railway); frontend afventer Vercel hobby rate-limit (~24t/Pro). Artifact: [night-wave-2026-06-23](audits/night-wave-2026-06-23.md).
> - **Op/nedrykning (#1152, ejer-besluttet 23/6 = aktiv nu, per-pulje binær-træ):** engine = PR #1783 (top 2 op→forælder-pulje, bund 4 delt 2+2→børne-puljer; Div4 udskudt til Div3-pulje all-real; ingen migration). **VISNING (#1760/#1745) = follow-up:** opdatér standings-zoner til **2-op/4-ned per pulje** (matcher engine). Spec: [promotion-relegation-design](superpowers/specs/2026-06-23-promotion-relegation-design.md). #1240 (board fjern/erstat-mål) → #1187-B.
> - **Ejer-beslutninger (åbne):** #1276 PCM-IP · #1278 spiller-comms (du voicer) · #1487-budget · #929 leaked-pw · #691 key-rotation · #940 NPS.
> - **Hygiejne:** Vercel hobby rate-limit (overvej Pro). preflight tjekker nu grøn origin/main før bølge (f7b10d0a). #1733 drop prod-backup-tabeller når stabilt. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701). **Op/nedrykning: ejer-besluttet 23/6 = aktivér NU (intet låst), per-pulje — gennemregnet forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ([spec](superpowers/specs/2026-06-23-promotion-relegation-design.md)) afventer godkendelse før build.**
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
