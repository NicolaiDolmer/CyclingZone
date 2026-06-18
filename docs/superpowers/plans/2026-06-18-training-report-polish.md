# Trænings-polish: anticipation → payoff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gør fremskridt synligt og gennembrud til et roligt payoff-moment i det daglige trænings-loop — uden ny motor, kun feedback-laget.

**Architecture:** Lille backend-berigelse (rapport-rækken får det faktiske tal-spring pr. gevinst). Rene frontend-helpers afleder fokus-progress, gennembrud og dags-opsummering fra eksisterende `useTraining`-data. TrainingPage får en progress-kolonne i roster (anticipation), og rapporten får dags-opsummerings-stribe + progress + gennembruds-styling + en Result-kolonne der erstatter rå score.

**Tech Stack:** React + Vite (frontend), Node.js (backend engine, `node --test`), i18next (en+da), Tailwind med cz-design-tokens.

**Anti-AI-slop:** Fladt/editorial, `rounded-cz` (ALDRIG rounded-xl — ui-slop ratchet), ingen glow/emoji/gradient/animationsfest, sentence case. Gennembrud = rolig `cz-success`-tint + venstre-accent + ærligt tal-spring.

---

## Datakilder (verificeret i kode 2026-06-18)

- `useTraining()` eksponerer `progress` = `{ [riderId]: { [ability]: 0..1 } }` (fra `ability_progress`, `api.js:1136-1139`). Frisk efter `runToday()` (refresh kaldes).
- `todayRun.report.riders[]` rækker har i dag: `rider_id, name, score, gains:{ability:n}, status, form, fatigue, fatigue_delta, injured, injury_days, focus, intensity` (`dailyTrainingEngine.js:241-254`). **Mangler:** efter-værdien pr. gevinst → Task 1 tilføjer `gains_detail`.
- Fokus → evner: `TRAINING_FOCUS_ABILITIES` i `frontend/src/lib/training.js:9-16` (spejler backend `TRAINING_FOCUSES`).
- Evne-labels: `tRider("derived.<ability>")` (rider-namespace, `rider.json` `derived`-objekt).
- `rounded-cz` = `var(--radius-sm)` (tailwind.config.js:78). `cz-success` / `cz-success-bg` findes (tint).

---

## Task 1: Backend — berig rapport-rækken med faktisk tal-spring

**Files:**
- Modify: `backend/lib/dailyTrainingEngine.js` (rapport-bygning ~linje 240-254)
- Test: `backend/lib/dailyTrainingEngine.test.js` (ny test i slutningen)

- [ ] **Step 1: Skriv den fejlende test**

Tilføj i `backend/lib/dailyTrainingEngine.test.js` (efter sidste test, før evt. EOF):

```js
// ── Test: gains_detail giver faktisk tal-spring pr. gevinst (#1305 polish) ──────
test("rapport-række inkluderer gains_detail med from/to pr. gevinst", async () => {
  // Rytter med climbing-progress 0.999 + vo2max/hard → climbing rammer +1 i dag.
  const state = seedState({
    abilities: [makeAbilityRow("r1", { ability_progress: { climbing: 0.999 } })],
    plans: [{ rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: "vo2max", intensity: "hard" }],
  });
  const supabase = createMockSupabase(state);

  const result = await runTeamTrainingDay({
    supabase, teamId: TEAM_ID, seasonId: SEASON_ID, seasonNumber: SEASON_NUMBER,
    executedBy: "manager", now: NOW,
  });

  const rr = result.report.riders[0];
  assert.ok(rr.gains.climbing >= 1, "climbing fik mindst +1");
  assert.ok(rr.gains_detail, "gains_detail tilstede");
  const jump = rr.gains_detail.climbing;
  assert.ok(jump, "climbing-spring tilstede");
  assert.equal(jump.from, 50, "from = pre-tick værdi");
  assert.equal(jump.to, 50 + rr.gains.climbing, "to = pre-tick + gevinst");
  // Evner uden gevinst er ikke i gains_detail.
  assert.equal(Object.keys(rr.gains_detail).length, Object.keys(rr.gains).filter((k) => rr.gains[k] > 0).length);
});
```

- [ ] **Step 2: Kør testen — verificér at den fejler**

Run: `cd backend && node --test lib/dailyTrainingEngine.test.js`
Expected: FAIL på `gains_detail tilstede` (feltet findes ikke endnu).

- [ ] **Step 3: Tilføj gains_detail i engine'en**

I `backend/lib/dailyTrainingEngine.js`, i tick-loopet før `reportRiders.push({...})` (efter blokken der bygger `abilityPatch`, ~linje 228), tilføj:

```js
    // Gennembruds-detalje (#1305 polish): faktisk tal-spring pr. gevinst, så
    // rapporten kan vise "71 → 72" frem for flad "+1". from = pre-tick, to = post-tick.
    const gainsDetail = {};
    if (tickResult) {
      for (const [ability, n] of Object.entries(tickResult.gains)) {
        if (n > 0) {
          gainsDetail[ability] = { from: abilities[ability] ?? 0, to: tickResult.abilities[ability] };
        }
      }
    }
```

Og tilføj feltet i `reportRiders.push({...})` (efter `gains: tickResult?.gains ?? {},`):

```js
      gains_detail: gainsDetail,
```

- [ ] **Step 4: Kør testen — verificér PASS + ingen regression**

Run: `cd backend && node --test lib/dailyTrainingEngine.test.js`
Expected: PASS (alle tests, inkl. den nye).

- [ ] **Step 5: Commit**

```bash
git add backend/lib/dailyTrainingEngine.js backend/lib/dailyTrainingEngine.test.js
git commit -F .git/COMMIT_MSG_T1
```
(commit-besked: `feat(training): berig daglig rapport med faktisk tal-spring pr. gevinst (#1305)`)

---

## Task 2: Frontend-helper — afled fokus-progress, gennembrud, dags-opsummering

**Files:**
- Create: `frontend/src/lib/trainingReport.js`
- Test: `frontend/src/lib/trainingReport.test.js`

- [ ] **Step 1: Skriv testen**

Create `frontend/src/lib/trainingReport.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  focusProgress, isBreakthrough, daySummary, breakthroughJumps,
  PEAK_FORM_THRESHOLD, NEAR_BREAKTHROUGH,
} from "./trainingReport.js";

test("focusProgress: vælger fokus-evnen tættest på gennembrud", () => {
  // vo2max = climbing/punch/tempo. tempo er højest → vælges.
  const res = focusProgress("vo2max", { climbing: 0.2, punch: 0.5, tempo: 0.91 });
  assert.deepEqual(res, { ability: "tempo", pct: 91 });
});

test("focusProgress: null uden fokus eller uden data", () => {
  assert.equal(focusProgress(null, { climbing: 0.5 }), null);
  assert.equal(focusProgress("vo2max", null), null);
  assert.equal(focusProgress("vo2max", { sprint: 0.5 }), null); // ingen vo2max-evne i mappet
});

test("focusProgress: clamps og afrunder", () => {
  assert.deepEqual(focusProgress("sprint", { sprint: 0.005, acceleration: 0 }), { ability: "sprint", pct: 1 });
});

test("isBreakthrough: sandt når mindst én gevinst > 0", () => {
  assert.equal(isBreakthrough({ gains: { climbing: 1 } }), true);
  assert.equal(isBreakthrough({ gains: { climbing: 0 } }), false);
  assert.equal(isBreakthrough({ gains: {} }), false);
  assert.equal(isBreakthrough({}), false);
});

test("daySummary: tæller trænede, gennembrud, topform", () => {
  const rows = [
    { intensity: "normal", injured: false, gains: { climbing: 1 }, form: 75 }, // trænet + gennembrud + topform
    { intensity: "rest", injured: false, gains: {}, form: 80 },                // ikke trænet (rest), topform
    { intensity: "hard", injured: true, gains: {}, form: 40 },                 // skadet → ikke trænet
    { intensity: "easy", injured: false, gains: { sprint: 0 }, form: 70 },     // trænet, topform (=70)
  ];
  assert.deepEqual(daySummary(rows), { trained: 2, breakthroughs: 1, peakForm: 3, total: 4 });
});

test("daySummary: tomt input", () => {
  assert.deepEqual(daySummary(null), { trained: 0, breakthroughs: 0, peakForm: 0, total: 0 });
});

test("breakthroughJumps: bruger gains_detail når til stede", () => {
  const jumps = breakthroughJumps({ gains: { climbing: 1 }, gains_detail: { climbing: { from: 71, to: 72 } } });
  assert.deepEqual(jumps, [{ ability: "climbing", n: 1, from: 71, to: 72 }]);
});

test("breakthroughJumps: fallback til null from/to uden gains_detail", () => {
  const jumps = breakthroughJumps({ gains: { sprint: 2 } });
  assert.deepEqual(jumps, [{ ability: "sprint", n: 2, from: null, to: null }]);
});

test("konstanter eksporteret", () => {
  assert.equal(PEAK_FORM_THRESHOLD, 70);
  assert.equal(NEAR_BREAKTHROUGH, 0.9);
});
```

- [ ] **Step 2: Kør testen — verificér at den fejler**

Run: `cd frontend && node --test src/lib/trainingReport.test.js`
Expected: FAIL (modulet findes ikke).

- [ ] **Step 3: Implementér helperen**

Create `frontend/src/lib/trainingReport.js`:

```js
// trainingReport.js — rene helpers til trænings-feedback-laget (#1305 polish, parent #1136).
//
// Afleder anticipation (progress mod næste +1) + payoff (gennembrud, dags-opsummering)
// fra useTraining-data. Ingen DB/React/Date — unit-testes isoleret med node --test.

import { TRAINING_FOCUS_ABILITIES } from "./training.js";

// Form-værdi (0-100) hvorved en rytter regnes "i topform" i dags-opsummeringen.
// Lille UI-konstant (form 50 = neutral start; ≥70 = mærkbart skarp). Påvirker KUN
// opsummerings-tallet, aldrig trænings-matematikken.
export const PEAK_FORM_THRESHOLD = 70;

// Progress-fraktion hvor baren skifter til success-farve ("tæt på gennembrud").
export const NEAR_BREAKTHROUGH = 0.9;

// Fokus-evnens vej mod næste +1. Blandt fokussets evner vælges den TÆTTEST på
// gennembrud (højeste progress) — det er anticipation-momentet spilleren skal se.
//   focus            : fokus-nøgle (vo2max/threshold/...) eller null
//   progressForRider : { [ability]: 0..1 } (ability_progress fra useTraining) eller null
// Returnerer { ability, pct } (pct = 0..100 afrundet) eller null hvis intet fokus
// eller ingen progress-data for fokussets evner.
export function focusProgress(focus, progressForRider) {
  if (!focus || !progressForRider) return null;
  const abilities = TRAINING_FOCUS_ABILITIES[focus];
  if (!abilities) return null;
  let best = null;
  for (const ability of abilities) {
    const raw = progressForRider[ability];
    if (raw == null) continue;
    const frac = Number(raw);
    if (!Number.isFinite(frac)) continue;
    if (best == null || frac > best.frac) best = { ability, frac };
  }
  if (best == null) return null;
  const clamped = Math.max(0, Math.min(0.999, best.frac));
  return { ability: best.ability, pct: Math.round(clamped * 100) };
}

// Et gennembrud = mindst én evne der steg (+1 eller mere) i dagens kørsel.
export function isBreakthrough(reportRow) {
  const gains = reportRow?.gains;
  if (!gains) return false;
  return Object.values(gains).some((n) => Number(n) > 0);
}

// Dags-opsummering på holdniveau fra rapportens rytter-rækker.
//   trained       = rækker med en aktiv (ikke-rest) session og ikke skadet
//   breakthroughs = antal rækker med mindst ét gennembrud
//   peakForm      = rækker med form ≥ PEAK_FORM_THRESHOLD
//   total         = antal rækker
export function daySummary(reportRiders) {
  const rows = reportRiders ?? [];
  let trained = 0;
  let breakthroughs = 0;
  let peakForm = 0;
  for (const row of rows) {
    if (!row.injured && row.intensity && row.intensity !== "rest") trained++;
    if (isBreakthrough(row)) breakthroughs++;
    if (Number(row.form) >= PEAK_FORM_THRESHOLD) peakForm++;
  }
  return { trained, breakthroughs, peakForm, total: rows.length };
}

// Gennembruds-spring pr. evne til visning "71 → 72". Bruger backend-berigelsen
// row.gains_detail = { [ability]: { from, to } } når den findes; ellers from/to=null
// så UI'et falder tilbage til "+n ability".
export function breakthroughJumps(reportRow) {
  const gains = reportRow?.gains ?? {};
  const detail = reportRow?.gains_detail ?? {};
  const out = [];
  for (const [ability, n] of Object.entries(gains)) {
    if (Number(n) <= 0) continue;
    const d = detail[ability];
    const from = d && Number.isFinite(Number(d.from)) ? Number(d.from) : null;
    const to = d && Number.isFinite(Number(d.to)) ? Number(d.to) : null;
    out.push({ ability, n: Number(n), from, to });
  }
  return out;
}
```

- [ ] **Step 4: Kør testen — verificér PASS**

Run: `cd frontend && node --test src/lib/trainingReport.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/trainingReport.js frontend/src/lib/trainingReport.test.js
git commit -F .git/COMMIT_MSG_T2
```
(`feat(training): rene helpers til progress/gennembrud/dags-opsummering (#1305)`)

---

## Task 3: Roster — progress-kolonne (anticipation)

**Files:**
- Modify: `frontend/src/pages/TrainingPage.jsx`

- [ ] **Step 1: Importér helperen + tilføj ProgressBar-komponent**

I `frontend/src/pages/TrainingPage.jsx`, opdatér import-blokken:

```js
import { TRAINING_FOCUS_KEYS, TRAINING_INTENSITIES, injuryDaysLeft } from "../lib/training.js";
import { focusProgress, daySummary, breakthroughJumps, isBreakthrough, NEAR_BREAKTHROUGH } from "../lib/trainingReport.js";
```

Tilføj under `MiniBar`-komponenten (efter linje 29):

```jsx
// Progress mod næste +1 for en fokus-evne. Baren bliver grøn ved NEAR_BREAKTHROUGH+.
// info = { ability, pct } fra focusProgress, eller null (tom-tilstand).
function FocusProgress({ info, emptyLabel, tRider, toGoLabel }) {
  if (!info) {
    return <span className="text-cz-3 text-xs">{emptyLabel}</span>;
  }
  const near = info.pct >= NEAR_BREAKTHROUGH * 100;
  const abilityLabel = tRider(`derived.${info.ability}`);
  return (
    <div className="min-w-[96px]" title={toGoLabel({ pct: 100 - info.pct, ability: abilityLabel })}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] text-cz-2 truncate">{abilityLabel}</span>
        <span className={`text-[10px] font-mono ${near ? "text-cz-success" : "text-cz-3"}`}>{info.pct}%</span>
      </div>
      <div className="h-1.5 bg-cz-subtle rounded-cz overflow-hidden">
        <div
          className={`h-full rounded-cz transition-all ${near ? "bg-cz-success" : "bg-cz-accent"}`}
          style={{ width: `${info.pct}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Træk progress fra useTraining**

I `TrainingPage`, udvid destructuring (linje 36-38) med `progress`:

```js
  const {
    enabled, todayRun, condition, progress, loading,
    savingId, running, setPlan, clearPlan, planFor, runToday,
  } = training;
```

- [ ] **Step 3: Tilføj kolonne-header i roster-bordet**

I roster-`<thead>` (efter Intensity-header, ~linje 138), indsæt:

```jsx
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">
                    {t("colNextUp")}
                  </th>
```

- [ ] **Step 4: Tilføj progress-celle i roster-rækken**

I roster-`<tbody>`-rækken, lige efter Intensitet-`<td>` (efter linje 226, før Form-`<td>`), indsæt:

```jsx
                      {/* Progress mod næste +1 (anticipation) */}
                      <td className="px-4 py-3">
                        <FocusProgress
                          info={focusProgress(plan?.focus, progress[rider.id])}
                          emptyLabel={t("noFocus")}
                          tRider={tRider}
                          toGoLabel={(o) => t("toGo", o)}
                        />
                      </td>
```

- [ ] **Step 5: Verificér build + lint**

Run: `cd frontend && node --test src/lib/trainingReport.test.js && cd .. && npm run build --prefix frontend`
Expected: tests PASS, build OK (kommer fuldt i Task 6; her bare hurtig røgtest at JSX parser).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/TrainingPage.jsx
git commit -F .git/COMMIT_MSG_T3
```
(`feat(training): progress-kolonne mod næste +1 i roster (#1305)`)

---

## Task 4: Rapport — opsummerings-stribe + progress + gennembrud + Result-kolonne

**Files:**
- Modify: `frontend/src/pages/TrainingPage.jsx` (rapport-blokken, ~linje 264-344)

- [ ] **Step 1: Dags-opsummerings-stribe + konvertér rounded-xl → rounded-cz**

Erstat rapport-container-åbningen (linje 265-274) med:

```jsx
      {todayRun?.report && (() => {
        const summary = daySummary(todayRun.report.riders);
        return (
        <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
          <div className="px-5 py-4 border-b border-cz-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-cz-1">{t("report")}</h2>
            {todayRun.bonus_applied && (
              <span className="text-xs px-2 py-0.5 rounded-cz bg-cz-accent/10 text-cz-accent border border-cz-accent/30">
                {t("bonusApplied")}
              </span>
            )}
          </div>
          {/* Dags-opsummering (payoff, holdniveau) */}
          <div className="grid grid-cols-3 divide-x divide-cz-border border-b border-cz-border">
            <div className="px-5 py-3">
              <div className="text-lg font-bold text-cz-1">{summary.trained}<span className="text-cz-3 text-sm font-normal"> / {summary.total}</span></div>
              <div className="text-[11px] uppercase tracking-wide text-cz-3">{t("summaryTrained")}</div>
            </div>
            <div className="px-5 py-3">
              <div className={`text-lg font-bold ${summary.breakthroughs > 0 ? "text-cz-success" : "text-cz-1"}`}>{summary.breakthroughs}</div>
              <div className="text-[11px] uppercase tracking-wide text-cz-3">{t("summaryBreakthroughs")}</div>
            </div>
            <div className="px-5 py-3">
              <div className="text-lg font-bold text-cz-1">{summary.peakForm}</div>
              <div className="text-[11px] uppercase tracking-wide text-cz-3">{t("summaryPeakForm")}</div>
            </div>
          </div>
```

> NB: dette åbner en IIFE `(() => { ... return (<div>...`. Den lukkes i Step 5 — luk roster-container-`</div>` forbliver uændret; KUN rapport-blokken pakkes.

- [ ] **Step 2: Opdatér rapport-tabellens header — fjern Score, tilføj Progress, omdøb til Result**

Erstat rapport-`<thead>` (linje 277-287) med:

```jsx
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colRider")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{tRider("training.focus")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{tRider("training.intensity")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colNextUp")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colGains")}</th>
                  <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("colResult")}</th>
                </tr>
              </thead>
```

- [ ] **Step 3: Omskriv rapport-rækken — gennembruds-styling, progress, gains-spring, Result**

Erstat rapport-`<tbody>` (linje 288-340) med:

```jsx
              <tbody>
                {(todayRun.report.riders ?? []).map((row) => {
                  const jumps = breakthroughJumps(row);
                  const breakthrough = isBreakthrough(row);
                  const fatigueDelta = row.fatigue_delta ?? 0;
                  const prog = focusProgress(row.focus, progress[row.rider_id]);
                  const fatigueSign = fatigueDelta > 0 ? "+" : "";
                  return (
                    <tr
                      key={row.rider_id}
                      className={`border-b border-cz-border last:border-0 hover:bg-cz-subtle ${breakthrough ? "bg-cz-success-bg border-l-2 border-l-cz-success" : ""}`}
                    >
                      <td className="px-4 py-2.5">
                        <RiderLink id={row.rider_id} className="text-cz-1 font-medium hover:text-cz-accent transition-colors">
                          {row.name}
                        </RiderLink>
                        {row.injured && (
                          <span className="ms-2 text-[10px] px-1.5 py-0.5 rounded-cz bg-cz-danger/10 text-cz-danger">
                            {row.injury_days === 1
                              ? t("injured", { days: row.injury_days })
                              : t("injured_plural", { days: row.injury_days })}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-cz-2">
                        {row.focus ? tRider(`training.focus_${row.focus}`) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-cz-2">
                        {row.intensity ? tRider(`training.intensity_${row.intensity}`) : "—"}
                      </td>
                      {/* Progress mod næste +1 (anticipation efter kørsel) */}
                      <td className="px-4 py-2.5">
                        <FocusProgress
                          info={prog}
                          emptyLabel={t("noFocus")}
                          tRider={tRider}
                          toGoLabel={(o) => t("toGo", o)}
                        />
                      </td>
                      {/* Gevinster — gennembrud vist som faktisk tal-spring */}
                      <td className="px-4 py-2.5">
                        {jumps.length > 0 ? (
                          <span className="text-cz-success text-xs font-medium">
                            {jumps.map((j) => (
                              j.from != null && j.to != null
                                ? t("gainJump", { from: j.from, to: j.to, ability: tRider(`derived.${j.ability}`) })
                                : t("gains", { n: j.n, ability: tRider(`derived.${j.ability}`) })
                            )).join(", ")}
                          </span>
                        ) : (
                          <span className="text-cz-3 text-xs">{t("noGains")}</span>
                        )}
                      </td>
                      {/* Result — dagsform + trætheds-delta (erstatter rå score) */}
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-0.5">
                          {row.status === "over" && (
                            <span className="text-cz-success text-xs">{t("sharpDay")}</span>
                          )}
                          {row.status === "under" && (
                            <span className="text-cz-danger text-xs">{t("flatDay")}</span>
                          )}
                          <span className={`text-[11px] font-mono ${fatigueDelta > 0 ? "text-orange-400" : fatigueDelta < 0 ? "text-cz-success" : "text-cz-3"}`}>
                            {t("fatigueChange", { delta: `${fatigueSign}${fatigueDelta}` })}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
```

- [ ] **Step 4: Luk IIFE'en**

Erstat rapport-blokkens afslutning (linje 341-344, `</table></div></div>` + `)}`) med:

```jsx
            </table>
          </div>
        </div>
        );
      })()}
```

- [ ] **Step 5: Verificér build + ui-slop**

Run: `npm run build --prefix frontend && npm run lint:ui-slop`
Expected: build OK; ui-slop "ingen nye overtraedelser" + info-linje om at TrainingPage-baseline (slop 2→0) kan strammes.

- [ ] **Step 6: Stram ui-slop-baseline (rounded-xl fjernet)**

Run: `npm run check:ui-slop-baseline` (regenererer baseline; TrainingPage-slop går 2→0).
Verificér diff: `git diff scripts/ui-slop-baseline.json` — kun TrainingPage skrumper.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/TrainingPage.jsx scripts/ui-slop-baseline.json
git commit -F .git/COMMIT_MSG_T4
```
(`feat(training): dags-opsummering + progress + gennembruds-payoff i rapport, fjern rå score (#1305)`)

---

## Task 5: i18n (en+da) + help.json + patch notes

**Files:**
- Modify: `frontend/public/locales/en/training.json`, `frontend/public/locales/da/training.json`
- Modify: `frontend/public/locales/en/help.json`, `frontend/public/locales/da/help.json`
- Modify: `frontend/src/pages/PatchNotesPage.jsx`

- [ ] **Step 1: training.json (en)** — tilføj nye keys, fjern `colScore`, omdøb status-copy

I `frontend/public/locales/en/training.json`: fjern `"colScore": "Score",`. Tilføj/ændr:

```json
  "colNextUp": "Next +1",
  "colResult": "Result",
  "noFocus": "No focus set",
  "toGo": "{{pct}}% to next +1 in {{ability}}",
  "gainJump": "{{from}} → {{to}} {{ability}}",
  "summaryTrained": "Riders trained",
  "summaryBreakthroughs": "Breakthroughs",
  "summaryPeakForm": "In peak form",
  "sharpDay": "▲ Sharp day",
  "flatDay": "▼ Flat day",
  "fatigueChange": "{{delta}} fatigue"
```

Behold `overperformed`/`underperformed` (kan stadig bruges andetsteds? Verificér: `grep -rn "overperformed\|underperformed" frontend/src`. Hvis kun TrainingPage brugte dem → fjern begge keys i en+da. Ellers behold.)

- [ ] **Step 2: training.json (da)** — samme keys, dansk

```json
  "colNextUp": "Næste +1",
  "colResult": "Resultat",
  "noFocus": "Intet fokus valgt",
  "toGo": "{{pct}}% til næste +1 i {{ability}}",
  "gainJump": "{{from}} → {{to}} {{ability}}",
  "summaryTrained": "Ryttere trænet",
  "summaryBreakthroughs": "Gennembrud",
  "summaryPeakForm": "I topform",
  "sharpDay": "▲ Skarp dag",
  "flatDay": "▼ Flad dag",
  "fatigueChange": "{{delta}} træthed"
```

Fjern `"colScore": "Score",` i da også.

- [ ] **Step 3: help.json (en+da)** — tilføj entry om rapport-aflæsning

I `dailytraining`-sektionen (begge sprog), tilføj en entry der forklarer dags-opsummering + progress mod næste +1 + gennembrud i rapporten. EN-eksempel:

```json
   "readingReport": {
    "title": "Reading the training report",
    "text": "After training runs, the report opens with a day summary: how many riders trained, how many had a breakthrough (an ability rose +1), and how many are in peak form. Each row shows the focus ability's progress toward its next +1, and a breakthrough is highlighted with the actual jump, for example 71 → 72. The roster table shows the same progress bar so you can steer a focus toward a rider who is close to a breakthrough."
   }
```

DA:

```json
   "readingReport": {
    "title": "Sådan læser du træningsrapporten",
    "text": "Når træningen er kørt, åbner rapporten med en dags-opsummering: hvor mange ryttere der trænede, hvor mange der fik et gennembrud (en evne steg +1), og hvor mange der er i topform. Hver række viser fokus-evnens vej mod næste +1, og et gennembrud fremhæves med det faktiske spring, for eksempel 71 → 72. Rosterbordet viser den samme progress-bar, så du kan styre et fokus mod en rytter tæt på et gennembrud."
   }
```

- [ ] **Step 4: Patch notes** — ny entry øverst i `PatchNotesPage.jsx`

Find versions-arrayet (øverst, `version: "5.57"` er nyeste). Tilføj en NY entry FØR 5.57 med version `"5.58"`, samme dato-format som de andre. Indhold (player-facing, EN+DA hvis strukturen er tosproget — følg nabo-entries' form):
- Titel: "Training report polish"
- Punkter: day summary (trained / breakthroughs / in peak form); progress toward next +1 in roster + report; breakthroughs now show the actual jump (e.g. 71 → 72); raw score removed.

- [ ] **Step 5: Verificér i18n + patch notes**

Run: `npm run check:i18n && npm run check:patchnotes`
Expected: begge PASS (ingen manglende/ekstra keys mellem en/da; ingen em-dash; patch-version bumpet).

- [ ] **Step 6: Commit**

```bash
git add frontend/public/locales/en/training.json frontend/public/locales/da/training.json frontend/public/locales/en/help.json frontend/public/locales/da/help.json frontend/src/pages/PatchNotesPage.jsx
git commit -F .git/COMMIT_MSG_T5
```
(`feat(training): i18n + help + patch notes for trænings-rapport-polish (#1305)`)

---

## Task 6: Playwright snapshot-refresh + fuld CI-gate

**Files:**
- Modify: `frontend/tests/**` snapshots (genereret)

- [ ] **Step 1: Kør hele lokal-verifikation**

Run: `pwsh -File scripts/verify-local.ps1`
Expected: backend-tests + frontend-tests + frontend-build PASS.

- [ ] **Step 2: Kør fuld CI-gate-sæt**

Run: `npm run lint && npm run check:i18n && npm run check:warnings && npm run lint:ui-slop && npm run check:patchnotes`
Expected: alle PASS. (eslint-warning-budget må ikke stige.)

- [ ] **Step 3: Refresh core-smoke snapshots (alle 3 projekter, win32)**

Run: `cd frontend && npx playwright test core-smoke --update-snapshots`
(uden `--project` → kører desktop-chromium + mobile-chromium + mobile-webkit)
Expected: snapshots opdateret hvis træningssiden indgår; commit PNG'erne.

- [ ] **Step 4: Kør core-smoke uden update — verificér grøn**

Run: `cd frontend && npx playwright test core-smoke`
Expected: PASS på alle 3 projekter.

- [ ] **Step 5: Commit snapshots (hvis ændret)**

```bash
git add frontend/tests
git commit -F .git/COMMIT_MSG_T6
```
(`test(training): refresh core-smoke snapshots for rapport-polish (#1305)`)

---

## Self-Review-tjek (kør efter alle tasks)

1. **Spec-dækning:** §3.1 dags-opsummering (Task 4 Step 1) ✓ · §3.2 roster-progress + ~90%-farve + tom-tilstand (Task 3) ✓ · §3.3 progress i rapport (Task 4 Step 3) ✓ · §3.4 gennembrud-tint+accent+tal-spring (Task 1 + Task 4 Step 3) ✓ · §3.5 Result erstatter score (Task 4 Step 2-3) ✓.
2. **Anti-slop:** rounded-cz overalt, ingen glow/emoji/gradient/animation; ui-slop ratchet strammet (Task 4 Step 6). ▲/▼ bevaret som tekst-tells, ikke emoji-ikon.
3. **Type-konsistens:** `focusProgress`→`{ability,pct}`; `breakthroughJumps`→`[{ability,n,from,to}]`; `daySummary`→`{trained,breakthroughs,peakForm,total}`. Backend `gains_detail[ability]={from,to}`.
4. **Fallback:** gamle todayRun uden `gains_detail` → `breakthroughJumps` giver from/to=null → UI viser "+n ability" (Task 2 test dækker).
```
