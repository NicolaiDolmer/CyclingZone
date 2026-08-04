# Postmortem · 2026-08-04 · Fyret staff blev tilbudt igen som kandidat (rehire-loop)

## Hvad skete der?
Spiller-rapport i Discord #dansk-snak (@adorable_chipmunk_89342, ugesweep 3/8, se
[#2887](https://github.com/NicolaiDolmer/CyclingZone/issues/2887)-kommentar 2026-08-03):
fyrede en sportsdirektør-træner for at få en bedre kandidat — den lige-fyrede
træner blev tilbudt igen som topkandidaten ved næste candidates-refresh. "Fyr og
find bedre" blev meningsløst, fordi kandidatpuljen ikke ændrede sig efter fyring.

## Root cause
`generateStaffCandidates({ teamId, seasonNumber, role, facilityTier })` i
`backend/lib/staffCandidates.js` er en ren, deterministisk funktion — seedet
udelukkende af `(teamId, seasonNumber, role)`. Det er en bevidst designbeslutning
(regression-guard mod refresh-spam, se testen "ingen reroll ved refresh"), men den
gjorde funktionen blind for hvem holdet lige har fyret: samme (team, sæson, rolle)
→ samme 3 kandidater, hver eneste gang — også umiddelbart efter en fyring i samme
sæson. Både `hireStaff` (facilityService.js) og `getStaffCandidatesHandler`
(facilityRoutesHandlers.js) kaldte generatoren uden nogen viden om
`team_staff.status='fired'`-rækker.

Read-only verifikation mod prod (2026-08-04, `execute_sql` mod projekt
`ghwvkxzhsbbltzfnuhhz`): 11 distinkte (team, rolle)-par har allerede en AKTIV
staff-række med samme navn som en tidligere FYRET række i samme (team, rolle) —
dvs. buggen har allerede ramt reelle hold i prod, ikke kun teoretisk. 20 hold har
mindst én fyret staff-række; 28 (team, rolle)-par har oplevet mindst én fyring.

## Fix
- `backend/lib/staffCandidates.js`: `generateStaffCandidates` fik et nyt valgfrit
  `excludeNames` (Set|Array)-parameter. Navne heri springes over på samme måde som
  den eksisterende `usedNames`-dedup — udeladt/tomt `excludeNames` giver 100%
  identisk output som før (ingen regression for de ~15 eksisterende
  determinisme-/kollisions-tests).
- `backend/lib/facilityService.js`: ny eksporteret `loadFiredStaffNames(teamId,
  role, supabaseClient)` — henter ALLE navne holdet nogensinde har fyret i denne
  rolle (ikke kun indeværende sæson, da et fyret navn ellers kunne genopstå i en
  senere sæson, hvor seedet igen matcher). `hireStaff` kalder den FØR
  `generateStaffCandidates` og sender resultatet som `excludeNames`.
- `backend/lib/facilityRoutesHandlers.js`: `getStaffCandidatesHandler` (GET
  `/api/club/staff/candidates`) bruger samme `loadFiredStaffNames`, så UI'et aldrig
  viser en fyret kandidat, og backend-valideringen i `hireStaff` er konsistent med
  det spilleren faktisk ser.

## Forhindret-fremover
- Ny rød→grøn TDD-test i alle tre lag: `staffCandidates.test.js` (ren
  `excludeNames`-adfærd), `facilityService.test.js` ("hire: fired staff's name is
  excluded from regenerated candidate pool"), `facilityRoutes.test.js` ("GET
  candidates: udelukker fyrede navne..."). Alle reproducerede buggen (rød) før
  fixet og er grønne efter.
- Ingen migration nødvendig — løsningen bruger den allerede eksisterende
  `team_staff.status='fired'`-kolonne; ingen data-reparation af de 11 allerede
  ramte prod-rækker (ejer-beslutning, se `morning_decision` i PR-rapporten).

## Læring
En "deterministisk seed for at forhindre refresh-spam"-optimering kan utilsigtet
skabe et modsat problem: determinisme uden eksklusions-mekanisme betyder at ENHVER
statusændring udenfor selve seedet (her: fyring) er usynlig for generatoren.
Når en pulje-generator er ren/deterministisk af design, skal caller-siden eksplicit
fodre den med al relevant statslig kontekst (her: fyrede navne) — determinisme i
sig selv garanterer ikke korrekthed, kun reproducerbarhed.
