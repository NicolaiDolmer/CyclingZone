# Progression / akademi / træning korrektheds-audit — 2026-06-20

> Natbølge-audit af LIVE progression-mekanikker: 4 scannere (daily-training, akademi-intake, akademi-graduation, rytter-udvikling) + synthesis med selv-verifikation mod kode + prod. Filer: `dailyTrainingEngine.js`, `trainingSweep.js`, `academyIntake.js`, `academyGraduation.js`, `riderProgression.js`, `riderProgressionEngine.js`, `riderCondition.js`.

## Bundlinje

**Progression-mekanikkerne er solide. 0 nye bugs.** Den eneste bug er #1558 (akademi-cap-race), allerede sporet — og **severity nedjusteret til MEDIUM**: prod-query viser ingen hold med >8 akademiryttere (latent, ikke udløst; #1558 er priority:med). De øvrige påståede bugs var falske positiver.

## Afgørende flag-verifikation

Scannerne var uenige om flag-state. Synthesizeren query'ede prod `app_config` direkte: **`daily_training_enabled = on` OG `academy_enabled = on` — begge LIVE.** En scanner antog fejlagtigt flags var OFF ("sikker default") — den tryghed var ugyldig. Den kritiske live-mekanik (anti-double-dip, #1305) blev derfor uafhængigt verificeret: **korrekt** (human-team-filteret matcher det kanoniske "rigtige hold"-filter; menneske-hold vokser dagligt + springer sæson-vækst over; fald+retirement kører for alle → ingen dobbelt-progression).

## Afviste bug-påstande (falske positiver)

- **Graduate-auktion "mangler kontrakt-opdatering"** — FALSK. `auctionFinalization.js:471` kører `contractOnAcquirePatch` på vinderens update; akademiryttere har altid `salary != null` → kontrakt arves bevidst uændret (`contractSeed.js:46-54`). Den "fix" ville regenerere en kontrakt der skal arves.
- **Skade-clearing dobbelt-gains** — FALSK (auditoren tilbageviste selv). Lexikografisk ISO-dato-sammenligning korrekt; grænser konsistente.

## Edge-cases (ingen blockers)

- **E1 — Akademi-kuld er engangs-ressource pr. hold ved relaunch.** Intake gated på relaunch-orchestrator → hold oprettet EFTER relaunch (når #1560 løses) får aldrig akademi-kuld; et hold der bruger alle slots + senere får ledige pladser kan ikke regenerere kandidater. Ikke dead-end (youth-marked udfylder), men asymmetrisk. **Kobler til #1560** — når nye-hold-allokering designes, overvej også akademi-kuld for nye hold. Dokumentér i help.json.
- **E2 — Pending graduate (22+) trænes som senior uden ungdoms-boost.** Spec siger "ekskluderes fra daglig træning"; koden fjerner kun boost (`youthMultiplier(22)=1.0`). Med skipGrowth aktiv ingen dobbelt-dip. Spec-vs-kode-gråzone → afklar ordlyd med ejer.
- **E3 — Partial `ability_caps` blokerer vækst** (DB-korruption edge, lav sandsynlighed). Defensiv rebuild-guard, lav prio.
- **E4 — `signFreeAgentYouth` real-world-år vs sæson-alder** — konsistens-nit, lav.

## Solidt (verificeret korrekt — ros)

Anti-double-dip (#1305, live + korrekt — den mest kritiske mekanik nu hvor flags er ON); idempotens via UNIQUE-mutex (`training_day_runs`, `academy_graduation`); graduate-detektion + promote→sell-fallback + gælds-guard; akademi-init via `deriveRiders` (abilities+type+base_value før træning, lukker #1478); form/træthed/skaderisiko-statemaskine (seeded determinisme); cap-init lazy+uforanderlig; type-vægte + retirement 36-40 seeded.

## Anbefaling

Progression er launch-klar på korrekthed. Eneste handling: #1558 (delt med concurrency-audit) + E1-koblingen til #1560. Resten er solidt eller spec-ordlyd-afklaringer.
