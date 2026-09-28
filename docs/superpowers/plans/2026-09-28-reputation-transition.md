# Omdømme-overgang før synligt flag: implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task.

**Goal:** Vis aldrig et lavere omdømme end gammel popularitet ved lancering, og lad eksisterende bestyrelsesmål beholde deres oprindelige vurdering.

**Architecture:** Motorens rå omdømme bevares. Frontend og nye bestyrelseslæsere bruger et fælles overgangsprincip, mens et persisteret felt på nye mål fastholder deres målkontrakt. Kalibrering måler både synligt og råt tal; backfill planlægger alle rytter-rækker før en senere ejer-gated apply.

**Tech Stack:** Node.js, Supabase JS, React, TypeScript, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-04-reputation-system-design.md` §3/§7/§9 og ejerens design-go på PR #5828.

**Design-go:** Ejerens valg 28/9 på PR #5828 og det private read-only scorecard i OneDrive-context/private-handoffs/2026-09-28-before-s4-followup-private.md. `rider_reputation_enabled` forbliver `shadow`.

**Kilder:** `docs/superpowers/specs/2026-09-04-reputation-system-design.md` §3/§9, `docs/BOARD_RULES.md`, `docs/ECONOMY_RULES.md` og `docs/TONE_OF_VOICE.md`.

## Global constraints

- Ingen prod-skrivning, flag-flip eller merge i denne PR-session.
- Præcise balance-tal forbliver private; kun kvalitative konklusioner deles på GitHub.
- Patch note og hjælp er EN først og DA under. Ét annoteret før/efter-billede viser mobil og desktop.

## Review focus

- NULL-omdømme på ryttere uden hændelser giver aldrig et lavere synligt tal.
- En eksisterende aftalt bonus-baseline vurderes med samme målestok før og efter flag-skift.
- Nye mål får scoremarkør i både mandat, profil og DNA-forslag.
- Et rollback til off giver den gamle visning og den gamle board-adfærd.
- Markedsværdi læser fortsat popularity, og en dry-run kan ikke skrive til prod.

---

## Task 1: ét synligt ryttertal

- [ ] Skriv en fejlande test i `frontend/src/lib/riderReputationView.test.ts` for omdømme under popularitet og for NULL-omdømme, både med flag on og off.
- [ ] Brug `max(popularity, reputation)` i `riderReputationValue` når flaget er on; off bevarer popularitet. Kør testen grøn.
- [ ] Skriv en fejlande backend-test for samme tal i `boardIdentity.calculateRiderStarScore`; anvend den samme overgangsregel når omdømme er on. Bekræft at markedsværdi fortsat læser popularitet.

## Task 2: eksisterende stjernemål

- [ ] Skriv tests der viser et allerede opfyldt `signature_rider`-mål blive uopfyldt ved et naivt flag-skift, inkl. bonusmål med baseline.
- [ ] Markér nye `signature_rider`-mål med en persisteret `star_score_basis` ved oprettelse, også bonus- og DNA-mål. Mål uden markør beholder legacy-score ved både evaluering og progress gennem mandatets levetid.
- [ ] Kør bestyrelsens mål-, bonus- og mandat-tests. Mål den aktuelle produktionspopulation read-only igen og kræv nul allerede opfyldte mål som flipper.

## Task 3: kalibrering og populationsdækning

- [ ] Skeln rå motorværdi fra synligt overgangstal i `reputation-calibration.js` og spec §9. Målet 1-2 % Stjerne og højst 0,3 % Legende gælder det spiller-synlige tal under overgangen.
- [ ] Kalibrér `SOFT_CAP` efter ejerens godkendte scorecard. Backfill-scriptet skal i dry-run og senere ejer-gated apply kunne genberegne ALLE ryttere, også dem uden resultat-hændelser. Ingen apply i denne PR-session.
- [ ] Genkør officiel read-only harness og privat før/efter pr. popularitetsbånd; kræv 0 synlige fald og 0 bestyrelsesmål-flips før flag-go-kort.

## Task 4: release-tekst og verifikation

- [ ] Opdatér `BOARD_RULES.md`, omdømme-spec, EN/DA-hjælp og patch note 7.312 i samme PR. Ingen ændring af markedsværdi.
- [ ] Opdatér det ene annoterede før/efter-billede på mobil 390 og desktop 1440 med maskeret identitet og korrekt værdi-form.
- [ ] Kør preflight, TIER FULL, relevante e2e og uafhængigt read-only diff-tjek. Merge main ind, hold PR draft indtil CI er grøn og konfliktfri. Ingen merge, flag-flip eller prod-skrivning.
