# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (23/6 — op/nedrykning LIVE):** **5 PR'er merged + live:** #1782 + #1764 + #1783 (engine) + #1767 (konto, migration verificeret i prod: trigger+backfill+lower(username)-index) + #1787 (#1760-visning, erstatter gl. #1760). **Op/nedrykning er nu live** (patch v6.01). Næste kandidat: **[#1791](https://github.com/NicolaiDolmer/CyclingZone/issues/1791) ungdoms-rytter-evner-rework** (spec+plan klar 23/6, subagent-drevet i frisk session; Fase A-C autonomt → ejer-kalibrerings-gate D → migrering E) eller forever-relaunch-spor eller #1152-rest (newco). Recovery: backup `cyclingzone-20260622-153339` (VERIFIED) + PITR.
> - **Op/nedrykning (#1152, LIVE 23/6, per-pulje binær-træ):** engine #1783 (top 2 op→forælder, bund 4 delt 2+2→børn; Div4 udskudt til Div3-pulje all-real). Visning #1787 matcher: per-pulje 2-op/4-ned zoner + summarie + dormant-Div4-note (ejer-valgt: vis zone + forklaring) + forward-guard e2e. Spec: [promotion-relegation-design](superpowers/specs/2026-06-23-promotion-relegation-design.md). #1152-epic åben for newco-rest.
> - **Natbølge 23/6 (merged):** 13 PR'er + #1772 CI-fix. Backend live (Railway); frontend afventer Vercel hobby rate-limit (~24t/Pro). Artifact: [night-wave-2026-06-23](audits/night-wave-2026-06-23.md).
> - **Clarity-analyse 23/6:** dead-click/CLS-audit → 4 issues: #1794 (CLS=0,83 app-bredt → dead clicks), #1795 (board-sponsorkort ikke klikbart), #1796 (rytter-række klikbar), #1797 (Clarity ser alle som nye). PR for #1794 (delt `PageLoader` + app-bred loader-rollout) i review.
> - **Ejer-beslutninger (åbne):** #1276 PCM-IP · #1278 spiller-comms (du voicer) · #1487-budget · #929 leaked-pw · #691 key-rotation · #940 NPS.
> - **Hygiejne:** Vercel hobby rate-limit (overvej Pro). preflight tjekker nu grøn origin/main før bølge (f7b10d0a). [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701). **Op/nedrykning: ejer-besluttet 23/6 = aktivér NU (intet låst), per-pulje — gennemregnet forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ([spec](superpowers/specs/2026-06-23-promotion-relegation-design.md)) afventer godkendelse før build.**
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
