# Forever-relaunch post-verify-bugs: rehearsal-mod-frisk-klon fanger ikke prod-akkumulering

**Dato:** 2026-06-22
**Kontekst:** Forever-relaunch (permanent frisk sæson 1) gennemført ejer-superviseret. Den fulde rehearsal (25/25 PASS, 22/6) kørte mod en FRISK disposabel prod-klon. Post-verify mod ÆGTE prod fangede 2 bugs som rehearsal strukturelt ikke kunne se.

## Bug 1 — markeds-akkumulering (gamle fiktive ryttere overlever reset)

**Symptom:** Marked = 1783 fiktive ryttere efter reset (forventet ~800; rehearsal-target 780-820).

**Rod-årsag:** `runFullBetaReset` rydder game-state (teams/contracts/finance) men IKKE fiktive ryttere (`pcm_id IS NULL`). `retireLegacyRiders` retirer KUN `pcm_id IS NOT NULL` (legacy PCM). Så de 886 fiktive ryttere fra test-relaunchen (18/6) overlevede + de 800 nye = 1783. En frisk rehearsal-branch har INGEN gammel population, så den så altid ~800.

**Fix (engangs):** retire de 886 gamle (`created_at = '2026-06-18'`, ingen i academy/auktioner) → frisk marked 799. Forever = sidste reset, så ingen kode-fix nødvendig fremadrettet (transitioner udvikler ryttere, rydder dem ikke).

## Bug 2 — academy-heal seeder AI-hold (manglende is_ai-filter)

**Symptom:** `academy_intake` = 661 rows (168 hold × 3-5), forventet 97 (25 managere × 3-5). 564 strandede AI-hold-kuld.

**Rod-årsag:** `academyHealSweep.js` (cron hver 5. min) henter hold med `academy_intake_seeded_at IS NULL` UDEN menneske-hold-filter. Efter relaunch havde de 143 AI-fyld-hold (#1688) markør=NULL → sweep'en seedede dem academy-kuld. `academyIntake.js`' hovedresolver filtrerer korrekt (is_ai=false), men heal-sweepen kopierede ikke det filter. Rehearsal-branchen havde færre/ingen AI-hold med markør-NULL i heal-vinduet, så bug'en var usynlig.

**Fix:** `academyHealSweep` is_ai/is_bank/is_frozen/is_test_account-filter + TDD (PR #1711). Engangs-oprydning: retire de 564 + slet intake-rows (markør sat → ingen re-seed).

## Læring / forward-guard

1. **Rehearsal mod en FRISK klon kan ikke fange prod-AKKUMULERING** (gamle data fra tidligere kørsler) eller **cron-race-interaktioner** (heal-sweeps der fyrer mod en ny prod-state). Post-verify mod ægte prod er ikke valgfri selv efter grøn rehearsal.
2. **Alle heal-sweeps der seeder hold-data skal dele samme menneske-hold-diskriminator** som deres primær-resolver. Tjek `starterSquadHealSweep` (empirisk OK her: AI-hold havde 8 ryttere) + fremtidige sweeps.
3. **Verifikations-strategi for additiv relaunch-kode** (kalender-wiring): dryRun mod ægte prod (læse-sti) + write-payload skema-match + unit-tests dækkede hovedrisikoen uden en dyr ny preview-branch — men post-verify mod prod var stadig det der fangede de to data-bugs.

## Relaterede
- PR #1709 (kalender-wiring), #1710 (cadence-fix), #1711 (academy is_ai + #1137-progression).
- Rehearsal-harness fik kalender-acceptance-checks (commit 46cc13f3) til fremtidig post-verify.
