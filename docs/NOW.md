# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🎯 Next action (22/6): FOREVER-RELAUNCH klar — udføres via 2 prompts.** Fundament LIVE + prod-verificeret: form-frys 4-tier/15-pulje-pyramide (`league_divisions`=15 puljer, `teams.league_division_id`, `season_standings.league_division_id`, `MAX_DIVISION=4`, `POOL_TARGET_SIZE=24`, tier-4-økonomi granit-frosset — [PR #1685](https://github.com/NicolaiDolmer/CyclingZone/pull/1685)) · WS1 §6.1 BEVIST (auto_prize+stage_scheduler ON; accelereret Giro-cyklus afviklet auto + auto-prize) · `START_DATE=2026-06-22` (#1698) · verificeret off-site backup (`cz-db-backups/cyclingzone-20260622-004911`, `db:verify-restore` grøn) · #1673 ryttere-derive-fix + #1678 sæson-1-økonomi-gates + #1680 board-oplåsning + #1684 tier-4-kalibrering ALT MERGED.
> - **2 prompts (`docs/runbooks/2026-06-22-forever-relaunch-prompts.md`):** (1) **NATBØLGE** (ultracode-fleet): #1688 AI-fyld-generator + raceRunner pulje/24-cap-filter + `DIVISION_SQUAD_LIMITS[4]` + StandingsPage-puljer · #1681 holdudtagelse-findbar (i dag pr-løb på `/races/:raceId`) · #1569/#1140 onboarding · #1137 progression-L0 (flag OFF i PR). (2) **RELAUNCH** (ejer fyrer selv efter natbølge-review): `seedRacePool --prune` (egne løbsnavne) → frisk backup → destruktiv prod-reset (`relaunchSeason1 --apply --target-prod` + cutover-ack) → AI-fyld → backfill fresh sæson → post-verify.
> - **Additive efter forever (#1688):** pulje-bevidst op/nedrykning (hard-gate FØR sæson 3 aktiveres) · race-instans-skala. **Åbne ejer-handlinger:** #1276 PCM-IP · #1278 comms-prosa (ToV klar; in-app broadcast-script mangler) · #929 leaked-password · #691 key-rotation · #940 NPS. [PLAN.md](PLAN.md) = SSOT.

> **🤖 Working agent:** 🌙 **NATBØLGE AKTIV** (Opus ultracode-fleet, run `wf_3c4eaf78-439`, kør til ~kl. 8). Bygger 4 launch-readiness-spor i isolerede worktrees → PR — **INGEN merge** (ejer reviewer+merger i morgen før relaunch-prompt): #1688 AI-fyld+race-skala · #1681 holdudtagelse-findbar · #1569/#1140 onboarding · #1137 progression-L0 (verify+sim, flag OFF). Derefter kvalitets-items (#1576/#1676/#1278) + completeness. **Multi-AI claim (#559): rør ikke `feat/1688|1681|1569|1137`-worktrees/branches.** (Prep 22/6 afsluttet: form-frys #1685 + #1673/#1678/#1680 + #1684 + START_DATE #1698 merged+prod-verificeret; WS1 §6.1 bevist; backup taget — historik i git-log.)

> **✅ 18/6-relaunch:** frisk uafhængig sæson 1 LIVE (22 hold, fiktive ryttere, race_engine_v2/daily_training/academy on). Forever-relaunch (epic #1105) = ét sidste reset → permanent; fundamentet er nu klar (se Next action). Postmortems: `.claude/learnings/2026-06-18-*`.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM i vinduet (gjort), byg mekanik additivt efter (#1688).
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 22/6 (token-gate #1275, budget ~1.200 tok); fuld historik i git-log + issue-tråde._
