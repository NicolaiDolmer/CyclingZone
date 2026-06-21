# Ryttere uden derive-lag: insert-uden-fuldført-derive strander tavst

**Dato:** 2026-06-21 · **Issue:** #1673 (fejlklasse delt med #1478/#1487-stien) · **Trigger:** jeppek Discord-screenshot (Qiang Zhou, Daniel Cabrera "mangler stats helt"), bekræftet af bobby2106 + cybersimon

## Hvad skete
75 aktive fiktive ryttere (`pcm_id IS NULL`, `is_retired=false`) manglede BÅDE deres
`rider_derived_abilities`-række OG havde `base_value=null`. De rå `stat_*`-felter var
intakte for ALLE — bugen sad kun i derive-laget. Serve-laget (`backend/routes/api.js`,
embed `rider_derived_abilities(...)`) har ingen fallback til rå `stat_*`, så en manglende
derived-række = `null` = blanke stats i UI.

Alle 75 blev oprettet i ÉT batch 2026-06-18 19:51 (et akademi/start-trup-kuld på 86),
adskilt fra launch-populationen (800 ryttere kl. 19:49, 0 brudte). Derive-trinet
fuldførte ikke for batchen. 5 af de 75 sad på ÆGTE menneske-hold (Mario López, Daniel
Cabrera, Loïc Brunet, Qiang Zhou, Jakob Sandberg); resten var free agents.

## Rod-årsag (fejlklasse)
`deriveForRiderIds` i `backend/lib/backfillCores.js` verificerede IKKE at upsertet
(physiology + abilities) + rider-update (type + base_value) faktisk dækkede ALLE de
inputs-id'er. Et partielt batch-fejl efterlod en delmængde af rytterne "strandet"
TAVST — funktionen returnerede en summary uden at kaste. Samme sti bruges af:
- start-trup-allokeringen (`runStarterSquadAllocation` → `insertDeriveAndReadPool` →
  `deriveForRiderIds`, allocator.js:194 — `await derive(...)` uden coverage-tjek), og
- akademi-intake.
Så en frisk relaunch kunne GENSKABE bugen. Dette er samme klasse som #1478-akademi-
derive-halen (kode-fix retter ikke allerede-strandede rækker), men her er kilden selve
den tavse partielle insert-uden-fuldført-derive.

## Hvorfor team-markør-heal-sweepene IKKE fangede det
`starterSquadHealSweep.js` (#1563) og `academyHealSweep.js` (#1584) er TEAM-markør-gatede
(`starter_squad_allocated_at IS NULL` / `academy_intake_seeded_at IS NULL`). De fanger
strukturelt IKKE:
- strandede **free agents** (intet hold → ingen markør at gate på), og
- strandede ryttere **på hold hvor markøren er sat** (de 5 på menneske-hold).
Gaten er på den forkerte akse: derive-stranding er en RYTTER-data-tilstand, ikke en
team-bootstrap-tilstand.

## Fix (denne PR)
1. **One-time backfill** `backend/scripts/backfillRiderDerive.js` — finder alle aktive
   ryttere uden derived-række ELLER `base_value IS NULL` og re-deriver dem via den
   eksisterende derive-pipeline. DRY-RUN default; `--live` (ejer kører selv).
2. **Forward-guard (permanent):**
   a. **Rytter-invariant** i `backend/scripts/verify-invariants.js`
      (`riders_have_derived_abilities`): fejler hvis nogen aktiv ikke-retired rytter
      mangler derived-række ELLER har `base_value IS NULL`.
   b. **Rytter-DATA-gatet heal-sweep** `backend/lib/riderDeriveHealSweep.js` (cron, 5 min):
      re-deriver strandede ryttere uafhængigt af team-markører → fanger free agents OG
      ryttere på hold. Idempotent + deterministisk, ingen flag, cap pr. tick.
   c. **Kilde-guard** i `deriveForRiderIds`: efter writes verificeres at alle hentede
      input-id'er fik en ability-række + base_value; kaster ved partielt batch, så en
      fejl bliver synlig ved kilden (call-sites er ikke-fatale/idempotente → retry/sweep
      tager over).
3. **Tests:** `riderDeriveHealSweep.test.js`, guard-tests i `backfillCores.test.js`,
   `backfillRiderDerive.test.js`.

## Forward-guard-design / lektion
- **Gate heal-sweeps på den tilstand der faktisk er brudt.** En markør-sweep beskytter
  bootstrap-flowet; en datatilstand (manglende derive) skal gates på dataen selv, ellers
  er der huller (free agents, markerede hold).
- **En batch-derive skal verificere coverage, ikke kun returnere en summary.** "Indsat N"
  ≠ "derived N". Tavs partiel succes er den farligste fejl — gør den til en hård fejl.
- **Defense in depth:** kilde-guard (forhindrer ny stranding) + cron-sweep (heler
  eksisterende/fremtidig stranding) + invariant (opdager hvis begge fejler).
