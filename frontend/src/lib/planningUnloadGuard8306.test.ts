// #8306 · Browserens luk-advarsel skal kende en ugemt taktik-kladde, ogsaa naar truppen er gemt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guardUnload, workbenchUnsaved, type UnloadEventLike, type UnloadTarget } from "./planningWorkbench.ts";

function fakeWindow() {
  const handlers = new Set<(e: UnloadEventLike) => void>();
  const target: UnloadTarget = {
    addEventListener: (_type, handler) => handlers.add(handler),
    removeEventListener: (_type, handler) => handlers.delete(handler),
  };
  const fire = () => {
    let prevented = false;
    const event: UnloadEventLike = {
      preventDefault: () => {
        prevented = true;
      },
      returnValue: undefined,
    };
    for (const h of handlers) h(event);
    return { prevented, returnValue: event.returnValue };
  };
  return { target, handlers, fire };
}

test("unsaved: a tactics draft counts even when the squad is saved", () => {
  assert.equal(workbenchUnsaved({ squadDirty: false, tacticsDraft: false }), false);
  assert.equal(workbenchUnsaved({ squadDirty: true, tacticsDraft: false }), true);
  assert.equal(workbenchUnsaved({ squadDirty: false, tacticsDraft: true }), true);
  assert.equal(workbenchUnsaved({ squadDirty: true, tacticsDraft: true }), true);
});

test("saved squad + changed tactics: beforeunload sets returnValue", () => {
  const win = fakeWindow();
  const cleanup = guardUnload(win.target, workbenchUnsaved({ squadDirty: false, tacticsDraft: true }));
  assert.equal(typeof cleanup, "function");
  const fired = win.fire();
  assert.equal(fired.prevented, true);
  assert.equal(fired.returnValue, "");
  cleanup?.();
  assert.equal(win.handlers.size, 0);
});

test("nothing unsaved: no guard is installed", () => {
  const win = fakeWindow();
  const cleanup = guardUnload(win.target, workbenchUnsaved({ squadDirty: false, tacticsDraft: false }));
  assert.equal(cleanup, undefined);
  assert.equal(win.handlers.size, 0);
  assert.equal(win.fire().returnValue, undefined);
});

test("wiring: the workbench reports the tactics draft and the page guards with it", () => {
  const wb = readFileSync(new URL("../components/planning/RaceWorkbench.tsx", import.meta.url), "utf8");
  assert.match(wb, /onDirtyChange\?\.\(workbenchUnsaved\(\{ squadDirty: dirty, tacticsDraft: tacticsCanSave \}\)\)/);
  assert.match(wb, /\[dirty, tacticsCanSave, onDirtyChange\]/);
  const page = readFileSync(new URL("../pages/PlanningWorkbenchPage.tsx", import.meta.url), "utf8");
  assert.match(page, /guardUnload\(window, dirty \|\| hasDraft\)/);
  assert.match(page, /onDirtyChange=\{setDirty\}/);
});
