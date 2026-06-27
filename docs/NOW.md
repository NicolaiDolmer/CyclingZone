# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🟢 MOTOR TÆNDT — løb genstarter man 29/6 08:00 (27/6):** `race_engine_v2_enabled` + `stage_scheduler_enabled` + `auto_prize_enabled` = **on**. Verificeret garanti ved tænding (ejer-betinget go): tidligste løb man 29/6 08:00, **0 forfaldne før mandag** → intet kører i weekenden. Nødstop = sæt `race_engine_v2_enabled='off'` (kill-switch).
>
> **Prestige-kalender-rebuild (27/6 — anvendt + verificeret i prod):** Hele sæson 1 ombygget til ejer-spec'en (140/112/84/56 løbsdage = 5/4/3/2 etaper/dag, præcist). Prestige-rang (Grand Tour→Monument→World Tour→ProSeries→Class), Grand Tours komprimeret som spredt rygrad MED overlap, monumenter binding-fri, div 3 fuld af overlap. **263 løb, 700 etape-tider; alle divisioner præcis, 0 tomme/droppede.** Første løb man 29/6. Klikbar per-etape-kalender-UI (etaper pr. dag + tidspunkt → planlægningsside) i **PR [#1946](https://github.com/NicolaiDolmer/CyclingZone/pull/1946)**. **Backup:** `backup_calrebuild_20260627_*`. Spec: `docs/superpowers/specs/2026-06-27-calendar-prestige-stage-spread-design.md`.
>
> **💰 CZ Pro Slice 1 — PR [#1909](https://github.com/NicolaiDolmer/CyclingZone/pull/1909) afventer ejer-merge** (har `database/*.sql`). **Åbne ejer-beslutninger:** #1276 · #1278 · #1487 · #929 · #691. [PLAN.md](PLAN.md)=SSOT.

> **🎯 Next action:** Merge PR [#1946](https://github.com/NicolaiDolmer/CyclingZone/pull/1946) → backend (Railway) + frontend (Vercel) deployer den klikbare per-etape-kalender · ejer review'er live · verificér mandagens genstart (29/6) kører rent · drop `backup_calrebuild_*` når stabil.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701). **Op/nedrykning: ejer-besluttet 23/6 = aktivér NU (intet låst), per-pulje — gennemregnet forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ([spec](superpowers/specs/2026-06-23-promotion-relegation-design.md)) afventer godkendelse før build.**
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 27/6 close-out (prestige-kalender-rebuild); fuld historik i git-log + issue-tråde._
