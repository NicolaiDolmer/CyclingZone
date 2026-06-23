# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (23/6 — auto-løb-incident håndteret):** Pulje-filter-bug ([#1798](https://github.com/NicolaiDolmer/CyclingZone/issues/1798), fixet via #1793, live Railway `d168d9cc`): auto-løb 12:30+15:00 trak hold på tværs af divisioner (felt = 24 stærkeste i HELE ligaen, ikke egen pulje). Prod-cleanup: **19,44M præmier tilbageført** (237 tx/30 hold), race-data slettet (3071 results/14 runs/2418 entries), træthed (429)/værdibonus (153)/standings (49)/race-dage nulstillet. De 13 løb **re-scheduleret til 20:00+21:00 i dag**; scheduler+auto-prize re-aktiveret (verificeret 0 due før 20:00). **VERIFICÉR efter 20:00/21:00:** hvert løbs `race_entries` kun egen pulje. Recovery: backup `cyclingzone-20260622-153339` (VERIFIED) + PITR.
> - **Nye issues (Discord/audit 23/6):** #1799 akademi-signing→senior · #1800 fyret-rytter-i-lineup · #1801 resultatside-forkerte-løb · #1802 multi-løb-udtagelse. (#1803 felt-cap LUKKET: alle 7 puljer nu = 24 race-eligible; frøs 1 AI-hold i Div 3-B — Div 1 var aldrig over-cap, viser 24 fordi test+frosne filtreres fra.) Patch-note v6.02 udkast klar — afventer ejer-messaging.
> - **Clarity-analyse 23/6:** dead-click/CLS-audit → #1794 (CLS=0,83 → dead clicks, PR i review), #1795 (board-sponsorkort ikke klikbart), #1796 (rytter-række klikbar), #1797 (Clarity ser alle som nye).
> - **Sentry #1792 (PR åben):** getUser()→null crashede ~15 sider ved udløbet session (CYCLINGZONE-16, mobil) → `if (!user)`-guard+redirect alle kaldsteder + denyUrls-filter mod extension-noise (CYCLINGZONE-15/TronLink). Patch v6.03.
> - **Næste kandidat (når incident verificeret):** [#1791](https://github.com/NicolaiDolmer/CyclingZone/issues/1791) ungdoms-rytter-evner-rework (spec+plan klar 23/6, subagent-drevet; Fase A-C autonomt → ejer-gate D → migrering E) eller forever-relaunch-spor / #1152-rest.
> - **Op/nedrykning (#1152, LIVE 23/6):** patch v6.01; #1152-epic åben for newco-rest. Spec: [promotion-relegation-design](superpowers/specs/2026-06-23-promotion-relegation-design.md).
> - **Ejer-beslutninger (åbne):** #1276 PCM-IP · #1278 spiller-comms · #1487-budget · #929 leaked-pw · #691 key-rotation · #940 NPS. Hygiejne: Vercel hobby rate-limit. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701). **Op/nedrykning: ejer-besluttet 23/6 = aktivér NU (intet låst), per-pulje — gennemregnet forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ([spec](superpowers/specs/2026-06-23-promotion-relegation-design.md)) afventer godkendelse før build.**
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
