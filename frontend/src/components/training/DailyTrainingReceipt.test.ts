import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { transformSync } from 'rolldown/utils';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

const loader = registerHooks({ load(url, context, nextLoad) {
  if (url.startsWith('file:') && /\.(tsx|jsx)$/.test(url)) return {
    format: 'module', shortCircuit: true,
    source: transformSync(new URL(url).pathname, readFileSync(new URL(url), 'utf8'), {
      lang: url.endsWith('.tsx') ? 'tsx' : 'jsx', jsx: { runtime: 'automatic' }, define: { 'import.meta.env.DEV': 'false' },
    }).code,
  };
  return nextLoad(url, context);
} });
const { default: DailyTrainingReceipt } = await import('./DailyTrainingReceipt.tsx');
loader.deregister();
const i18n = createInstance();
await i18n.init({ lng:'en', initAsync:false, resources:{en:{training:{},rider:{}}}, fallbackLng:false });

for (const gameDays of [undefined, null, {}]) {
  test(`#6314 receipt renders an unknown day count for ${JSON.stringify(gameDays)}`, () => {
    const run = { tick_date:'2026-10-07', receipt_status:'pending', game_days:gameDays,
      trained_now_slots:[], expected_game_days:null, report:{riders:[],condition_settled:false} };
    const html = renderToStaticMarkup(createElement(I18nextProvider,{i18n},
      createElement(DailyTrainingReceipt,{run:run as never})));
    assert.match(html,/data-testid="daily-training-receipt"/);
    assert.match(html,/data-status="pending"/);
    assert.match(html,/—/);
  });
}

const rider = (rider_id: string, name: string, gains: Record<string, number>, gain_percent: Record<string, number | null>) => ({
  rider_id, name, activities:[], receipt_status:'complete', gains, gains_detail:{}, gain_percent,
  fatigue_before:10, fatigue:12, form_before:50, form:51, progress_before:{}, trained_now:null,
});
const settled = { tick_date:'2026-11-06', receipt_status:'complete', game_days:[0], trained_now_slots:[], expected_game_days:null,
  report:{ condition_settled:true, riders:[
    rider('r1','Ada Pedersen',{positioning:1,climbing:1},{positioning:110,climbing:104,flat:3}),
    rider('r2','Bo Holm',{},{tempo:40,climbing:12}),
    rider('r3','Cai Berg',{},{}),
  ]}};
const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(I18nextProvider,{i18n},
  createElement(DailyTrainingReceipt,props as never)));

test('#7745 whole points lead in profile order, riders without one fold together', () => {
  const html = render({ run:settled });
  const whole = html.slice(html.indexOf('data-testid="daily-receipt-whole-points"'));
  assert.ok(whole.indexOf('racePreview.derived.climbing') < whole.indexOf('racePreview.derived.positioning'), '#7746 climbing before positioning');
  assert.match(html,/Ada Pedersen/);
  assert.match(html,/data-testid="daily-receipt-quiet-toggle"/);
  assert.match(html,/aria-expanded="false" aria-controls="receipt-2026-11-06-legacy-no-whole-point"/);
  assert.doesNotMatch(html,/Bo Holm|Cai Berg/, 'riders without a whole point are folded');
  assert.doesNotMatch(html,/\+40%|\+12%/, 'progress toward the next point never sits on the summary line');
});

test('#7745 a folded date still says how many whole points it landed', () => {
  const html = render({ run:settled, defaultExpanded:false });
  assert.match(html,/data-testid="daily-receipt-points-meta"/);
  assert.match(html,/data-testid="daily-receipt-status"/);
});

test('#7745 a date whose development is not known yet folds nobody away', () => {
  const html = render({ run:{ ...settled, receipt_status:'pending',
    report:{ ...settled.report, riders:settled.report.riders.map(row=>({ ...row, receipt_status:'pending' })) } } });
  assert.doesNotMatch(html,/daily-receipt-quiet-group/);
  assert.match(html,/Bo Holm/);
  assert.doesNotMatch(html,/daily-receipt-points-meta/);
});
