import { test } from "node:test";
import assert from "node:assert/strict";
import { toastClass, TOAST_TONE } from "./toastStyles.js";

test("toast er soft-lift kort der modtager pointer-events", () => {
  const c = toastClass();
  assert.ok(c.includes("pointer-events-auto"));
  assert.ok(c.includes("rounded-cz"));
  assert.ok(c.includes("bg-cz-card"));
  assert.ok(c.includes("shadow-overlay"));
});

test("tone styrer kun border (broadcast, ikke fyldt pille); ukendt → info", () => {
  assert.ok(toastClass({ tone: "danger" }).includes("border-cz-danger/40"));
  assert.ok(toastClass({ tone: "success" }).includes("border-cz-success/40"));
  assert.equal(toastClass({ tone: "zz" }), toastClass({ tone: "info" }));
});

test("TOAST_TONE eksponerer de kendte toner", () => {
  assert.deepEqual(Object.keys(TOAST_TONE).sort(), ["danger", "info", "success", "warning"]);
});
