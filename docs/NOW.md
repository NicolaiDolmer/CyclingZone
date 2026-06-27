# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🟢 MOTOR TÆNDT — løb genstarter man 29/6 08:00 (27/6):** `race_engine_v2_enabled` + `stage_scheduler_enabled` + `auto_prize_enabled` = **on**. Verificeret garanti ved tænding (ejer-betinget go): tidligste løb man 29/6 08:00, **0 forfaldne før mandag** → intet kører i weekenden. Nødstop = sæt `race_engine_v2_enabled='off'` (kill-switch).
>
> **All-division kalender-rebuild (27/6 — udført + verificeret):** Hele sæson 1 sat på den korrekte game_day-model: 185 gamle løb slettet, **209 nye** (Div 1=33, Div 2=30/pulje, Div 3=29/pulje), dato-synkrone fra man 29/6. AI-præmie af-linket (balancer **urørt**, sum 89.135.982); ægte spillere upåvirkede; 6 D3 reset-lån (238.603) intakte. Div 1 reproducerer ejer-godkendt pack (3 Grand Tours som rygrad), 0 dubletter på tværs af divisioner. **Backup:** `backup_allreset_20260627_*` (10 tabeller) + `backup_d3_reset_20260627_*`. Rod-årsags-fix (from-anker · cross-tier dedup · GT-rygrad) + in-game kalender-feature i **PR [#1945](https://github.com/NicolaiDolmer/CyclingZone/pull/1945)** (rører ikke race-runneren → sikker at merge; mandag kører på nuværende prod-scheduler uanset).
>
> **💰 CZ Pro Slice 1 — PR [#1909](https://github.com/NicolaiDolmer/CyclingZone/pull/1909) afventer ejer-merge** (har `database/*.sql`). **Åbne ejer-beslutninger:** #1276 · #1278 · #1487 · #929 · #691. [PLAN.md](PLAN.md)=SSOT.

> **🎯 Next action:** Tjek + merge PR [#1945](https://github.com/NicolaiDolmer/CyclingZone/pull/1945) (kalender-feature live for spillere) · verificér at mandagens genstart (29/6 08:00) kører rent · drop `backup_allreset_*`/`backup_d3_reset_*` når stabil.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701). **Op/nedrykning: ejer-besluttet 23/6 = aktivér NU (intet låst), per-pulje — gennemregnet forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ([spec](superpowers/specs/2026-06-23-promotion-relegation-design.md)) afventer godkendelse før build.**
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 27/6 close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
