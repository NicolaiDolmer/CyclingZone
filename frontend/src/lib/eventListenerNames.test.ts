// #6271 forward-guard: event names must never be "upgraded" like class names.
//
// `npx @tailwindcss/upgrade` rewrites every token that looks like a v3 class,
// also outside className. It turned `removeEventListener("blur", …)` into
// `removeEventListener("blur-sm", …)` in releaseWatch.js and
// MentionAutocomplete.jsx (v3 `blur` = v4 `blur-sm`). Nothing failed: the
// listener was simply never removed, a silent leak. The same thing will
// happen at the next codemod, so this test pins the shape of event names:
//
//   - native DOM events are lowercase letters only (`blur`, `keydown`,
//     `visibilitychange`) — never a hyphen, never a size suffix;
//   - the app's own events are namespaced with a colon (`cz:notif-deleted`,
//     `vite:preloadError`);
//   - every `removeEventListener("x")` has an `addEventListener("x")` in the
//     same file, so a rename on one side only is caught even if it happened
//     to produce a valid-looking name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const CALL = /\b(add|remove)EventListener\(\s*["'`]([^"'`]+)["'`]/g;
const NATIVE = /^[a-z]+$/;
const NAMESPACED = /^[a-z]+:[a-zA-Z-]+$/;

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.(jsx?|tsx?)$/.test(entry)) out.push(full);
  }
  return out;
}

const SELF = fileURLToPath(import.meta.url);
const files = collect(SRC).filter((file) => file !== SELF).map((file) => ({
  rel: relative(SRC, file).replace(/\\/g, "/"),
  calls: [...readFileSync(file, "utf8").matchAll(CALL)].map((m) => ({ kind: m[1], name: m[2] })),
}));

test("event-navne i add/removeEventListener er DOM-navne eller namespacede app-events", () => {
  const bad: string[] = [];
  for (const { rel, calls } of files) {
    for (const { kind, name } of calls) {
      if (!NATIVE.test(name) && !NAMESPACED.test(name)) bad.push(`${rel}: ${kind}EventListener("${name}")`);
    }
  }
  assert.ok(files.some((f) => f.calls.length > 0), "scanningen fandt ingen listeners — er stien forkert?");
  assert.deepEqual(bad, [], `Event-navne der ligner Tailwind-klasser (codemod-skade?):\n${bad.join("\n")}`);
});

test("hver removeEventListener har en addEventListener med samme navn i samme fil", () => {
  const orphans: string[] = [];
  for (const { rel, calls } of files) {
    const added = new Set(calls.filter((c) => c.kind === "add").map((c) => c.name));
    for (const { kind, name } of calls) {
      if (kind === "remove" && !added.has(name)) orphans.push(`${rel}: removeEventListener("${name}")`);
    }
  }
  assert.deepEqual(orphans, [], `removeEventListener uden matchende addEventListener:\n${orphans.join("\n")}`);
});

test("guarden fanger codemod-klassen (blur → blur-sm)", () => {
  assert.ok(NATIVE.test("blur"));
  assert.ok(!NATIVE.test("blur-sm") && !NAMESPACED.test("blur-sm"));
  assert.ok(!NATIVE.test("outline-solid") && !NAMESPACED.test("outline-solid"));
});
