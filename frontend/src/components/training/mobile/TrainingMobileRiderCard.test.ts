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
const { default: TrainingMobileRiderCard } = await import('./TrainingMobileRiderCard.tsx');
loader.deregister();
const i18n = createInstance();
await i18n.init({ lng: 'en', initAsync: false, fallbackLng: false, resources: { en: { training: {
  fatigue: 'Fatigue', form: 'Form',
} } } });

const render = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(I18nextProvider, { i18n },
  createElement(TrainingMobileRiderCard, { id: 'rider-card', name: 'Rider A', meta: '', form: 50, fatigue: 12,
    dayLabel: '', receiptRows: null, countsFor: [], roleLabel: null, pacePerWeek: null, seasonPoints: null,
    onChangeDay: () => {}, ...extra } as never)));

test('#7801 phone card shows only the current fatigue number, no next-start line', () => {
  const html = render({ fatigueAtStart: 18 });
  assert.doesNotMatch(html, /fatigue-at-start/);
  assert.doesNotMatch(html, /at start/);
  assert.match(html, />12<\/div>/, 'current condition remains visible');
});

test('#7801 a missing fatigue number stays a dash', () => {
  assert.match(render({ fatigue: null }), />\u2014<\/div>/);
});

test('#7801 the training page no longer forwards a next-start estimate', () => {
  const page = readFileSync(new URL('../../../pages/TrainingPage.jsx', import.meta.url), 'utf8');
  assert.ok(!/fatigueAtStart/.test(page), 'no next-start estimate is shown on the training page');
});
