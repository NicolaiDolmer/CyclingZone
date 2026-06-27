# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **⚠️ MOTOR SLUKKET — INGEN LØB KØRER (27/6, KRITISK):** `race_engine_v2_enabled` + `stage_scheduler_enabled` + `auto_prize_enabled` = **off** i `app_config`. **Tænd dem ALDRIG uden eksplicit ejer-go** (ejer-direktiv 27/6). **Sæson 1's løb genstarter mandag 29/6** — ejeren beslutter selve gen-tændingen. Managers skal kunne SE kalenderen + planlægge trup inden da.
>
> **Division 3-nulstilling (27/6 — udført, IKKE live-valideret):** D3 (puljer 4-7, 40 ægte hold) nulstillet fra bunden: 58 gamle løb slettet, præmie reverseret (1.328.625), 6 reset-lån (238.603, 0% rente), ny 28-dags-kalender materialiseret (116 løb m. `game_day`), board/træthed/stillinger/værdier genberegnet, rytter + indkøb beholdt. **Backup:** `backup_d3_reset_20260627_*` (6 tabeller). Migration anvendt. Spec/branch/script: `superpowers/specs/2026-06-27-race-calendar-model-design.md` · branch `feat/race-calendar-rebuild` · `backend/scripts/dev/reset-division-3.mjs`.
>
> **⚠️ HÆNDELSE + TODO (gated, ny session):** timing-fejl (kalender fra sæson-start i fortiden) → scheduleren **blitzede ~12 D3-løb**, **fuldt ryddet op** (resultater + 693k præmie reverseret, D3 ren). Postmortem: `.claude/learnings/2026-06-27-d3-reset-blitz.md`. **Før gen-tænding:** (1) ret `reset-division-3.mjs` `from` (sæson-start → fremtid); (2) flyt D3-kalenderens 1. etape fra **søn 28/6 → man 29/6**; (3) se kalenderen LIVE; (4) ejeren tænder motoren mandag. Bredere rerun (#1848/#1861) + rollout = senere, gated.
>
> **💰 CZ Pro Slice 1 — PR [#1909](https://github.com/NicolaiDolmer/CyclingZone/pull/1909) afventer ejer-merge** (har `database/*.sql`). **27/6 ellers done:** #1926/#1916/#1904 (08–24 live). **Åbne ejer-beslutninger:** #1276 · #1278 · #1487 · #929 · #691. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701). **Op/nedrykning: ejer-besluttet 23/6 = aktivér NU (intet låst), per-pulje — gennemregnet forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ([spec](superpowers/specs/2026-06-23-promotion-relegation-design.md)) afventer godkendelse før build.**
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 27/6 close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
