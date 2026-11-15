// #8089 · DOMMERENS PRØVER (AGENTS regel 40) · motoren: en ny rytters form falder ikke dag 1 til 3.
//
// OFFENTLIG UDGAVE til repoet (backend/lib/). Den indeholder ingen målte kurver og
// ingen af motorens tærskler: prøverne kører spillets rigtige opgørelse og kræver kun
// retningen (falder ikke / stiger). Dommerens private udgave med facit-kurver bliver
// hos dommeren. Byggeren må rette stien til repo-roden, men ALDRIG et forventet udfald.
//
// Motoren køres som i prod: form og træthed 2.0 og træningsdøgn på løbsdatoer tændt.
// Kørsel i repoet:  node --test lib/nyRytterFormkurve8089.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ROOT = process.env.CZ_REPO_ROOT
  ? pathToFileURL(resolve(process.env.CZ_REPO_ROOT) + '/')
  : new URL('../../', import.meta.url);
const lib = (name) => new URL(`backend/lib/${name}`, ROOT);

// ── Ejerens tal (samme som databaseprøven) ───────────────────────────────────
const START_FORM = 50;
const START_FATIGUE = 20;

const r1 = (x) => Math.round(Number(x) * 10) / 10; // #8113: afrund før sammenligning
const day = (i) => [i, i, i, i, i];                  // en dato har fem felter
const WEEKS = {
  normal: () => day('normal'),
  hård: () => day('hard'),
  blandet: (d) => [day('hard'), day('normal'), day('normal'), day('easy'), day('hard'), day('normal'), day('rest')][d % 7],
};
// Restitutionsevne fra lav til høj. Nye ryttere ligger lavt.
const RECOVERY = [0, 6, 15, 35, 60];

async function startCondition() {
  const mod = await import(lib('riderCondition.js').href);
  assert.ok(mod.NEW_RIDER_START_CONDITION, 'riderCondition.js eksporterer ikke NEW_RIDER_START_CONDITION (fælles starttilstand for en ny rytter)');
  return mod.NEW_RIDER_START_CONDITION;
}

/** En rytters første `days` datoer uden løb, med spillets rigtige opgørelse. Kun formen returneres. */
async function formCurve({ start, week, recoveryAbility, days = 7 }) {
  const { settleTrainingDateCondition } = await import(lib('trainingDateCondition.js').href);
  let cond = { form: start.form, fatigue: start.fatigue };
  const form = [];
  for (let d = 0; d < days; d++) {
    const out = settleTrainingDateCondition({
      riderId: 'proeve-8089', dateStr: `2026-11-${String(14 + d).padStart(2, '0')}`, condition: cond,
      intensities: WEEKS[week](d), raceLoads: [0, 0, 0, 0, 0], recoveryAbility,
      modelV2: true, medicalBonus: 0, raceDateTrainingDay: true,
    });
    cond = { form: out.form, fatigue: out.fatigue };
    form.push(r1(out.form));
  }
  return form;
}

// ── R2: tallet ───────────────────────────────────────────────────────────────
test('R2 koden har én fælles starttilstand for en ny rytter: form 50, træthed 20', async () => {
  const start = await startCondition();
  assert.deepEqual({ form: r1(start.form), fatigue: r1(start.fatigue) }, { form: START_FORM, fatigue: START_FATIGUE });
  assert.ok(Object.isFrozen(start), 'starttilstanden skal være frosset (ét tal, ét sted)');
});

// ── R5: formen falder ikke dag 1 til 3 ved normal træning ────────────────────
// Fejlbeskederne nævner kun dagen, aldrig kurven (CI-loggen er offentlig).
for (const week of ['normal', 'hård', 'blandet']) {
  for (const recoveryAbility of RECOVERY) {
    test(`R5 ny rytter, ${week} træning, restitutionsevne ${recoveryAbility}: formen er aldrig lavere end dagen før på dag 1 til 3`, async () => {
      const start = await startCondition();
      const form = await formCurve({ start, week, recoveryAbility });
      const withStart = [r1(start.form), ...form];
      for (let d = 1; d <= 3; d++) {
        assert.ok(withStart[d] >= withStart[d - 1], `dag ${d}: formen er lavere end dagen før`);
      }
      assert.ok(form[2] >= START_FORM, 'dag 3: formen er under startformen');
    });
  }
}

test('R5 typisk ny rytter (lav restitutionsevne) på normal træning: formen stiger inden for den første uge', async () => {
  const start = await startCondition();
  const form = await formCurve({ start, week: 'normal', recoveryAbility: 6 });
  assert.ok(form[6] > START_FORM, 'dag 7: formen er ikke over startformen');
});

test('R5 ny rytter på hård træning: formen stiger fra første dag', async () => {
  const start = await startCondition();
  for (const recoveryAbility of RECOVERY) {
    const form = await formCurve({ start, week: 'hård', recoveryAbility });
    assert.ok(form[0] > START_FORM, `restitutionsevne ${recoveryAbility}, dag 1: formen er ikke steget`);
  }
});

// ── Kontrol: sådan var det før rettelsen (viser at prøven kan skelne) ────────
test('kontrol: fra træthed 0 (som før rettelsen) falder formen hver dag på dag 1 til 3 på normal træning', async () => {
  for (const recoveryAbility of RECOVERY) {
    const form = [START_FORM, ...await formCurve({ start: { form: START_FORM, fatigue: 0 }, week: 'normal', recoveryAbility })];
    for (let d = 1; d <= 3; d++) assert.ok(form[d] < form[d - 1], `restitutionsevne ${recoveryAbility}, dag ${d}: formen faldt ikke`);
  }
});

// ── Teknisk værn (ikke en ejer-regel): reservestederne i koden følger samme tal ──
// To steder, spilleren kan mærke, antog form 50 og træthed 0, hvis rytteren mangler
// en tilstand. De rammes sjældent (databasen opretter tilstanden), men må ikke kunne
// give eller vise en ny rytter den gamle start ad en bagdør.
test('værn: træthedsprognosen for en rytter uden tilstand regner fra starttilstanden, ikke fra 0', async () => {
  const start = await startCondition();
  const { buildTeamFatigueForecast } = await import(lib('trainingWeekPlanForecast.js').href);
  const base = {
    tickDate: '2026-11-14', seasonId: 'saeson', dateGameDays: [61, 62, 63, 64, 65],
    riders: [{ id: 'ny', primary_type: 'climber' }], recoveryByRider: new Map([['ny', 6]]),
    conditionModelV2: true, raceDateTrainingDay: true,
  };
  const forecast = (conditionByRider) => buildTeamFatigueForecast({ ...base, conditionByRider }).ny?.fatigue;
  const missing = forecast(new Map());
  const fromStart = forecast(new Map([['ny', { form: start.form, fatigue: start.fatigue }]]));
  const fromZero = forecast(new Map([['ny', { form: START_FORM, fatigue: 0 }]]));
  assert.ok(r1(fromStart) !== r1(fromZero), 'prøven kan ikke skelne de to starter');
  assert.ok(r1(missing) === r1(fromStart), 'prognosen for en rytter uden tilstand følger ikke starttilstanden');
});

const OLD_FALLBACK = /\{\s*(?:form:\s*50\s*,\s*fatigue:\s*0(?!\d)|fatigue:\s*0\s*,\s*form:\s*50(?!\d))/;
for (const file of ['dailyTrainingEngine.js', 'trainingWeekPlanForecast.js']) {
  test(`værn: ${file} har ikke længere sin egen "form 50, træthed 0" som reserve`, async () => {
    const source = await readFile(lib(file), 'utf8');
    const hit = source.split(/\r?\n/).findIndex((line) => OLD_FALLBACK.test(line));
    assert.equal(hit, -1, `${file}:${hit + 1} har stadig den gamle reserve`);
  });
}
