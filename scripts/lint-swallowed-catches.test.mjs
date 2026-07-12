// Tests for scripts/lint-swallowed-catches.mjs (#2395 del 2).
// Verificerer detektions-logikken: hvad tæller som en "svaltet" catch, og at de
// tre escape-hatches (captureException / throw / '// best-effort'-markør) virker,
// samt at strenge/kommentarer der indeholder ordet "catch" ikke giver false positives.

import test from "node:test";
import assert from "node:assert/strict";
import { findSwallowedCatches } from "./lint-swallowed-catches.mjs";

test("tom catch flages som svaltet", () => {
  const src = `function f(){ try { g(); } catch (e) {} }`;
  assert.equal(findSwallowedCatches(src).length, 1);
});

test("console-only catch flages som svaltet", () => {
  const src = `function f(){ try { g(); } catch (e) { console.error(e); } }`;
  assert.equal(findSwallowedCatches(src).length, 1);
});

test("captureException i catch → ikke svaltet", () => {
  const src = `function f(){ try { g(); } catch (e) { captureException(e, { tags: { lib: "x" } }); } }`;
  assert.equal(findSwallowedCatches(src).length, 0);
});

test("sentryCapture i catch → ikke svaltet", () => {
  const src = `function f(){ try { g(); } catch (e) { sentryCapture(e); } }`;
  assert.equal(findSwallowedCatches(src).length, 0);
});

test("throw (rethrow) i catch → ikke svaltet", () => {
  const src = `function f(){ try { g(); } catch (e) { throw e; } }`;
  assert.equal(findSwallowedCatches(src).length, 0);
});

test("'// best-effort'-markør → ikke svaltet", () => {
  const src = `function f(){ try { g(); } catch (e) { /* best-effort: fire-and-forget */ } }`;
  assert.equal(findSwallowedCatches(src).length, 0);
});

test("'swallow-ok'-markør → ikke svaltet", () => {
  const src = `function f(){ try { g(); } catch (e) { console.log(e); } /* swallow-ok */ }`;
  // Markøren skal ligge inden for catch-spanet; her ligger den udenfor → stadig svaltet.
  assert.equal(findSwallowedCatches(src).length, 1);
});

test("markør INDE i catch-kroppen → ikke svaltet", () => {
  const src = `function f(){ try { g(); } catch (e) { // swallow-ok: bevidst\n } }`;
  assert.equal(findSwallowedCatches(src).length, 0);
});

test("ordet 'catch' i en streng giver ikke false positive", () => {
  const src = `const s = "please catch { this }"; function f(){ return s; }`;
  assert.equal(findSwallowedCatches(src).length, 0);
});

test("ordet 'catch' i en kommentar giver ikke false positive", () => {
  const src = `// husk at catch { her } skal håndteres\nfunction f(){ return 1; }`;
  assert.equal(findSwallowedCatches(src).length, 0);
});

test("object-literal-tuborg i catch-kroppen forvirrer ikke brace-matching", () => {
  const src = `function f(){ try { g(); } catch (e) { const o = { a: { b: 1 } }; log(o); } }`;
  // Ingen capture/throw/markør → svaltet (1), og brace-matchen skal stoppe korrekt.
  assert.equal(findSwallowedCatches(src).length, 1);
});

test("flere catches i samme fil tælles hver for sig", () => {
  const src = `
    function a(){ try { g(); } catch (e) {} }
    function b(){ try { g(); } catch (e) { captureException(e); } }
    function c(){ try { g(); } catch (e) { console.log(e); } }
  `;
  assert.equal(findSwallowedCatches(src).length, 2); // a + c svaltet, b håndteret
});
