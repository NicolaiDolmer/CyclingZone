# Pulje-tilhør skal håndhæves på ALLE entry-veje, ikke kun den der fejlede synligt

**Dato:** 2026-06-23
**Issues:** #1798 (incident), #1793 (autofill-fix), #1813 (denne — manuel-udtagelse-guard)

## Hvad skete

En pre-flight audit af aftenens auto-løb (skulle bekræfte at #1793-fixet holdt) afslørede en **latent variant af den samme bug**: manuel holdudtagelse via `PUT /api/races/:raceId/selection` håndhævede ikke pulje-tilhør. Et hold kunne udtage til et løb i en anden pulje, og fordi autofill (`fillMissingTeamEntries`) springer hold med eksisterende entries over, ville en fremmed-pulje-udtagelse **overleve** pulje-filteret fra #1793 og kontaminere feltet — samme symptom som incident #1798.

## Rod-årsag

`race_entries` (et løbs felt) kan skrives ad **tre veje**, og pulje-tilhør var kun håndhævet på to:

| Vej | Pulje-håndhævelse før #1813 |
|---|---|
| Autofill ved afvikling (`fillMissingTeamEntries`) | ✅ filter siden #1793 |
| Proaktiv generator (`raceEntryGenerator.js`) | ✅ grupperer løb+hold pr. pulje by design |
| Manuel udtagelse (`PUT /selection`) | ❌ ingen guard |

#1793 fiksede den vej der fejlede *synligt* (autofill, fordi den ramte alle hold på incident-dagen). Den manuelle vej var et stille, latent hul.

## Lærdom (generaliserbar)

Når en data-integritets-invariant brydes (her: "et hold hører kun til feltet for løb i egen pulje"), så **find ALLE skrive-veje til den delte tabel og håndhæv invarianten konsistent** — ikke kun den vej der producerede den synlige fejl. En backwards-check ("hvor ellers kan denne row opstå?") fanger latente varianter før de bider. Jf. [[feedback_backwards_check_forward_guard]] og [[feedback_match_ui_filter_for_capacity_logic]] (samme mønster: gentag diskriminatoren overalt).

## Fix + forward-guard (#1813)

- Pure helper `teamInRacePool()` i `raceBinding.js` (race-hub Fase 0a-modulet) — hold↔pulje-binding ved siden af rytter↔tid-binding. 4 enhedstests (TDD).
- `PUT /selection` afviser fremmed-pulje med `409 selection_wrong_pool` (+ i18n en/da).
- **Forward-guard:** pulje-binding skrevet ind i race-hub-spec'en (sektion 3 + 6) som eksplicit Fase 0-invariant med alle tre veje listet, så den nye udtagelsesside (Fase 1) arver det og fremtidige skrive-veje ikke glemmer det.

## Proces-note

Auditten blev stærkere af et ejer-skub: "det skal du kunne afgøre FØR løbet, ud fra de tilmeldte." Det flyttede verifikationen fra "vent og se efter afvikling" til at reproducere felt-sammensætnings-reglen i SQL og bevise pulje-renhed på forhånd — hvilket netop afslørede at den manuelle vej kunne plante en fremmed entry.
