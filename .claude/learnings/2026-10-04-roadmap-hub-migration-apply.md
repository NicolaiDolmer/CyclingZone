# Postmortem · 2026-10-04 · Roadmap-hub: migration merget men ikke applied, og rød main efter snapshot-refresh

## Hvad skete der?
1. PR #6159 (roadmap-hub-migrationen) blev merget, merge-køen meldte "merget og verificeret", men `auto-migrate.yml` afviste filen. Prod var urørt, indtil kommentaren blev rettet (2cd5f0608).
2. Efter apply blev `database/schema-snapshot.json` regenereret og pushet (3039b21a9). Main-CI blev rød: forward-guarden #5405 krævede to nye FK til `races` klassificeret (rettet i c2fe7b2ff).
3. To workers meldte "klar" med rød CI (#6163, #6160), og én brugte `--no-verify` på sin første commit.

## Root cause
1. Rollback-noten i bunden af migrationen nævnte den manuelle markørs ordlyd. `auto-migrate.yml` grep'er hele filen, også kommentarer. Tjekket findes kun efter merge.
2. Snapshot-refresh trækker AL drift med, ikke kun den nye migration. Kun `tsc` blev kørt før push, ikke backend-testene.
3. Worker-prompten krævede ikke, at CI læses før "klar"; revieweren behandlede rød CI som bemærkning på #6163.

## Fix
- Kommentaren omskrevet; migrationen applied og post-verificeret (1.121 stemmer, 42/12/6 uændret).
- `race_day_participation` og `training_race_loads` lagt i `RACE_DEPENDENCY_TABLES` som gameplay (fail-closed).
- Opfølgninger rettede rød CI på begge PR'er.

## Forhindret fremover
- Issue oprettet 4/10: merge-køen skal vente på auto-migrate; markør-grep'et skal ind i PR-CI.
- Efter `--update-snapshot`: kør `node --test backend/lib/seasonCalendarGate.test.js` (og helst backend-suiten) FØR push.
- Skriv aldrig markørens ordlyd i en migration under `database/2026-*.sql`, heller ikke i en kommentar.
- Et uafhængigt review fra den anden runtime (Codex) fandt 1 P1 + 3 P2 i migrationen, som bølgens egen reviewer ikke fangede. Brug det på migrationer med triggere på delte tabeller.

## Læring
"Merget og verificeret" fra køen dækker ikke migreringen. Post-verify mod prod er den eneste sandhed, og den skal køres, før noget meldes live.
