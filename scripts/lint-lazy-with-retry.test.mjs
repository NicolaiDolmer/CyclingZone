// scripts/lint-lazy-with-retry.test.mjs
// ============================================================
// Tests for forward-guarden mod bart React.lazy() i frontend/src (#5014).
// Run: node --test scripts/lint-lazy-with-retry.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { findBareLazyCalls } from "./lint-lazy-with-retry.mjs";

// ── Skal flages ───────────────────────────────────────────────────────────

test("flager `lazy` importeret direkte fra react", () => {
  const src = `
    import { lazy, Suspense } from "react";
    const FeedbackModal = lazy(() => import("./FeedbackModal"));
  `;
  const findings = findBareLazyCalls(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 3);
});

test("flager `lazy` importeret fra react med lokalt alias", () => {
  const src = `
    import { lazy as reactLazy } from "react";
    const Foo = reactLazy(() => import("./Foo"));
  `;
  assert.equal(findBareLazyCalls(src).length, 1);
});

test("flager `React.lazy(` member-formen uanset import", () => {
  const src = `
    import React from "react";
    const Foo = React.lazy(() => import("./Foo"));
  `;
  assert.equal(findBareLazyCalls(src).length, 1);
});

test("det faktiske #5014-mønster (StoryOfTheStageSection før fix)", () => {
  const src = `
    import { lazy, Suspense, useState } from "react";
    const TimelineFilmPlayer = lazy(() => import("./TimelineFilmPlayer.jsx"));
  `;
  const findings = findBareLazyCalls(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].snippet, "lazy(");
});

test("flager flere bare lazy-kald i samme fil", () => {
  const src = `
    import { lazy } from "react";
    const A = lazy(() => import("./A"));
    const B = lazy(() => import("./B"));
  `;
  assert.equal(findBareLazyCalls(src).length, 2);
});

// ── Skal IKKE flages ──────────────────────────────────────────────────────

test("flager IKKE lazyWithRetry importeret som `lazy` (App.jsx-mønsteret, #881)", () => {
  const src = `
    import { lazyWithRetry as lazy } from "./lib/lazyWithRetry.js";
    const Layout = lazy(() => import("./components/Layout"));
    const RidersPage = lazy(() => import("./pages/RidersPage"));
  `;
  assert.equal(findBareLazyCalls(src).length, 0);
});

test("flager IKKE lazyWithRetry importeret under sit eget navn", () => {
  const src = `
    import { lazyWithRetry } from "../lib/lazyWithRetry.js";
    const FinalKilometrePlayback = lazyWithRetry(() => import("../components/race/FinalKilometrePlayback.jsx"));
  `;
  assert.equal(findBareLazyCalls(src).length, 0);
});

test("flager IKKE `lazy` importeret fra react uden noget kald (kun Suspense bruges)", () => {
  const src = `
    import { lazy, Suspense } from "react";
    export function Wrapper({ children }) {
      return children;
    }
  `;
  assert.equal(findBareLazyCalls(src).length, 0);
});

test("flager IKKE et lokalt navn der bare ligner (lazyLoad, lazyValue) uden import fra react", () => {
  const src = `
    function lazyLoad() { return 1; }
    const lazyValue = lazyLoad();
  `;
  assert.equal(findBareLazyCalls(src).length, 0);
});

test("ignorerer forekomster i strenge og kommentarer", () => {
  const src = `
    import { lazyWithRetry as lazy } from "./lib/lazyWithRetry.js";
    // brug ALDRIG bart lazy(() => import(...)) her
    const msg = "lazy(() => import(...))";
    const Foo = lazy(() => import("./Foo"));
  `;
  assert.equal(findBareLazyCalls(src).length, 0);
});
