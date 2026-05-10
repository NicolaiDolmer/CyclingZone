## Hvad
<!-- 1-2 sætninger om hvad denne PR ændrer -->

Refs #
<!-- Brug `Refs #N` ikke `Closes #N` — brugeren lukker selv issues efter manuel verifikation. -->

## Hvorfor
<!-- Kort kontekst — kan udelades hvis det dækkes af issuet -->

## Test plan
- [ ] Frontend build: `npm run build --prefix frontend` passerer
- [ ] Backend tests: `npm test --prefix backend` passerer
- [ ] Lint: `npm run lint --prefix frontend` + `npm run lint --prefix backend` passerer
- [ ] Manuel: <!-- hvad du klikkede på i browseren -->
- [ ] Regression: <!-- hvilke andre features blev tjekket -->

## Brugerverifikation (KRÆVET)
<!-- Indført efter slice 14 / #279: service_role-tests var grønne, authenticated frontend-reads var broken. -->
<!-- Skip kun via label `docs-only` eller `backend-only` — ellers skal mindst én checkbox være sat. -->

- [ ] Jeg har åbnet feature i prod eller preview-deploy og bekræftet at brugere ser forventet UI/data
- [ ] Jeg har testet som **authenticated user** (ikke kun service_role / admin)
- [ ] Hvis ikke testet end-to-end: forklar hvorfor (pure backend-refactor / docs-only / migration uden UI-impact osv.)

**Hvad jeg verificerede konkret:** <!-- URL + 1-2 sætninger om hvad jeg så -->

## Risk / auto-merge
<!-- Tilføj label hvis relevant: risk:med, risk:high, security, needs-decision eller manual-review stopper auto-merge. -->
- [ ] `auto-merge` er kun sat hvis PR'en er lav-risiko og ikke kræver menneskelig beslutning
- [ ] Dependency/security-impact er vurderet hvis `package*.json`, workflows, auth, DB eller upload-flow ændres

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
