# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (23/6 — auto-løb-incident lukket + pulje-binding shippet):** Pulje-filter-bug [#1798](https://github.com/NicolaiDolmer/CyclingZone/issues/1798) (autofill, fixet #1793) + krydspulje-vektor #2 (manuel udtagelse uden pulje-guard) lukket via **[#1813](https://github.com/NicolaiDolmer/CyclingZone/pull/1813), live Railway `0ed5c7c4`**: `teamInRacePool` i raceBinding.js → 409 `selection_wrong_pool`; pulje-binding nu eksplicit race-hub **Fase 0-invariant** (spec). Alle 3 entry-veje (autofill/generator/manuel) pulje-håndhæver nu. De 13 incident-løb **udskudt til 22:00+23:00** (fra 20:00+21:00, for at lande #1813 før kørsel); pre-flight verificeret: alle har pulje-id, 0 kontaminerede entries, 24 eligible/pulje, 0 due før 22:00. **VERIFICÉR efter 22:00/23:00:** hvert løbs `race_entries` kun egen pulje. Recovery: backup `cyclingzone-20260622-153339` (VERIFIED) + PITR.
> - **Nye issues (Discord/audit 23/6):** #1799 akademi-signing→senior · #1800 fyret-rytter-i-lineup · #1801 resultatside-forkerte-løb · #1802 multi-løb-udtagelse. (#1803 felt-cap LUKKET: alle 7 puljer nu = 24 race-eligible; frøs 1 AI-hold i Div 3-B — Div 1 var aldrig over-cap, viser 24 fordi test+frosne filtreres fra.) Patch-note v6.02 udkast klar — afventer ejer-messaging.
> - **Clarity-analyse 23/6:** dead-click/CLS-audit → #1794 (CLS=0,83 → dead clicks, PR i review), #1795 (board-sponsorkort ikke klikbart), #1796 (rytter-række klikbar), #1797 (Clarity ser alle som nye).
> - **Sentry #1792 (merged 23/6):** getUser()→null crashede ~15 sider ved udløbet session (CYCLINGZONE-16, mobil) → `if (!user)`-guard+redirect alle kaldsteder + denyUrls-filter mod extension-noise (CYCLINGZONE-15/TronLink). Patch v6.03.
> - **[#1791](https://github.com/NicolaiDolmer/CyclingZone/issues/1791) ungdoms-rytter-rework — SHIPPED 23/6:** PR [#1809](https://github.com/NicolaiDolmer/CyclingZone/pull/1809) merged; migrering kørt mod prod (85 akademi-ryttere, top-evne ≥55: 33→0). Svag talent-skaleret start + potentiale-drevet loft/fart, patch v6.04. (frontend-smoke 6 e2e-fejl FIXET via [#1811](https://github.com/NicolaiDolmer/CyclingZone/pull/1811) — rod-årsag = stale tests #1744/#1569 + snapshot-drift, IKKE #1792; #1789 lukket, drift-hardening #1812.)
> - **Race-hub Fase 0b — MERGED 23/6 ([#1810](https://github.com/NicolaiDolmer/CyclingZone/pull/1810)):** proaktiv entry-generator (binding-bevidst, idempotent) + afmeld-state. Migration LIVE i prod (`race_withdrawals` + RLS/grant + flag `auto_entry_generator_enabled=off`, verificeret direkte). Generator OFF til bund-ryttere findes. Subagent-drevet (impl + 2-trins-review/task + holistisk final-review, alle ✅). **Næste: Fase 0c** (bund-ryttere + simulér-før-ship).
> - **Op/nedrykning (#1152, LIVE 23/6):** patch v6.01; #1152-epic åben for newco-rest. Spec: [promotion-relegation-design](superpowers/specs/2026-06-23-promotion-relegation-design.md).
> - **Ejer-beslutninger (åbne):** #1276 PCM-IP · #1278 spiller-comms · #1487-budget · #929 leaked-pw · #691 key-rotation · #940 NPS. Hygiejne: Vercel hobby rate-limit. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701). **Op/nedrykning: ejer-besluttet 23/6 = aktivér NU (intet låst), per-pulje — gennemregnet forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ([spec](superpowers/specs/2026-06-23-promotion-relegation-design.md)) afventer godkendelse før build.**
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
