# Race-hub trup-fordeling: eksplicit Gem + race-tid auto-fyld (design)

> Status: **design låst med ejeren (Nicolai) 2026-06-28**, build samme dag. Afløser auto-gem-når-fuld (#1906).
> Kun kode (ingen prod-data-mutation). Branch `feat/racehub-save-ux`.

## Hvorfor

Auto-save UX'en er "helt galt" (ejer 28/6). Rod: board'et auto-gemmer KUN ved nøjagtig fuld trup (`isSelectionSavable` = `count === max`, + backend `validateSelection` required = `size.max`). Konsekvenser:
- Delvis trup gemmes aldrig → at fjerne en rytter persisterer ikke (ruller tilbage).
- Redigering af en fuld trup er en bøvlet "fjern → (ugemt) → tilføj"-dans; flytte-logikken bruger SERVER-tilstand, så en rytter fjernet fra løb A kan ikke straks bruges i overlappende løb B uden et gem imellem.
- Auto-save fyrer + re-henter på hver fuld tilstand → "hoppende".

## Låste beslutninger (ejer 28/6)

1. **Ingen auto-save. Eksplicit Gem-knap.** Hele board'et er én lokal kladde; alt redigeres lokalt uden netværk; først Gem persisterer.
2. **Fjern → straks genbrugbar.** Fjernes en rytter fra løb A, er han med det samme fri i kladden og kan lægges i et overlappende løb B i samme redigerings-session. Gem gemmer begge ændringer samlet.
3. **Gem accepterer delvis trup.** Ingen fuld-trup-krav for at gemme (0..max). 0 manuelle = fuldt auto-udtaget; delvis = manuelle picks bevares.
4. **Race-tid auto-fyld:** når løbet køres, top-fyldes en ufuldstændig trup automatisk fra holdets ledige, berettigede ryttere (binding-bevidst). Manager sætter sine præferencer; motoren fuldender.
5. **Forlad-vagt:** "Du har ændringer der ikke er gemt"-indikator + advarsel ved navigation/luk.
6. **Binding (én rytter pr. in-game-dag) bevares** som hård regel — men beregnet fra KLADDEN, så den følger live-ændringer.

## Arkitektur

### Frontend — `RaceHubBoard.jsx` + pulje/popover
- **Fjern auto-gem** fra `commitDraft` (ingen PUT på edit). Edit muterer kun `drafts`.
- **Board-level "Gem ændringer"-knap:** aktiv når mindst én kolonnes kladde ≠ server-selection (dirty). Gemmer alle dirty kolonner via eksisterende `PUT /races/:id/selection`, i **binding-sikker rækkefølge** (kolonner hvor ryttere er FJERNET/reduceret gemmes før kolonner hvor de er TILFØJET, så serveren aldrig ser en transient dobbeltbooking). Fejl pr. kolonne mappes til en besked; resten fortsætter.
- **Binding fra kladden overalt:** `draftBindingMap` (allerede draft-baseret) bruges til pulje-lås + popover. `addRider`/flyt-beslutning bruger KLADDEN, ikke `data.bindingMap` (server) — så fjern-i-A-så-tilføj-i-B virker uden mellem-gem. Ingen "move til server" under redigering; flyt = ren kladde (fjern fra A + tilføj til B).
- **Dirty-state + forlad-vagt:** `beforeunload` + react-router-blocker når der er ugemte kladder; "Gem"/"Kassér"-affordance.
- **Byt = én handling:** træk ledig rytter oven på en i fuld kolonne = erstat; træk rytter mellem kolonner = flyt (alt i kladden).
- Pulje-lås: en rytter er kun låst hvis han ikke kan tilføjes NOGEN kolonne i kladden (game-dag-bevidst, allerede bygget).

### Backend — `raceSelection.validateSelection`
- **Tillad delvis:** accepter `0 ≤ count ≤ max` (drop `required = max`). Binding + pulje + eligibility-checks bevares. Tom selection = ingen manuelle entries (auto-fyld dækker ved race-tid).

### Backend — `raceEntryGenerator.js` (race-tid auto-fyld)
- I dag: `hasManual` → **skip** hele (race, team). Nyt: `hasManual` men **delvis** (< sizeRule.max) → **top-fyld gabet** — kald `assignTeamAcrossRaces` for de RESTERENDE pladser med de manuelle picks som låste, så manuelle bevares (`is_auto_filled=false`) og top-up er `is_auto_filled=true`. Fuld manuel (= max) → skip (intet at fylde). Binding-bevidst (manuelle + andre løbs vinduer låst).
- Idempotent: sletter kun `is_auto_filled=true` og genskaber; manuelle røres aldrig (uændret).
- Kør-tidspunkt: generatoren kører proaktivt (autoEntryGeneratorFlag). Verificér den kører før race-eksekvering; tilføj top-up som sikkerheds-net i race-runner hvis et løb kan eksekvere før en generator-kørsel (verificeres i build).

## Test-strategi
- Pure: `isSelectionSavable` udgår/erstattes (Gem-knap styrer); ny `boardDirty`/diff-helper; `raceEntryGenerator` gap-fill (delvis manuel → top-up til max, manuelle bevaret, binding respekteret; fuld manuel → uændret skip).
- Backend `validateSelection`: delvis accepteres; binding/eligibility stadig håndhævet.
- e2e (`race-distribution.spec.js`): rediger frit uden gem; fjern fra A → tilføj til overlappende B → Gem → begge persisteret; dirty-guard; delvis gem persisterer.
- Fuldt CI-gate-sæt (verify-local + lint + i18n + warning-budget + playwright 3 projekter).

## Patch notes / help
- Patch note: "Sæt din trup frit og gem når du er klar" (auto-save erstattet af Gem; delvis trup OK, resten autoudtages ved løbsstart). Help-FAQ opdateres (overlappingRaces + en ny "hvordan gemmer jeg").

## Eksplicit ikke i scope
- Race-engine-resultat-pipeline (uændret). Op/nedrykning. Selve binding-reglen (uændret, kun draft-kilden).
