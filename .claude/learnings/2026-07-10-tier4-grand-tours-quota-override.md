# 2026-07-10 — Grand Tours i Division 4: kvote-override nulstillede cross-tier-dedup

**Issue:** #2251 · **Symptom:** Sentry "No start list for race" (escalating, 36 events) + stall-watchdog dagligt.

## Hvad skete
Ved midt-sæson-aktivering af tier 4-puljer (#2149-reconcile, 4/7) blev tier 4-kalenderen
materialiseret med `quotas: { [tier]: … }` — en override der ERSTATTEDE hele kvote-tabellen.
Tier 1–3 fik dermed kvote 0 i plan-genberegningen → deres selections blev tomme →
`usedRaceIds` (cross-tier dedup) var tom → tier 4 valgte frit fra HELE kataloget, og
prestige-først-walket greb to 21-etapers Grand Tours (Vuelta Ibérica + Tour de l'Hexagone)
— de samme løb som allerede kørte i Division 1. Med kvote ~44 lå de to GT'er oveni hinanden
(game_day 0–20 begge) og oveni alle mindre etapeløb.

Konsekvens: #1845-bindingen (én rytter = ét løb pr. game-dag) ekskluderede korrekt næsten
alle ryttere ved etape-1-autofill i de øvrige løb → tomme startfelter → `No start list`
hver scheduler-tick i dagevis; nogle løb startede senere med degenererede mini-felter
(Vuelta Ibérica div 8: 4 etaper kørt med 1 rytter).

## Rod-årsager (tre lag)
1. **Override-semantik:** `quotas`-parametret var replace, ikke merge — én kalder glemte det.
2. **Manglende domæne-regel:** `selectTierRaceSet` havde ingen "GT'er kun i tier 1"-regel;
   dedup var det ENESTE værn, og det var implicit.
3. **Ingen invariant-verifikation ved apply:** materializeren skrev planen uden at validere
   spec'ens kalender-invarianter (GT-placering, GT-rygrad-ikke-overlap).

## Fix (PR fix/2251-tier4-no-grand-tours)
- `selectTierRaceSet({ allowGrandTours })`: GT'er (≥15 etaper) filtreres fra for tier > 1.
- Reconcile merger nu kvote-override oven på `TIER_GAME_DAY_QUOTA` (dedup virker igen).
- `detectCalendarViolations()` (pure, testet): GT-i-lav-tier + GT-rygrad-overlap →
  `materializeTierCalendars` NÆGTER apply ved brud (dryRun rapporterer).
- Reparation af prod: `backend/scripts/repair2251Tier4GrandTours.js` (dry-run default,
  JSON-backup, ejer-gated) — sletter GT-instanserne i tier 4 og re-materialiserer resten
  af horisonten afkortet til fælles sæson-slut.

## Læring
- **En "kun min tier"-override af en delt konfigurationstabel skal MERGE, ikke REPLACE** —
  andre tiers' rækker kan være input til krydsvalidering (dedup) selv når de ikke skrives.
- **Domæne-invarianter skal håndhæves dér hvor data skrives** (apply-gate), ikke kun
  implicit via rækkefølge/dedup i happy path.
- Spec-antagelser der var sande ved godkendelse ("Div 4: 0 hold — out of scope") bliver
  usande senere; koden der aktiverer det udskudte scope skal genbesøge spec'ens invarianter.
