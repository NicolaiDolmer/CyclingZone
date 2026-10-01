## A. Status i én sætning.
Normaliseringen er implementeret og lokalt testet, men draft #5926 er WIP: preflight, nye CodeRabbit-fund, frisk fuld cutover, CI og ejer-go mangler.

## B. Tjekliste pr. punkt med [x]/[ ] og commit-SHA
SHA: angives i overdragelseskommentaren; denne fil medfølger samme WIP-commit. [x] betyder implementeret/lokalt testet, aldrig deployed.
- [x] Normaliseret dagsbelastning: trainingDateCondition.js, dailyTrainingEngine.js, raceFatigue.js; eksisterende konstanter, flag OFF, fem ability-ticks og én tilstandsopgørelse.
- [x] Sikkerhedsregel a: trainingDateReadiness.js, trainingDateClose.js, partial.sql. Per-rytter ventetid, næste dato kl. 02 dansk, Sentry/ops-outbox og efterregulering. [ ] Ejerbekræftelse af deadline.
- [x] Sikkerhedsregel b: trainingRaceRecovery.js og recoverRecordedRaceLoads.mjs/.md. Idempotent recovery over flere datoer fra originale snapshots. Manglende board/notify-beviser blokerer med vilje.
- [x] Én restitutionsvej (#5926): samme flag fjerner forudbetalt gap-restitution.
- [x] DNS-frigivelse i træningen fra dokumenteret oprindeligt startfelt; ukendt felt frigiver ikke. Persistente udtagelser og senere-dags DNF-frigivelse er ikke generelt løst.
- [ ] Cutover/bootstrap: SQL og CLI implementeret; oprindelig dry-run 1.759 ryttere / 12 runs er FORÆLDET. Seneste eksport 29/9 14:02:55 UTC: 4.381 ryttere / 35 runs, ingen dagens træningsruns; 12 mangler gårsdagens rapport. Ny samlet proposal er ikke færdig.
- [x] To købte ryttere: dokumenteret fremadberegning fra admin_log 71d50505-7c10-4885-8287-b7bfbb68551e, form-reset og ældre rapporter; ingen aktivitet næste dag. Privat two-rider-forward-dry-run.private.json. Ikke applied.
- [x] Claude-review-blokering: /training/run-today giver 409 normalized_sweep_owns_date ved flag ON; motor kræver eksplicit eligibleRiderIds. RED observeret, derefter 120 berørte tests grønne.
- [ ] Guard-annotationer: ejer godkendte snapshot-kolonnen og date-work-PK-opslaget. Flag-off-tests består; schema-guard grøn. maybeSingle-guard genkender ikke annotationens placering. Efter apply regenereres schema-snapshot og annotationerne fjernes i SAMME opfølgnings-PR; punkt står på #5928.
- [x] Patch note/help EN+DA, 7.317, ingen nyt layout. frontend/pr-screens/3517 er genererede testbilleder, ikke ejerens release-review.
- [x] #5931 G1-niveaukalibrering efter live-data; bevar modellen.
- [x] #5935 tal i season_fatigue_reset-faselog oprettet efter dublettjek.
- [ ] Endelig CI/Claude-review på den nye SHA.

## C. Migrationer
PRÆCIS rækkefølge efter merge og ejerens tilladelse:
1. database/2026-09-29-5928-training-condition-date.sql: OFF-flag, immutable condition_load_snapshot, atomisk run/score persistence, load-ledger, settlements, commit-RPC og bootstrap.
2. database/2026-09-29-5928-training-condition-partial.sql: per-rytter receipts, date-work/åbningsbevis/karantæne, timeout-outbox, erstatter commit-RPC med delvis afregning og alert ACK.
3. database/2026-09-29-5928-training-condition-recovery.sql: load-recovery samt prepare/finish af dokumenteret finalization-tail.
Alle tre køres som rigtig SQL i PGlite (PostgreSQL WASM), hver TO gange, med roller og minimale schema-fixtures: backend/lib/trainingDateCondition.integration.test.js. Dækker rollback, retries, rettigheder, sene loads, skader og karantæne. IKKE applied mod prod eller en fuld Supabase-klon.

## D. Cutover-runbook trin for trin
1. Løs G/H, grøn CI, review og ordret "kør"; bekræft kl. 02 separat. #5926/#5928 skal frigives samlet.
2. Merge via merge-kø, observer nyt production-deploy READY/SUCCESS, flag OFF. Apply C efter merge og tilladelse; verificér schema/RPC/permissions. Repoets auto-migrationsworkflow må ikke udløses uden apply-tilladelsen.
3. Pause stage_scheduler_enabled efter tilladelse. Positivt observer Railway-log/finalize-state: ALLE allerede startede legacy-runners/finalizers drænet. Pause alene er ikke drain-bevis. Gamle JS-writers tager ikke de nye SQL-låse.
4. Geneksportér ALLE datoens runs, canonical schedule/season, faktiske entrant_snapshot, profile_type, originale orders/roles med tidsstempler, nuværende rider_condition til CAS og dokumenterede åbninger. Bekræft ingen training_day_runs på datoen. Et færdigt geneksport-script findes endnu IKKE; sidste eksport ligger i privat handoff-evidence.private.json.finalCutoverPayload.
5. Løs manglende åbninger fremad, ALDRIG subtraktion fra nuværende fatigue. To købte er dokumenteret. Tre yderligere har ældre rapport/reset-bevis. Seks fill_tail-ryttere født samme dag kræver verificeret default-initialisering; én gammel free agent mangler tidligere formrapport. Metadata findes privat.
6. Dry-run fra repo-root: node backend/scripts/dev/trainingConditionCutoverDryRun.mjs "<private>/cutover-input.private.json" "<private>/cutover-proposal.private.json". Brug FRISK input med seasonResetProof/forward_evidence. CLI har ingen apply; output har summary, sha256, operation og args.
7. Efter konkret godkendelse: service-role RPC bootstrap_training_condition_date med proposal.args: p_season_id, p_tick_date, p_openings, p_loads. SQL kræver fuld starterdækning/CAS/ingen afregnet træning; bevarer skader, registrerer loads og dokumenteret åbning, sætter flag/activation-date atomisk. Også uberørt dato bruger bootstrap for metadata.
8. Read-only efter flip: SQL i docs/snapshots/5928/verify-after-training.sql med eksplicit dato. Flags/date korrekte og nul manglende loads. Receipts/settlements forventes først efter opgørelsen. Genoptag scheduler efter verificeret bootstrap og nye writers.
9. Post-apply: regenerér database/schema-snapshot.json og fjern de midlertidige #5928-annotationer i SAMME opfølgnings-PR.
10. Rollback: fejlet bootstrap/commit er atomisk; ved CAS-konflikt geneksportér. Efter succes må flag ikke blot slukkes midtdato: legacy kan gentage recovery/load. Pause/dræn, bevar ledger/receipts, aftal ejerstyret recovery eller næste rene datogrænse. Ingen sikker automatiseret midtdato-rollback/reverse-bootstrap er implementeret. Drop ikke data.

## E. Tests
Fra worktree-roden; tunge kommandoer gennem scripts/verify-lock.ps1 -Max 2.
- pwsh -File scripts/verify-lock.ps1 -Max 2 -- pwsh -File scripts/verify-local.ps1
  Seneste fulde kørsel før sidste fokuserede edits: backend 12.152 passed / 0 failed / 3 skipped; frontend 4.152 passed / 0 failed. Ops-grupper og production-build bestået. release-full.log.
- node --test backend/lib/apiTrainingMeDayClose.routes.test.js backend/lib/dailyTrainingEngine.test.js
  Efter route/engine-guard: 120 passed / 0 failed.
- node --test --test-name-pattern="flag off|flag-off|normalized flag off" backend/lib/trainingRaceRecovery.test.js backend/lib/dailyTrainingEngine.test.js
  Sidste flag-off-verifikation: 10 passed / 0 failed. Nye tests ved recovery.test.js:90 og engine.test.js:2632 beviser ingen date-work/snapshot-read ved flag OFF, også med gammelt tick-flag ON/OFF.
- node --test backend/lib/trainingDateCondition.integration.test.js backend/lib/trainingRaceRecovery.test.js
  SQL/recovery tidligere 28/28; senere completion/flush-gruppe 53/53; helper 6/6. Se logs for den konkrete gruppesammensætning; disse er ikke én samlet ny kørsel.
- node --test backend/lib/trainingDateClose.test.js backend/lib/trainingDateReadiness.test.js
  12/12 efter coordinator-rettelser.
- node --test backend/scripts/dev/trainingConditionCutoverDryRun.test.mjs
  6/6 fremadberegning. Population-audit separat 3/3.
- pwsh -File scripts/preflight-pr.ps1
  Seneste fulde preflight havde fire fejl; pagination/catch rettet, schema derefter grøn. maybeSingle er stadig blokering. Frisk handoff-preflight.log gemmes; ingen påstand om grøn.
- cd frontend; npm run test:e2e (via semafor):
  Fuld: 1.419 passed / 171 skipped / 66 failed. Isoleret med én worker: 65 passed / 1 failed. Sidste WebKit-test uændret gentaget tre gange: 3 passed. IKKE en ren fuld suite.
- CodeRabbit komplet: 1 major + 2 minor nye fund i H. Ikke rettet efter ejer-stop.
CI-status på PUSHET SHA tilføjes overdragelseskommentaren. Gammel grøn d1eb5b0ec gælder ikke den nye WIP.
IKKE kørt: prod-apply, live-accept/skader efter rollout, endelig review/CI, ny komplet cutover. Ingen nye brede tests efter stop, kun krævet preflight før push.

## F. Målinger
Aggregerede tal deles efter ejerens eksplicitte overdragelseskrav. Rå rytterdata er private. Scenarie: gemte S4-udtagelser, frosne nuværende programmer/recovery, normal effort; ingen skade-feedback på senere programmer. Ikke historisk S3-replay eller observeret skadeincidens.

| Pr. dato | Live nu-model | Fuld pr. etape | Normaliseret |
|---|---:|---:|---:|
| G1 slutmedian human / AI | 27 / 27 | 29 / 59 | 26 / 31 |
| G2 højeste samlede andel >=70 | 11,688 % | 48,776 % | 10,152 % |
| G2 slutandel human / AI >=70 | 28,806 % / 0 % | 34,317 % / 32,792 % | 25,020 % / 0 % |
| G3 højeste aftenfatigue på faktisk etapedato | 57 | 93 | 76 |
| Træningsskaderisiko pr. 1.000 raske rytter-datoer | 15,274 | 4,234 | 1,328 |
| Formændring pr. dato min/max | -20/+15 | -4/+3 | -1/+3 |

G1 40-60 er midlertidigt frafaldet. G2 er bedre samlet, men human-undergruppen er IKKE under 15 %: må ikke kaldes universelt grøn. Normaliseret G3: 19 af 5.146 etapeløbsryttere krydser 70; fjernelse af raceload fjerner krydsningerne. Sæsonudvikling mod før S4 skal afsluttes ud fra release-cadence.private.json; konstant budget er ikke tilstrækkeligt bevis.
Genskab: node backend/scripts/dev/trainingCadenceAudit.mjs "<private>/release-cadence.private.json" "<private>/population-fixture.private.json"
Korrigeret output: population-final.private.json. Game days er NULBASEREDE. Tidligere afledte day-1-masks var forkerte; condition-model-comparison.private.json er FORÆLDET.
Private data/logs kopieret til C:/Users/Nicolai/OneDrive/CyclingZone-context/5928-handoff-2026-09-29 (cloud-sync ikke verificeret).
Original: C:/Users/Nicolai/.codex/visualizations/2026/09/29/01a0ec0c-a0c8-7ea0-9ec3-674c1b1eee91.
handoff-evidence.private.json: seneste fulde eksport, additionalOpeningEvidence, seasonResetOpeningProof, compactS4Population, correctDateMasks.
cutover-input/proposal.private.json: KUN oprindelige 1.759. two-rider-forward-dry-run.private.json: de to købte.
Logs under test-logs/<wave-id>:
f0606508-2d5e-4887-a166-3b2b82d9c338/release-full.log, release-preflight.log, release-coderabbit.log, webkit-backoff.log.
8fc8938b-14f0-4a00-bdb6-fe20f3c236f8/normalized-e2e.log.
9bc9e6c9-75e1-472f-9291-8b24e77754fb/e2e-isolated.log.
Ingen rå rytter-id'er/names fra måledata committes.

## G. Åbne ejer-beslutninger
Kl. 02 teknisk fallback kræver eksplicit bekræftelse. Ordret "kør" kræves før merge, apply, prod-mutation og flag-flip; intet er gjort.
Frisk cutover med uafklarede åbninger og G2 human-undergruppe skal fremlægges ærligt. G1-undtagelsen er ikke generelt go til andre afvigelser.
#5884 ny formmodel kræver stadig særskilt A/B-valg; ikke bygget. Fase 2 først efter en sund live-aften; fase 3 triage overdraget til Claude, ikke afsluttet her.

## H. Kendte risici og ting du selv er i tvivl om
- CodeRabbit major: raceRunner.js ca. 2921-2927 bør fail-closed før writes ved trainingOwnsRecovery && !dryRun && !resumeEnabled. Ikke undersøgt/rettet efter stop.
- Minor: cutover-CLI timestamp-check afviser ikke missing/invalid run.created_at/row.updated_at; NaN kan passere. Test/afvis ubeviselig effort.
- Minor: audit-doc dobbelt DNF-afsnit og løs sætningsrest.
- maybeSingle-annotationens placering genkendes ikke. Ejer har godkendt undtagelsen, ikke ændring af guard/baseline.
- Ny cutover ufuldstændig: seks fill_tail uden fødselsbevis, gammel free agent uden formrapport; tre ekstra reset-replays kan bygges fra metadata. Ingen baglæns-gæt.
- Sentry/ops er kun DI-testet, ikke leveret live. Admin-recovery afviser manglende irreversible board/notify-proofs; ikke alle udfald kan genoprettes automatisk.
- E2E første fulde kørsel rød; isoleret grønt er svagere bevis.
- Automatisk efterkontrol, der genberegner hver nul-rytters receipts, er IKKE færdig. Vedlagt SQL er dataudtræk/counts, ikke matematisk bevis alene.
- Schema-snapshot har kun verificeret eksisterende training_day_runs-opdatering. Nye tabeller mangler indtil apply.
- Planens tidligere "untouched date can activate directly" er forældet: altid bootstrap for metadata. Rettet som dokumentation ved handoff.
- Ingen DNF-proportional udvikling, train-now, forecast, ny formbalance eller samlet dato-rapport i denne pakke.

## I. Næste 3 konkrete skridt for Claude i rækkefølge
1. Åbn PR #5926's WIP-SHA i eksisterende worktree; løs de konkrete CodeRabbit-fund og maybeSingle-annotation, kør målrettede tests/preflight og push.
2. Færdiggør dokumenteret aktuel cutover og acceptmålinger, fremlæg afvigelser; afslut CI og uafhængigt review. Skriv først "Klar til Claude-review", når aktuelle diff/beviser er på PR.
3. Få deadline-bekræftelse og ordret "kør"; gennemfør samlet merge/deploy/migration/bootstrap via D og efterkontrol via J. Ingen fase 2 før sund aften.

## J. Din planlagte opgave "Verificér træningsnormalisering efter aftentræning"
Automations verific-r-tr-ningsnormalisering-efter-aftentr-ning og tr-ningsstatus-f-r-kl-18 er begge PAUSED, positivt bekræftet af værktøjet. Codex fortsætter ikke automatisk.
Efter godkendt activation og afsluttet aften: kør docs/snapshots/5928/verify-after-training.sql read-only med eksplicit dato:
psql "$DATABASE_URL" -v tick_date=2026-09-29 -f docs/snapshots/5928/verify-after-training.sql
Eller brug sikkert SQL-værktøj og ekspandér datoparameter. Print aldrig credentials.
- Flags/date korrekte; nul faktiske etaperyttere uden korrekt load-ledger.
- Nul dublerede receipts/settlements. Ingen ubemærkede pending/partial/karantæne. Timeout skal have outbox/alarmsvar.
- Fordeling human/AI og programmer; G1-undtagelse midlertidig. G2/G3 vurderes mod ejerens godkendte fortolkning.
- Optæl løbsryttere på nul, vis tre eksempler PRIVAT med opening_condition, receipts/slots, race-load og applied_condition. Genberegn med settleTrainingDateCondition og præcis frossen recovery/seed. Nul pga. ekstra restitution/manglende load er ikke tilladt; et forklarligt nul er tilladt.
- Form opdateret én gang pr. dato. Ingen skadebølge: skeln training/race, sammenhold eksponering/forventning. Ingen godkendt observeret incidensgrænse er endnu fastlagt.
- Kvalitativ status på #5928, private eksempler til ejer. #5915 skal senere vise løbsdelen særskilt.
Queries er reviewklare forslag, IKKE kørt mod den endnu ikke migrerede prod.


Handoff-only constraint: ejeren krævede docs/NOW.md committed sammen med ALT WIP. Repoets check-now-md-sidecar kræver docs(now)/docs(close-out)-PR-titel for NOW-ændringer; Claude skal flytte denne statusændring til separat docs-sidecar før produkt-PR kan kaldes grøn. Det er ikke løst ved at ommærke runtime-arbejde som docs-only.

