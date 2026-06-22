# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (22/6): 4 natbølge-PRs MERGED til main (`verify-local` grøn på `cf52328b`) → kør RELAUNCH-prompt.** [#1701](https://github.com/NicolaiDolmer/CyclingZone/pull/1701) (#1688 AI-fyld+race-skala+standings-puljer `4a3f770f`) · [#1700](https://github.com/NicolaiDolmer/CyclingZone/pull/1700) (#1681 holdudtagelse `2f1ba6dc`) · [#1702](https://github.com/NicolaiDolmer/CyclingZone/pull/1702) (#1569/#1140 onboarding `cf52328b`) · [#1699](https://github.com/NicolaiDolmer/CyclingZone/pull/1699) (#1137 progression verify+sim, flag OFF `9d7f5de0`). #1681→`claude:done`; #1688/#1569/#1140/#1137 forbliver todo (epic/partial/flag — se issue-kommentarer).
> - **⚠️ FØR relaunch:** (1) **Vercel deploy rate-limited 24t** (hobby) → frontend-UI (standings-puljer, holdudtagelse-nav, onboarding) ikke synligt live før reset/re-deploy/Pro; backend/Railway upåvirket. (2) **Patch-notes + help.json** (4 features) bevidst UDSKUDT til relaunch-comms (relaunch step 10, founder-voice) — færdig EN/DA-tekst i `docs/audits/night-wave-2026-06-22.md`. (3) **#1137 flag-flip** + type-peak-beslutning. (4) Chromium-snapshots: `--update-snapshots` i CI.
> - **RELAUNCH** (`docs/runbooks/2026-06-22-forever-relaunch-prompts.md`): `seedRacePool --prune` → frisk backup → destruktiv reset (`relaunchSeason1 --apply --target-prod` + cutover-ack) → AI-fyld (#1688, nu live) → backfill → post-verify. **Udskudt:** #1278 broadcast + #1676 fatigue (classifier-outage); #1576 AI-slop + onboarding Fase 2-4. **Åbne ejer:** #1276 PCM-IP · #929 leaked-pw · #691 key-rotation · #940 NPS. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session. **22/6 natbølge (Opus ultracode-fleet, run `wf_3c4eaf78-439`) AFSLUTTET + MERGED:** 4 launch-readiness-PRs bygget (TDD) + adversarisk verificeret + merged til main; `verify-local` grøn på merged HEAD `cf52328b`. Detaljer + ejer-handlinger: `docs/audits/night-wave-2026-06-22.md`.

> **✅ 18/6-relaunch:** frisk uafhængig sæson 1 LIVE (22 hold, fiktive ryttere, race_engine_v2/daily_training/academy on). Forever-relaunch (epic #1105) = ét sidste reset → permanent; fundamentet er klar. Postmortems: `.claude/learnings/2026-06-18-*`.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701; (a) op/nedrykning gated sæson 3).
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
