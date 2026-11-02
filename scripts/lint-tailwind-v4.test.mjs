import test from 'node:test';
import assert from 'node:assert/strict';
import { lintClasses } from './lint-tailwind-v4.mjs';

test('legacy utilities in JSX, variants and helpers fail', () => {
  for (const utility of ['shadow', 'blur', 'outline-none', 'ring', 'bg-opacity-50', 'flex-shrink-0', 'flex-grow', 'overflow-ellipsis', 'decoration-slice']) {
    assert.ok(lintClasses(`<div className="md:hover:${utility}" />`).length, utility);
    assert.ok(lintClasses(`const x = clsx("${utility}")`).length, utility);
  }
});
test('dynamic construction, references and conditional branches are inspected', () => {
  for (const source of ['const c = "ri" + "ng"; const View = <div className={c} />;', 'const View = <div className={`bg-opacity-${opacity}`} />;', 'const View = <div className={`shadow${small ? "" : "-lg"}`} />;', 'const classes = { "ring": enabled };', 'el.classList.add("blur")']) {
    assert.ok(lintClasses(source).length, source);
  }
});
test('prose, events, comments, arbitrary values and modern classes are not classes', () => {
  assert.deepEqual(lintClasses('const text = "a shadow ring blur rounded"; window.addEventListener("blur", h); const v = <div title="rounded" className="shadow-md rounded-md blur-md ring-2 outline-hidden bg-black/50 shrink-0 [content:\'ring\']" />; // className="ring"'), []);
});
test('syntax errors fail closed', () => assert.throws(() => lintClasses('const = !')));
test('arrays, class maps and DOM assignment preserve class context', () => {
  for (const source of ['const x = <div className={["ring", active && "block"].join(" ")} />', 'const styles = { badge: "ring" }; const x = <div className={styles.badge} />', 'node.className = "shadow"', 'node.setAttribute("class", "blur")']) assert.ok(lintClasses(source).length, source);
});
test('shadowed bindings and function arguments do not turn prose into classes', () => {
  assert.deepEqual(lintClasses('const value = "ring"; function View(value) { return <div className={value} /> } const x = <div className={translate("ring")} />'), []);
});

test('finite joins, computed keys and spread helpers cannot hide classes', () => {
  for (const source of [
    'const x = <div className={["ri", "ng"].join("")} />',
    'const x = <div className={[flag ? "ri" : "bl", flag ? "ng" : "ur"].join("")} />',
    'const style = {soft:"ring"}; const mode="soft"; const x=<div className={style[mode]} />',
    'const tokens=["ring"]; clsx(...tokens)',
  ]) assert.ok(lintClasses(source).some(f => f.token === 'ring'), source);
  assert.deepEqual(lintClasses('const x=<div className={["ri","ng"].join(" ")} />'), []);
});
test('helper config selectors and truthiness values are not emitted class tokens', () => {
  for (const source of [
    'clsx({block:"ring", ring:false})',
    'cn({block:"ring"})',
    'classnames({block:"ring"})',
    'cva("block", {variants:{ring:{true:"border-2",false:"border-0"}}, defaultVariants:{ring:true}})',
  ]) assert.deepEqual(lintClasses(source), [], source);
  for (const source of [
    'clsx({ring:true})',
    'cva("block", {variants:{size:{soft:"ring"}}})',
    'cva("block", {compoundVariants:[{size:"soft",class:"ring"}]})',
  ]) assert.ok(lintClasses(source).length, source);
});
test('configured radius compatibility is verified against actual compiled CSS', async () => {
  const { createRequire } = await import('node:module');
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const require = createRequire(new URL('../frontend/package.json', import.meta.url));
  const { compile } = require('@tailwindcss/node');
  const css = readFileSync(new URL('../frontend/src/index.css', import.meta.url), 'utf8');
  const compiler = await compile(css, {base:fileURLToPath(new URL('../frontend/src/', import.meta.url)), onDependency() {}});
  const output = compiler.build(['rounded', 'rounded-sm', 'rounded-xs', 'rounded-cz']);
  assert.match(output, /\.rounded\s*\{\s*border-radius:\s*0?\.25rem;/);
  assert.match(output, /\.rounded-sm\s*\{\s*border-radius:\s*0?\.125rem;/);
  assert.doesNotMatch(output, /\.rounded-xs\s*\{/);
  assert.match(output, /\.rounded-cz\s*\{\s*border-radius:\s*var\(--radius-sm\);/);
  assert.deepEqual(lintClasses('<div className="rounded rounded-sm rounded-cz" />'), []);
  assert.ok(lintClasses('<div className="rounded" />', undefined, {css:'@theme { --radius-sm: 0.25rem; }'}).length);
});

test('finite expansion stays bounded and cyclic bindings terminate', () => {
  const branches = Array.from({length:9}, () => 'flag ? "ri" : "ng"').join(',');
  assert.throws(() => lintClasses(`const x=<div className={[${branches}].join("")} />`), /expansion budget/);
  assert.deepEqual(lintClasses('const tokens=[...tokens]; clsx(...tokens); const x=<div className={tokens.join("")} />'), []);
  assert.ok(lintClasses('const first=["ri"]; const second=[...first,"ng"]; const sep=""; const x=<div className={second.join(sep)} />').length);
});
