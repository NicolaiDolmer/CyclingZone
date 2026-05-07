## Hvad
<!-- 1-2 sætninger om hvad denne PR ændrer -->

Refs #
<!-- Brug `Refs #N` ikke `Closes #N` — brugeren lukker selv issues efter manuel verifikation. -->

## Hvorfor
<!-- Kort kontekst — kan udelades hvis det dækkes af issuet -->

## Test plan
- [ ] Lokalt: `npm run build` passerer
- [ ] Lint: `npm run lint` passerer
- [ ] Manuel: <!-- hvad du klikkede på i browseren -->
- [ ] Regression: <!-- hvilke andre features blev tjekket -->

## Filer rørt
<!-- Auto-fyldes af git, men nævn særligt risikable filer her -->

## Skærmbillede / video
<!-- For UI-ændringer -->

---

## Close-out (efter merge til main)
<!-- Tjekliste der gælder både @claude-bot OG manuel session. Drop punkter der ikke gælder. -->

- [ ] **PatchNotesPage.jsx** opdateret med ny version — påkrævet ved enhver brugerrettet ændring (ellers note hvorfor ikke i PR-body)
- [ ] **`docs/NOW.md`** opdateret: tilføj entry i "Senest leveret", flyt issue ud af "Næste session" hvis listet, hold filen ≤ 30 linjer (arkivér til `docs/archive/` ved behov)
- [ ] **`docs/FEATURE_STATUS.md`** opdateret hvis kontrakter, runtime-state eller features ændret
- [ ] **`.claude/learnings/<dato>-<slug>.md`** oprettet hvis denne PR fixer en bug (root cause + fix + læring)
- [ ] **Issue-comment** med shipped-status + verifikation, label skiftet til `claude:done` (brugeren lukker selv issuet)
- [ ] **Branch slettet** efter merge (`gh pr merge --delete-branch` håndterer det)
