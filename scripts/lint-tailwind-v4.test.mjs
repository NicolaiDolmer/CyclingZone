import test from 'node:test';
import assert from 'node:assert/strict';
import { lintClasses } from './lint-tailwind-v4.mjs';

test('legacy utilities in JSX, variants and helpers fail', () => {
  for (const utility of ['shadow', 'rounded', 'blur', 'outline-none', 'ring', 'bg-opacity-50', 'flex-shrink-0', 'flex-grow', 'overflow-ellipsis', 'decoration-slice']) {
    assert.ok(lintClasses(`<div className="md:hover:${utility}" />`).length, utility);
    assert.ok(lintClasses(`const x = clsx("${utility}")`).length, utility);
  }
});
test('dynamic construction, references and conditional branches are inspected', () => {
  for (const source of ['const c = "rou" + "nded"; const View = <div className={c} />;', 'const View = <div className={`bg-opacity-${opacity}`} />;', 'const View = <div className={`shadow${small ? "" : "-lg"}`} />;', 'const classes = { "ring": enabled };', 'el.classList.add("blur")']) {
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
