# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (22/6): EJER reviewer+merger 4 natbølge-PRs → kør RELAUNCH-prompt.** Alle 4 CI-grønne, ingen migration, ingen auto-merge: [#1701](https://github.com/NicolaiDolmer/CyclingZone/pull/1701) (#1688 AI-fyld+race-skala+StandingsPage-puljer) · [#1700](https://github.com/NicolaiDolmer/CyclingZone/pull/1700) (#1681 holdudtagelse-findbar) · [#1702](https://github.com/NicolaiDolmer/CyclingZone/pull/1702) (#1569/#1140 onboarding) · [#1699](https://github.com/NicolaiDolmer/CyclingZone/pull/1699) (#1137 progression verify+sim, flag OFF). **Merge-rækkefølge:** #1699+#1701 (isolerede) først; #1700+#1702 deler DashboardPage/i18n i forskellige regioner → kør `verify-local` efter 2.-merge. Konsolidér patch-notes + help.json VED merge (tekst i `docs/audits/night-wave-2026-06-22.md` + PR-bodies). **Derefter:** RELAUNCH-prompt (`docs/runbooks/2026-06-22-forever-relaunch-prompts.md`): `seedRacePool --prune` → frisk backup → destruktiv prod-reset (`relaunchSeason1 --apply --target-prod` + cutover-ack) → AI-fyld (#1688) → backfill → post-verify.
> - **Afvigelser (se artifact):** Chromium-playwright kan ikke spawne på maskinen (`spawn UNKNOWN`) → `--update-snapshots` i CI/chromium-miljø (webkit+required CI grønne). Vercel deploy rate-limited 24t (advisory, ikke-required; backend/Railway upåvirket). Kvalitets-wave (#1278 broadcast, #1676 fatigue-recovery) IKKE startet — shell-classifier-outage ~02:30–08:15 + deadline. #1576 AI-slop + onboarding-rest UDSKUDT til efter de 4 merger.
> - **Additive efter forever (#1688):** pulje-bevidst op/nedrykning (hard-gate FØR sæson 3) · race-instans-skala. **Åbne ejer-handlinger:** #1276 PCM-IP · #1278 comms (in-app broadcast-script mangler) · #929 leaked-password · #691 key-rotation · #940 NPS. [PLAN.md](PLAN.md) = SSOT.

> **🤖 Working agent:** Ingen aktiv session. **22/6 natbølge (Opus ultracode-fleet, run `wf_3c4eaf78-439`) afsluttet:** 4 launch-readiness-PRs bygget end-to-end (TDD + verify-local grøn) + adversarisk verificeret + CI-grønne, ALLE ship-ready, 0 merged (afventer ejer-review). #1699 warning-budget-fix pushet (`d00787b1`). Detaljer + ejer-handlinger: `docs/audits/night-wave-2026-06-22.md`.

> **✅ 18/6-relaunch:** frisk uafhængig sæson 1 LIVE (22 hold, fiktive ryttere, race_engine_v2/daily_training/academy on). Forever-relaunch (epic #1105) = ét sidste reset → permanent; fundamentet er klar. Postmortems: `.claude/learnings/2026-06-18-*`.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 → nu PR #1701).
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 natbølge close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
