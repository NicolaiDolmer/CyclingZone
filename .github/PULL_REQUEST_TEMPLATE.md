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

## Afledningstjekliste (KRÆVET ved populations-mutationer)
<!-- Indført efter ryttertype-backfillen 5/8-2026 (#3372/#3441/#3442): typeskiftet så isoleret ud,
     men caps, scout-bånd, lønkrav og 14-dages-deltaer afledes af type ved runtime — og flyttede med.
     Gælder enhver backfill/migration/script der muterer felter på ryttere, hold eller andre populationer. -->

- [ ] **Alle afledte felter er listet:** hvilke beregninger konsumerer de muterede felter ved runtime (grep efter feltnavnet i backend/lib + frontend)? Listen skrives HER i PR-body — ikke "ingen", medmindre greppet er vedlagt.
- [ ] **Alle afledte flader er listet:** hvilke spillervendte visninger ændrer sig som konsekvens (scout-rapporter, værdier/deltaer, lønkrav, AI-adfærd, badges/labels)?
- [ ] **Historik-/delta-grundlag:** rører mutationen noget som delta-/historikvisninger sammenligner imod? Backfill må ikke fremstå som "ændring" for spilleren.
- [ ] **Snapshot dækker de afledte felter** — ikke kun de direkte muterede (ellers kan effekten ikke rulles tilbage eller måles).
- [ ] **Spillerkommunikation:** hvis en afledt flade flytter sig synligt, er kommunikationen planlagt FØR kørslen (patch note / Discord), ikke efter klagerne.

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
