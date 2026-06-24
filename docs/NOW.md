# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (24/6 — race-hub Fase 1 i PR):** Frontend **Fase 1 (Lag 1 trup-fordeling + delt bånd) bygget** — board på `/races` med overlap-kolonner, binding-grayout, afmeld/deltag, auto-udfyld-igen (klik-baseret; drag = senere polish). Nyt aggregat-endpoint `GET /races/distribution` + afmeld/regenerate-endpoints; saves via eksisterende `PUT /selection`. Leverer #1802. Spec/plan: `superpowers/specs|plans/2026-06-24-race-hub-fase-1-*`. **Næste: review+merge PR, derefter Fase 2** (Lag 0 Holdstrategi: a-kæde, faste roller, kaptajn 1/2/3, mål-løb) → Fase 3-5. **Tidligere live:** præmiepenge ÷20 ([#1817](https://github.com/NicolaiDolmer/CyclingZone/pull/1817)).
> - **Nye issues (Discord/audit 23/6):** #1799 akademi-signing→senior · #1800 fyret-rytter-i-lineup · #1801 resultatside-forkerte-løb · #1802 multi-løb-udtagelse. (#1803 felt-cap LUKKET: alle 7 puljer nu = 24 race-eligible; frøs 1 AI-hold i Div 3-B — Div 1 var aldrig over-cap, viser 24 fordi test+frosne filtreres fra.) Patch-note v6.02 udkast klar — afventer ejer-messaging.
> - **Clarity-analyse 23/6:** dead-click/CLS-audit → #1794 (CLS=0,83 → dead clicks, PR i review), #1795 (board-sponsorkort ikke klikbart), #1796 (rytter-række klikbar), #1797 (Clarity ser alle som nye).
> - **Sentry #1792 (merged 23/6):** getUser()→null crashede ~15 sider ved udløbet session (CYCLINGZONE-16, mobil) → `if (!user)`-guard+redirect alle kaldsteder + denyUrls-filter mod extension-noise (CYCLINGZONE-15/TronLink). Patch v6.03.
> - **[#1791](https://github.com/NicolaiDolmer/CyclingZone/issues/1791) ungdoms-rytter-rework — SHIPPED 23/6:** PR [#1809](https://github.com/NicolaiDolmer/CyclingZone/pull/1809) merged; migrering kørt mod prod (85 akademi-ryttere, top-evne ≥55: 33→0). Svag talent-skaleret start + potentiale-drevet loft/fart, patch v6.04. (frontend-smoke 6 e2e-fejl FIXET via [#1811](https://github.com/NicolaiDolmer/CyclingZone/pull/1811) — rod-årsag = stale tests #1744/#1569 + snapshot-drift, IKKE #1792; #1789 lukket, drift-hardening #1812.)
> - **Race-hub 0b + overlap + bund-rytter-dybde (0c) — SHIPPED + AKTIVERET 24/6:** Hele backend-mekanikken er live. 0b entry-generator + overlap-mekanik ([#1810](https://github.com/NicolaiDolmer/CyclingZone/pull/1810)/[#1814](https://github.com/NicolaiDolmer/CyclingZone/pull/1814)) + **0c bund-rytter-dybde** ([#1820](https://github.com/NicolaiDolmer/CyclingZone/pull/1820)): trup 8→12 (4 unge + 4 kerne [50,57] + 4 svag hale [50,52]) i allocator (relaunch/signup/AI). **Aktivering kørt 24/6:** top-up live (626 hale-ryttere → alle 168 hold ≥12), `reschedule-overlap.mjs --live --allow-partial` (89 rene løb → overlap peak=2 i alle 7 puljer; 13 afviklede/igangværende sprunget over; 0 udtagelser ryddet), flag `auto_entry_generator_enabled` = ON. **Verificeret live:** sim-baseline ægte-manager **100% fuldt, 0 forceret no-show** (felt-styrke p10/p50/p90 9.6/18.8/25.7 — svag hale = bevaret opportunity cost). Specs: `2026-06-23-race-hub-base-riders-design.md` + `-calendar-overlap-design.md` + redesign §9 (frontend-faser).
> - **Op/nedrykning (#1152, LIVE 23/6):** patch v6.01; #1152-epic åben for newco-rest. Spec: [promotion-relegation-design](superpowers/specs/2026-06-23-promotion-relegation-design.md).
> - **Ejer-beslutninger (åbne):** #1276 PCM-IP · #1278 spiller-comms · #1487-budget · #929 leaked-pw · #691 key-rotation · #940 NPS. Hygiejne: Vercel hobby rate-limit. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701). **Op/nedrykning: ejer-besluttet 23/6 = aktivér NU (intet låst), per-pulje — gennemregnet forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ([spec](superpowers/specs/2026-06-23-promotion-relegation-design.md)) afventer godkendelse før build.**
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
