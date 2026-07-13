import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedOrigin } from "./corsOrigin.js";

const ALLOWED = [
  "https://cyclingzone.org",
  "https://www.cyclingzone.org",
  "https://cycling-zone.vercel.app",
  "http://localhost:5173",
];

test("eksakt allowlist: prod + localhost tillades", () => {
  assert.equal(isAllowedOrigin("https://cyclingzone.org", ALLOWED), true);
  assert.equal(isAllowedOrigin("https://www.cyclingzone.org", ALLOWED), true);
  assert.equal(isAllowedOrigin("https://cycling-zone.vercel.app", ALLOWED), true);
  assert.equal(isAllowedOrigin("http://localhost:5173", ALLOWED), true);
});

test("Vercel branch-preview under ejerens team-scope tillades (#1875)", () => {
  assert.equal(isAllowedOrigin("https://cycling-zone-git-feat-s5-peak-p-07cd1d-nicolai-dolmers-projects.vercel.app", ALLOWED), true);
  // Anden branch/hash — samme team → tillades.
  assert.equal(isAllowedOrigin("https://cycling-zone-abc123-nicolai-dolmers-projects.vercel.app", ALLOWED), true);
  // Andet projekt, samme team → tillades (team-scope, ikke projekt-scope).
  assert.equal(isAllowedOrigin("https://some-other-project-xyz-nicolai-dolmers-projects.vercel.app", ALLOWED), true);
});

test("fraværende origin (server-til-server / samme-origin) tillades", () => {
  assert.equal(isAllowedOrigin(undefined, ALLOWED), true);
  assert.equal(isAllowedOrigin("", ALLOWED), true);
});

test("fremmede origins afvises", () => {
  assert.equal(isAllowedOrigin("https://evil.com", ALLOWED), false);
  assert.equal(isAllowedOrigin("https://cyclingzone.org.attacker.com", ALLOWED), false);
});

test("fremmed Vercel-team afvises (ikke hele *.vercel.app)", () => {
  assert.equal(isAllowedOrigin("https://cycling-zone-abc-someone-else-projects.vercel.app", ALLOWED), false);
  assert.equal(isAllowedOrigin("https://phishing-nicolai-dolmers-projects.vercel.app.evil.com", ALLOWED), false);
});

test("preview-scope kræver https (ingen http/ws-downgrade)", () => {
  assert.equal(isAllowedOrigin("http://cycling-zone-git-x-nicolai-dolmers-projects.vercel.app", ALLOWED), false);
});
