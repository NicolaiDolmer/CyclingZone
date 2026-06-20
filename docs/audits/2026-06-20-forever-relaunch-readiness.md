# Forever-relaunch readiness-syntese — 2026-06-20

> Kulmination af natbølge-auditerne. Mapper alle fund mod forever-gaten ([spec §6](../superpowers/specs/2026-06-19-forever-relaunch-readiness-design.md)) + løfter de to NYE blockers natbølgen fandt ind i gaten. Formål: ét klart "hvad mangler før vinduet kan fyres"-billede.

## Kvalitets-fundament (natbølgens vigtigste signal)

Ni audits — heraf fem kerne-system-korrektheds-audits med adversariel verifikation — bekræfter at **fundamentet er solidt**: race-engine, økonomi, concurrency (1 race), progression/akademi/træning er alle verificeret korrekte. Det betyder forever-readiness primært handler om **2 blockers + automatisering + ejer-frys** — ikke om at jagte skjulte korrektheds-bugs. Det reducerer forever-risikoen markant.

## Forever-gate-status (spec §6 + natbølge-tilføjelser)

| # | Gate-kriterium | Status | Hvad mangler |
|---|----------------|--------|--------------|
| §6.1 | WS1 automatisering bevist på beta (løb+præmie+sæson-skift uden manuel indgriben) | 🔴 ikke bygget | Plan skrevet ([WS1-plan](../superpowers/plans/2026-06-19-ws1-race-automation.md)); Fase 1 (auto-prize) + Fase 2 (season-cron) implementerbare; Fase 3 (race-scheduler) gated af ejer-schema-beslutning + migration. Derefter beta-stress-test. |
| §6.2 | WS2 (PCM-sletning) + WS3 (egne løbsnavne) merged | 🟡 delvist | WS2 UI-del gjort (#1532 merged); WS2 backend-pipeline-sletning + WS3 (race_pool_seed egne navne) udestår. |
| §6.3 | WS4: granit ejer-frys (§7) + result_type afklaret + START_DATE parameteriseret | 🔴 ejer-session | Granit-frys er en ejer-gate (§7). result_type/udbruds-status (#1499) + START_DATE-param udestår. |
| §6.4 | Verificeret DB-backup umiddelbart før | 🟢 rutine findes | Off-site backup-rutine verificeret 18/6 (`db:verify-restore` grøn); kør frisk før vinduet. |
| §6.5 | Spiller-comms klar (#1278) | 🔴 ejer-handling | Hvad forever-resettet betyder for de 22 beta-testere. |
| **NY** | **#1560 — nye hold får starttrup (+ akademi-kuld)** | 🔴 **HÅRD blocker** | **Bør tilføjes til gaten.** Forever-præmissen ER løbende nye spillere; hvis de starter med tom trup + dead-end (verificeret), fejler hele formålet. Backend-fix, balance-følsom (#1487) → ejer + simulér-før-ship. |
| **NY** | **#1558 — akademi-cap-race** | 🟡 før-relaunch | Eneste penge-tab-vektor; latent (ikke udløst i dag), men samtidighed stiger med nye spillere. Atomær RPC. |

## Prioriteret vej til forever-vinduet

1. **#1560** (tom-trup + akademi-kuld for nye hold) — den mest fundamentale: uden den kan ægte nye spillere ikke spille. Afklar #1487-svag-pulje-timing samtidig.
2. **WS1 Fase-0-beslutninger** (auto-prize-timing, race-scheduler schema-model, stress-test-vindue) → byg Fase 1-2 → beta-stress-test (§6.1).
3. **#1558** (akademi-race) — luk i launch-vinduet.
4. **WS2-backend + WS3** (§6.2) + **WS4 result_type/START_DATE** (§6.3).
5. **Granit-frys ejer-session** (§7) — godkend kalibrerede tal.
6. **Spiller-comms** (#1278) + **frisk backup** (§6.4) → fyr vinduet.

## Ikke-blokerende (glider efter forever — dokumenteret)

Discord-feedback-pukkel (mest merget i natbølgen, resten venter Vercel-deploy), engine-dybde (#1021 fysiologi post-launch), onboarding-polish (R2-R4 frontend), DB-perf-optimering (#1375), design-smag (A/B/C), økonomi-hygiejne (sponsor-fallback). Alle i deres respektive audit-docs.

## Bundlinje

Forever-readiness er **ikke** blokeret af korrekthed (fundamentet er verificeret solidt). Den er blokeret af: **#1560 (kritisk), WS1-automatisering (planlagt), ejer-frys + comms (ejer-sessioner)**. Det er en kort, klar liste — ikke et åbent felt af ukendte.
