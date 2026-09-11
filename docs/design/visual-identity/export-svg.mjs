// node export-svg.mjs — regenerates svg/ from cz-portrait.js (no deps)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const src = readFileSync(new URL('./cz-portrait.js', import.meta.url), 'utf8');
const win = {};
new Function('window', 'customElements', 'HTMLElement', src)(win, { get: () => true, define() {} }, class {});
const P = win.czPortrait, A = win.czAsset;
const strip = (s) => s.replace(' style="display:block;width:100%;height:auto"', '');
const files = {
  'rider-front-neutral.svg': P('hybrid', { mood: 'neutral' }),
  'rider-front-high.svg': P('hybrid', { mood: 'happy' }),
  'rider-front-low.svg': P('hybrid', { mood: 'down' }),
  'rider-tq-neutral.svg': P('hybrid', { view: 'tq' }),
  'rider-helmet-a-aero.svg': P('hybrid', { helmet: true, helmetStyle: 'a' }),
  'rider-helmet-b-vented.svg': P('hybrid', { helmet: true, helmetStyle: 'b' }),
  'rider-helmet-c-halved.svg': P('hybrid', { helmet: true, helmetStyle: 'c' }),
  'rider-helmet-d-minimal.svg': P('hybrid', { helmet: true, helmetStyle: 'd' }),
  'helmet-side.svg': A('helmet', 1.4),
  'jersey-flat-front.svg': A('jersey', 1.4),
  'jersey-mini-16.svg': A('jersey', 0),
};
mkdirSync(new URL('./svg/', import.meta.url), { recursive: true });
for (const [name, svg] of Object.entries(files)) writeFileSync(new URL('./svg/' + name, import.meta.url), strip(svg));
console.log(Object.keys(files).length + ' svg files written');
