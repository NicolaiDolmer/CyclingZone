import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), "utf8");

test("EmptyState er et hairline-kort med ikon/titel/tekst/handling", () => {
  const src = read("EmptyState.jsx");
  assert.match(src, /border-cz-border/);
  assert.match(src, /rounded-cz/);
  assert.match(src, /\{icon\}/);
  assert.match(src, /\{title\}/);
  assert.match(src, /\{action\}/);
});

test("ErrorState bruger AlertTriangle + danger-tone + retry-slot", () => {
  const src = read("ErrorState.jsx");
  assert.match(src, /AlertTriangleIcon/);
  assert.match(src, /text-cz-danger/);
  assert.match(src, /\{action\}/);
});

test("Skeleton bruger cz-skeleton-klassen og er aria-hidden", () => {
  const src = read("Skeleton.jsx");
  assert.match(src, /cz-skeleton/);
  assert.match(src, /aria-hidden/);
});

test("Spinner genbruger .spinner + animate-spin og melder status", () => {
  const src = read("Spinner.jsx");
  assert.match(src, /"spinner|spinner /);
  assert.match(src, /animate-spin/);
  assert.match(src, /role="status"/);
});
