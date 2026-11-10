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
  fatigue: 'Fatigue', form: 'Form', today: { fatigueAtStart: '{{now}} now, approx. {{value}} at start' },
} } } });

const render = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(I18nextProvider, { i18n },
  createElement(TrainingMobileRiderCard, { id: 'rider-card', name: 'Rider A', meta: '', form: 50, fatigue: 12,
    dayLabel: '', receiptRows: null, countsFor: [], roleLabel: null, pacePerWeek: null, seasonPoints: null,
    onChangeDay: () => {}, ...extra } as never)));

test('#7801 phone card shows current fatigue and the existing next-start line', () => {
  const html = render({ fatigueAtStart: 18 });
  assert.match(html, /data-testid="fatigue-at-start"/);
  assert.match(html, /12 now, approx\. 18 at start/);
  assert.match(html, />12<\/div>/, 'current condition remains visible');
});

test('#7801 zero is a valid next-start forecast', () => {
  assert.match(render({ fatigueAtStart: 0 }), /12 now, approx\. 0 at start/);
});

test('#7801 missing/null forecast preserves the flag-off card output', () => {
  const baseline = render();
  assert.doesNotMatch(baseline, /fatigue-at-start/);
  assert.equal(render({ fatigueAtStart: null }), baseline);
  assert.equal(render({ fatigueAtStart: undefined }), baseline);
  assert.equal(render({ fatigueAtStart: NaN }), baseline);
  assert.equal(render({ fatigueAtStart: Infinity }), baseline);
});

test('#7801 only the phone card receives the existing condition next-stage estimate', () => {
  const page = readFileSync(new URL('../../../pages/TrainingPage.jsx', import.meta.url), 'utf8');
  assert.ok(/fatigueAtStart=\{phoneTodayView \? cond\.fatigue_at_start \?\? null : null\}/.test(page),
    'phone call site must forward fatigue_at_start without dropping zero or changing desktop expansion');
});
