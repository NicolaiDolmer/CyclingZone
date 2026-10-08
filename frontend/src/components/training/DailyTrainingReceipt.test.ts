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
