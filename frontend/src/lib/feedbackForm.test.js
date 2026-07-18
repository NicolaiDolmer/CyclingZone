import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFeedback, captureContext, FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX_LENGTH } from "./feedbackForm.js";

test("FEEDBACK_CATEGORIES matches the backend whitelist", () => {
  assert.deepEqual(FEEDBACK_CATEGORIES, ["feedback", "bug", "idea"]);
});

test("validateFeedback — rejects an unknown category", () => {
  assert.equal(validateFeedback({ category: "spam", message: "hello" }), "error.invalidCategory");
  assert.equal(validateFeedback({ category: undefined, message: "hello" }), "error.invalidCategory");
});

test("validateFeedback — rejects empty / whitespace-only message", () => {
  assert.equal(validateFeedback({ category: "bug", message: "" }), "error.messageRequired");
  assert.equal(validateFeedback({ category: "bug", message: "   " }), "error.messageRequired");
  assert.equal(validateFeedback({ category: "bug", message: undefined }), "error.messageRequired");
});

test("validateFeedback — rejects a message over the max length", () => {
  const tooLong = "a".repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1);
  assert.equal(validateFeedback({ category: "idea", message: tooLong }), "error.messageTooLong");
});

test("validateFeedback — accepts a valid submission for every category", () => {
  for (const category of FEEDBACK_CATEGORIES) {
    assert.equal(validateFeedback({ category, message: "Something worth reporting" }), null);
  }
});

test("validateFeedback — a message at exactly the max length is accepted", () => {
  const exact = "a".repeat(FEEDBACK_MESSAGE_MAX_LENGTH);
  assert.equal(validateFeedback({ category: "feedback", message: exact }), null);
});

test("captureContext — builds page_path + viewport string", () => {
  assert.deepEqual(
    captureContext({ pathname: "/team", innerWidth: 375, innerHeight: 812 }),
    { page_path: "/team", viewport: "375x812" }
  );
});

test("captureContext — missing inputs fall back to null", () => {
  assert.deepEqual(captureContext(), { page_path: null, viewport: null });
  assert.deepEqual(captureContext({}), { page_path: null, viewport: null });
});
