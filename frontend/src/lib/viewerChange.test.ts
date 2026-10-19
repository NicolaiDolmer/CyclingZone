// #6514 · Codex-fund: viewer-bundne caches tømmes når viewer skifter.
import test from "node:test";
import assert from "node:assert/strict";
import { isViewerChangeEvent } from "./viewerChange.ts";

test("#6514 isViewerChangeEvent: login/logout/bruger-skift tømmer cachen, token-refresh gør ikke", () => {
  assert.equal(isViewerChangeEvent("SIGNED_IN"), true);
  assert.equal(isViewerChangeEvent("SIGNED_OUT"), true);
  assert.equal(isViewerChangeEvent("USER_UPDATED"), true);
  assert.equal(isViewerChangeEvent("TOKEN_REFRESHED"), false);
  assert.equal(isViewerChangeEvent("INITIAL_SESSION"), false);
});

