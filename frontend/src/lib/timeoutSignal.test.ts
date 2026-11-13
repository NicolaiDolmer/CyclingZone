import { test } from "node:test";
import assert from "node:assert/strict";
import { timeoutSignal } from "./timeoutSignal.ts";

test("timeout works without AbortSignal.timeout and releases its timer", (t) => {
  const native = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")!;
  Reflect.deleteProperty(AbortSignal, "timeout");
  t.after(() => Object.defineProperty(AbortSignal, "timeout", native));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const request = timeoutSignal(8000);
  assert.equal(request.signal.aborted, false);
  t.mock.timers.tick(7999);
  assert.equal(request.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(request.signal.aborted, true);
  request.dispose();
});

test("settlement disposes timeout and lifecycle cancellation aborts immediately", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const settled = timeoutSignal(8000);
  settled.dispose();
  t.mock.timers.tick(8000);
  assert.equal(settled.signal.aborted, false);
  const unmounted = timeoutSignal(8000);
  unmounted.abort();
  assert.equal(unmounted.signal.aborted, true);
});
