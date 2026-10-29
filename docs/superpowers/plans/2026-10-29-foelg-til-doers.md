# Følg til dørs: implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Byggestoppet og afslutnings-værnene fra spec'en håndhæves i kode og CI, så halvfærdigt arbejde ikke kan hobe sig op igen.

**Architecture:** De fleste værn findes allerede, men er bevidst ufarlige: udløbsfrister kun advarsel, triage-alder kun rådgivende, done-guard aldrig gjort required. Planen skærper dem og fylder de huller, der mangler: byggestop i admission og PR-CI, færdig-trin-vagt på issues, ratchet for erstattede komponenter, status-modsigelses-tjek, port for agent-oprettede issues og det daglige afslutningskort. Alt er Node-scripts med `node --test`, og de kobles på eksisterende workflows og hooks.

**Tech Stack:** Node 24 ESM-scripts (`scripts/*.mjs`), `node:test`, GitHub Actions, bash-hooks i `scripts/hooks/`, `gh` CLI, `docs/FEATURE_REGISTRY.yml`.

**Spec:** `docs/superpowers/specs/2026-10-29-foelg-til-doers-design.md` (ejer-godkendt 29/10)

## Global Constraints

- Byggestop: kun **færdiggørelse** (issue på fase 1-listen) og **brand** må bygges. Brand = "allerede live hos spillerne og virker forkert, ødelægger tillid eller giver forkerte tal"; rettelsen tilføjer ikke en ny funktion.
- Brand klassificeres af Claude og vises på afslutningskortet; ejerens veto flytter opgaven til `triage:new`.
- Loft: **3** samtidige områder (område = én registry-post eller ét epic). Brand tæller ikke med.
- Stoppet gælder **alle kanaler**: bølger (`wave.js`/`wave-policy.mjs`), Codex (`codex-wave.mjs`) og solo-sessioner. Den kanal-uafhængige håndhævelse er PR-CI.
- De seks færdig-trin: bygget · merget · tændt (eller `dormant` med ejer-dato) · synligt for spilleren · gammelt fjernet (0 brug) · hjælp + patch note. N/A kun med en linjes begrundelse.
- `FEATURE_REGISTRY.yml` er eneste kilde til tilstand. Andre dokumenter må beskrive regler, ikke påstå tilstand.
- Ingen dokumenter slettes (design-planer bevares).
- Genstart af race engine/stage scheduler/auto prize og destruktive prod-indgreb forbliver ejer-only. Tænding efter et ejer-godkendt kriterie er ikke destruktiv.
- Required-check-ændringer på `main` kræver ejeren (admin). Hver task, der gør et check required, slutter med den præcise `gh api`-kommando til ejeren, samme mønster som `done-guard.yml`-headeren trin a-d.
- Baselines er skralder: de må kun skrumpe (eksisterende mønster i `flag-liveness-baseline.json`).
- Commit kun bag `scripts/guard-commit-branch.sh`; feat/fix via branch + PR med `Refs #N`.

## Review Focus

1. **PR uden issue-reference** (fx Dependabot, docs, chore): byggestop-CI må ikke blokere dem. Forventet: `deps`/`docs`/`chore`-PR'er og `dependabot[bot]` er undtaget.
2. **Brand-label sat af en agent på en ny feature for at slippe igennem:** forventet at klassifikationen logges med begrundelse og står på afslutningskortet. Det er ejerens veto, der lukker bagdøren, så loggen må aldrig springes over.
3. **Overskredet `decide_by` blokerer alle PR'er, også brand-rettelser:** forventet at den blokerende regel kun rammer PR'er, der rører den overskredne posts filer eller selve registret. Andre PR'er får en advarsel.
4. **Issue lukket som "not planned" / parkeret til 2027:** færdig-trin-vagten må ikke kræve de seks trin. Den gælder kun `claude:done` og lukning som `completed`.
5. **Erstattet komponent importeret i en test eller i selve erstatningen:** ratchet'en tæller kun produktionskode i `frontend/src` uden `*.test.*` og `__tests__`.

---

### Task 1: Byggestop-politik (ren logik)

**Files:**
- Create: `scripts/lib/build-stop.mjs`
- Create: `scripts/build-stop.json`
- Test: `scripts/build-stop.test.mjs`

**Interfaces:**
- Produces:
  - `scripts/build-stop.json`: `{ "active": true, "since": "2026-10-29", "areaCap": 3, "finishList": [ { "issue": <int>, "area": "<registry-id|epic-#>" } ], "exemptPrefixes": ["docs","chore","deps","ci"] }`
  - `loadBuildStop(path?: string) -> BuildStopConfig`
  - `classifyWork({ issue: number|null, labels: string[], brandReason?: string, prTitle?: string, author?: string }, cfg) -> { cls: 'finish'|'brand'|'exempt'|'new', area: string|null, reason: string }`
  - `assertBuildStop(items: WorkItem[], cfg) -> void`: kaster `Error('Byggestop (spec 2026-10-29 §3.1): #N er nyt arbejde ...')` for `cls === 'new'` når `cfg.active`
  - `assertAreaCap(activeItems: WorkItem[], cfg) -> void`: kaster når antallet af distinkte `area` blandt `cls === 'finish'` overstiger `cfg.areaCap`

- [ ] **Step 1: Write the failing tests**

```js
test('issue på finishList er finish med area', () => assert.deepEqual(classifyWork({ issue: 7260, labels: [] }, cfg).cls, 'finish'));
test('brand kræver label brand OG ikke-tom brandReason', () => {
  assert.equal(classifyWork({ issue: 9999, labels: ['brand'], brandReason: 'træning giver forkerte tal' }, cfg).cls, 'brand');
  assert.equal(classifyWork({ issue: 9999, labels: ['brand'], brandReason: '' }, cfg).cls, 'new');
});
test('docs:/chore:/deps-titel og dependabot er exempt', () => {
  assert.equal(classifyWork({ issue: null, labels: [], prTitle: 'docs(now): x' }, cfg).cls, 'exempt');
  assert.equal(classifyWork({ issue: null, labels: [], author: 'dependabot[bot]' }, cfg).cls, 'exempt');
});
test('ukendt issue er new og assertBuildStop kaster', () => assert.throws(() => assertBuildStop([{ issue: 9999, labels: [] }], cfg), /Byggestop/));
test('active:false slipper alt igennem', () => assert.doesNotThrow(() => assertBuildStop([{ issue: 9999, labels: [] }], { ...cfg, active: false })));
test('4 områder over loft 3 kaster, brand tæller ikke', () => { /* 4 finish i 4 areas -> throws; 3 finish + 2 brand -> ok */ });
```

- [ ] **Step 2: Run tests to verify they fail.** Run: `node --test scripts/build-stop.test.mjs`. Expected: FAIL (modul findes ikke)
- [ ] **Step 3: Implement `scripts/lib/build-stop.mjs` + `scripts/build-stop.json`.** `finishList` er tom i denne task; den udfyldes fra ejerens rangerede liste (separat ejer-trin, ikke kode). Ingen I/O ud over `loadBuildStop`.
- [ ] **Step 4: Run tests to verify they pass.** Same command. Expected: PASS
- [ ] **Step 5: Commit** `feat(ops): byggestop-politik (Refs #<issue>)`

### Task 2: Byggestop i bølge- og Codex-admission

**Files:**
- Modify: `scripts/wave-policy.mjs` (`enqueueTracks` ~l.442, ved siden af `assertDesignGate`)
- Modify: `.claude/workflows/wave.js` (`normalizeTrack`, samme sted som design-gaten gentages ~l.420)
- Modify: `scripts/codex-wave.mjs` (efter `validateTracks` l.27 og l.85)
- Test: `scripts/build-stop.test.mjs` (udvid), `scripts/codex-wave.test.mjs`

**Interfaces:**
- Consumes: `classifyWork`, `assertBuildStop`, `assertAreaCap` fra Task 1
- Produces: nye valgfrie track-felter `stopClass: 'finish'|'brand'`, `brandReason: string`, `area: string`. Spor uden `stopClass` klassificeres via `finishList`.

- [ ] **Step 1: Failing tests:** `enqueueTracks` med et spor hvis issue ikke er på `finishList` og uden brand → kaster `/Byggestop/`. `codex-wave` plan med samme spor → afvist før worktrees oprettes. Et brand-spor skriver en linje til `scripts/.build-stop-brand-log.jsonl` (`{date, issue, brandReason, channel}`).
- [ ] **Step 2: Run** `node --test scripts/build-stop.test.mjs scripts/codex-wave.test.mjs`. Expected: FAIL
- [ ] **Step 3: Implement.** Kald `assertBuildStop` + `assertAreaCap` i alle tre indgange, og skriv brand-loggen ved admission. `kind:'investigate'` er exempt (læser kun).
- [ ] **Step 4: Run tests.** Expected: PASS. Kør også `node --test scripts/wave-policy*.test.mjs` for at bevise, at intet eksisterende brød.
- [ ] **Step 5: Commit**

### Task 3: Byggestop i PR-CI (alle kanaler)

**Files:**
- Create: `scripts/check-build-stop-pr.mjs`
- Create: `.github/workflows/build-stop.yml`
- Modify: `scripts/ci-required-checks.json`
- Test: `scripts/check-build-stop-pr.test.mjs`

**Interfaces:**
- Consumes: Task 1
- Produces: `parseIssueRefs(body: string) -> number[]` (matcher `Refs #N`, `Closes #N`, `Fixes #N`) · CLI `node scripts/check-build-stop-pr.mjs --pr <n>` exit 1 ved nyt arbejde · check-navn `build-stop`

- [ ] **Step 1: Failing tests:** body med `Refs #9999` (ikke på listen, ingen brand-label) → exit 1 med besked der nævner spec §3.1 og hvordan man får et punkt på listen. Body med `Refs #7260` (på listen) → exit 0. Docs-titel uden ref → exit 0. Body uden ref og med `feat:`-titel → exit 1 ("feat/fix kræver issue-reference").
- [ ] **Step 2: Run** `node --test scripts/check-build-stop-pr.test.mjs`. Expected: FAIL
- [ ] **Step 3: Implement.** Labels hentes med `gh issue view N --json labels`; `brandReason` læses fra issue-body-sektionen `### Brand-begrundelse`. Workflow på `pull_request` (opened/synchronize/edited), `permissions: contents: read, issues: read`. Tilføj `build-stop` til `ci-required-checks.json`, og kør `node scripts/check-required-ci-jobs.mjs` grøn.
- [ ] **Step 4: Run tests.** Expected: PASS
- [ ] **Step 5: Commit.** Afslut med ejer-kommandoen: `gh api -X POST repos/NicolaiDolmer/CyclingZone/branches/main/protection/required_status_checks/contexts -f 'contexts[]=build-stop'`

### Task 4: done-guard bliver blokerende (det der skulle være sket 1/10)

**Files:**
- Modify: `.github/workflows/done-guard.yml` (fjern begge `continue-on-error: true`, job-navn `done-guard`)
- Modify: `scripts/ci-required-checks.json`

**Interfaces:** ingen nye. Følger headerens trin a-d ordret.

- [ ] **Step 1:** Kør `node scripts/check-flag-liveness.mjs` og `node scripts/check-pr-claims.mjs` på main. Expected: grøn, eller fund som rettes eller lægges i baseline i samme PR.
- [ ] **Step 2:** Udfør trin a+b. Run `node scripts/check-required-ci-jobs.mjs`. Expected: PASS
- [ ] **Step 3: Commit** + ejer-kommando trin c (`contexts[]=done-guard`) og verifikation trin d.

### Task 5: Registry-felter: synlig, erstatter, tændingskriterie + hårde frister

**Files:**
- Modify: `scripts/generate-feature-status.mjs` (`KNOWN_FIELDS` l.65 + validering ~l.192)
- Modify: `docs/FEATURE_REGISTRY.yml` (skema-header)
- Modify: `scripts/feature-registry-flag-expiry.mjs`
- Test: eksisterende `generate-feature-status` / `feature-registry-flag-expiry` tests (udvid)

**Interfaces:**
- Produces nye felter: `visible_in` (sti eller rute hvor spilleren ser det; påkrævet for `state: live` i `area: race-engine|race-day|training`, ellers advarsel), `replaces` (komponent-/filsti der erstattes), `switch_on_when` (ejer-godkendt tændingskriterie, fri tekst ≤1 linje), `switch_on_approved` (YYYY-MM-DD).
- `listOverdue(entries, today) -> Entry[]` (findes muligvis; ellers ny)

- [ ] **Step 1: Failing tests:** live race-engine-post uden `visible_in` → fejl. `switch_on_when` uden `switch_on_approved` → fejl. Overskredet `decide_by` → **fejl** når PR'en rører `FEATURE_REGISTRY.yml` eller en fil under postens `ssot`/kendte stier, ellers advarsel (Review Focus 3).
- [ ] **Step 2: Run** relevante `node --test`. Expected: FAIL
- [ ] **Step 3: Implement.** Eksisterende live-poster uden `visible_in` lægges i en shrink-only baseline `scripts/feature-registry-visible-baseline.json`. Tilføj `scripts/flag-switch-check.mjs <registry-id>`: exit 0 kun når `switch_on_when` og `switch_on_approved` er sat, ellers exit 1 med "mangler ejer-godkendt tændingskriterie" (spec §6.8). Det kaldes før enhver tænding af et spillervendt flag.
- [ ] **Step 4: Run** tests + `node scripts/generate-feature-status.mjs --check`. Expected: PASS
- [ ] **Step 5: Commit**

### Task 6: Ratchet for erstattede komponenter (gammelt skal væk)

**Files:**
- Create: `scripts/check-replaced-components.mjs`
- Create: `scripts/replaced-components-baseline.json`
- Modify: `.github/workflows/feature-registry-check.yml` (tilføj step)
- Test: `scripts/check-replaced-components.test.mjs`

**Interfaces:**
- Consumes: `replaces` fra Task 5
- Produces: `countImports(target: string, files: string[]) -> { file, line }[]` · baseline `{ "<replaced path>": <count> }`

- [ ] **Step 1: Failing tests:** brug-antal over baseline → fejl ("ny brug af erstattet komponent X; brug Y"). Under baseline uden at baseline er sænket → fejl ("sænk baseline til N"). Imports i `*.test.*`/`__tests__` tælles ikke. Post med `replaces` kan ikke have `state: live` uden advarsel, før tallet er 0.
- [ ] **Step 2: Run** `node --test scripts/check-replaced-components.test.mjs`. Expected: FAIL
- [ ] **Step 3: Implement** + seed: `stage-page-v2` får `replaces: frontend/src/components/race/StageProfileGraph.jsx` og `frontend/src/components/race/TerrainTypeGlyph.jsx`. Baseline = de nuværende tal (målt 29/10: graf 6 forbrugere, glyf 4).
- [ ] **Step 4: Run tests.** Expected: PASS
- [ ] **Step 5: Commit**

### Task 7: Én sandhed: status-modsigelser fejler

**Files:**
- Create: `scripts/check-status-claims.mjs`
- Modify: `.github/workflows/feature-registry-check.yml`
- Modify: `docs/RACE_ENGINE_RULES.md` (ret eksisterende modsigelser: `stage_plan_v1` l.474, `race_day_intention_enabled` l.444 m.fl.)
- Test: `scripts/check-status-claims.test.mjs`

**Interfaces:**
- Produces: `findClaims(markdown: string, flagKeys: string[]) -> { key, claim: 'on'|'off', line }[]`. En claim er en linje, der nævner en registry-`flag`/`id` og et af ordene `slukket|off|tændt|live|on` · `compare(claims, registry) -> Contradiction[]`

- [ ] **Step 1: Failing tests:** linjen "`stage_plan_v1` ... off" mod registry `state: live` → modsigelse. En linje med `<!-- status-fra-registry -->` springes over. En linje der kun beskriver en regel uden tilstandsord → ingen claim.
- [ ] **Step 2: Run.** Expected: FAIL
- [ ] **Step 3: Implement.** Skannede filer: `docs/RACE_ENGINE_RULES.md`, `docs/RACE_ENGINE_PLAN.md`, `docs/NOW.md`, `docs/MASTERPLAN.md`. Ret de fundne modsigelser i samme PR ved at erstatte tilstandspåstanden med en henvisning til registry-id'et.
- [ ] **Step 4: Run** tests + `node scripts/check-status-claims.mjs`. Expected: PASS, 0 modsigelser
- [ ] **Step 5: Commit**

### Task 8: Færdig-trin-vagt på issues

**Files:**
- Create: `scripts/check-done-steps.mjs`
- Create: `.github/workflows/done-steps-guard.yml`
- Modify: `.github/ISSUE_TEMPLATE/feature.yml`, `claude-task.yml`, `bug.yml` (ny sektion `### Færdig-trin` med de seks punkter, og sektionen `### Brand-begrundelse` i `bug.yml`)
- Test: `scripts/check-done-steps.test.mjs`

**Interfaces:**
- Consumes: registry-felter (Task 5), ratchet (Task 6)
- Produces: `evaluateSteps({ issue, body, mergedPrs, registryEntry, replacedCount, patchNoteHit }) -> { step: 1..6, ok: boolean|'na', why: string }[]`

- [ ] **Step 1: Failing tests:** trin 2 udledes af merged PR med `Refs/Closes #N`. Trin 3 = registry `live`, eller `dormant` med `decide_by`. Trin 4 = `visible_in` sat. Trin 5 = `replacedCount === 0`. Trin 6 = patch note-dækning (genbrug `check-patch-notes-coverage`). `N/A: <tekst>` i body → `'na'`, tom tekst → ikke ok. Lukning som `not_planned` → vagten springer over (Review Focus 4).
- [ ] **Step 2: Run.** Expected: FAIL
- [ ] **Step 3: Implement.** Workflow på `issues: [labeled, closed]` når label er `claude:done` eller `state_reason == completed`, med `permissions: issues: write`. Mangler et trin: fjern `claude:done` eller genåbn, og kommentér listen over manglende trin. Reaktivt, jf. spec §6.6. Gælder kun issues oprettet eller done-markeret efter 2026-10-29 (§6.5).
- [ ] **Step 4: Run tests.** Expected: PASS
- [ ] **Step 5: Commit**

### Task 9: Port for nye issues + én plan pr. område

**Files:**
- Modify: `scripts/hooks/lint-gh-issue.sh` (fra advarsel til blokering for netop dette mønster)
- Create: `scripts/check-spec-per-area.mjs`
- Modify: `.github/workflows/feature-registry-check.yml`
- Modify: `.github/workflows/triage-age-guard.yml` (fra rådgivende til rød + `weekly-steering-report.mjs` viser antal)
- Test: `scripts/hooks/__tests__/lint-gh-issue.test.*` (eksisterende mønster), `scripts/check-spec-per-area.test.mjs`

**Interfaces:**
- Produces: specs dateret ≥ 2026-10-30 kræver frontmatter `area: <registry-id|epic>` og valgfrit `supersedes: <spec-fil>` · `findOpenSpecs(area) -> string[]`

- [ ] **Step 1: Failing tests:** `gh issue create ... --label claude:todo` fra en agent-session → exit 2 med besked "brug triage:new (spec §3.6)". Ny spec med `area: race-engine-breakaway`, hvor en anden åben spec har samme area og ingen `supersedes` → fejl. Ældre specs uden frontmatter → ignoreres.
- [ ] **Step 2: Run.** Expected: FAIL
- [ ] **Step 3: Implement.** Hooken kører kun i agent-sessioner og rører ikke ejerens egen terminal. Issue-skabelonerne beholder `claude:todo`, fordi ejeren opretter via UI (§6.10).
- [ ] **Step 4: Run tests.** Expected: PASS
- [ ] **Step 5: Commit**

### Task 10: Dagligt afslutningskort

**Files:**
- Create: `scripts/owner-closing-card.mjs`
- Modify: den eksisterende morgenblok-rutine (find kilden via `grep -rn "08:30\|morgenblok" scripts docs/AI_OPS_REFERENCE.md`; kortet indsættes der, ikke i en ny rutine)
- Test: `scripts/owner-closing-card.test.mjs`

**Interfaces:**
- Consumes: brand-log (Task 2), `listOverdue` (Task 5), `gh` labels
- Produces: `buildCard({ doneAwaiting, needsDecision, overdue, brandLast24h, switchReady }) -> string` (markdown, **højst 5 punkter**, prioritet: brand-veto → tændingsklar → overskredet frist → verifikation → beslutning)

- [ ] **Step 1: Failing tests:** 12 kandidater → præcis 5 linjer + "og 7 mere". Hver linje har en almindelig-ord-beskrivelse (ikke bart `#N`) og én handling. Tom input → "Intet venter på dig".
- [ ] **Step 2: Run.** Expected: FAIL
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS
- [ ] **Step 5: Commit**

## Rækkefølge og afhængigheder

Task 1 → 2 → 3 er **fase 0 (stoppet)** og skal ligge først. **Vigtigt:** Task 3 må først gøres required, når ejerens rangerede fase 1-liste står i `finishList`. Med en tom liste ville alle feat/fix-PR'er undtagen brand blive blokeret. Task 4 er uafhængig. Task 5 → 6 → 8 og 5 → 7 hænger sammen. Task 9 og 10 kan køre parallelt efter Task 2.

**Ikke i denne plan (ejer-trin, ikke kode):** den rangerede fase 1-liste (`finishList` i `scripts/build-stop.json`) og engangssorteringen af de 942 issues. De laves som separate ejer-sessioner med bunker til godkendelse.
