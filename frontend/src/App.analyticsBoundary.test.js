import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// CYCLINGZONE-5B (4/9-2026): ClarityIntegration kastede
// "useConsent must be used within ConsentProvider" — et deploy-skew gav den
// lazy-chunk en anden modul-instans af consent.jsx end provider-traeet, saa
// context'en var tom. Analytics-blokken laa direkte under SentryBoundary, saa
// kastet tog HELE appen ned i fuldskaerms-fallbacken for 4 spillere. Fejlen
// klassificeres som "render_error", ikke chunk-fejl, saa selvhelingen (#4595)
// greb den ikke.
//
// Vagten: telemetri (Clarity, WebVitals, Vercel Analytics, GA, TrafficBeacon)
// SKAL ligge bag sin egen tavse boundary, saa naeste skew-vindue koster
// telemetri i stedet for adgang til spillet. Rod-aarsagen er #2423 (skew
// protection slaaet fra) og loeses ikke her.
//
// Kilde-vagt frem for render-test: node --test kan ikke importere .jsx, og
// React-error-boundaries fanger ikke under server-rendering. Samme moenster som
// App.adminSplatRedirect.test.js' "test 2".

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(__dirname, "App.jsx"), "utf8");
const sentrySource = readFileSync(join(__dirname, "lib", "sentry.jsx"), "utf8");

const ANALYTICS_COMPONENTS = [
  "ClarityIntegration",
  "WebVitalsIntegration",
  "VercelAnalyticsIntegration",
  "GaIntegration",
  "TrafficBeacon",
];

test("App.jsx: analytics-blokken ligger inde i AnalyticsBoundary (CYCLINGZONE-5B)", () => {
  const start = appSource.indexOf("<AnalyticsBoundary>");
  const end = appSource.indexOf("</AnalyticsBoundary>");
  assert.ok(start !== -1, "App.jsx mangler <AnalyticsBoundary>");
  assert.ok(end > start, "App.jsx mangler </AnalyticsBoundary> efter aabningen");

  const block = appSource.slice(start, end);
  for (const name of ANALYTICS_COMPONENTS) {
    assert.ok(
      block.includes(`<${name} `) || block.includes(`<${name}/>`) || block.includes(`<${name} />`),
      `${name} skal renderes inde i AnalyticsBoundary — ellers kan den tage hele appen ned`,
    );
  }
});

test("App.jsx: ingen analytics-komponent renderes uden for boundaryen", () => {
  const start = appSource.indexOf("<AnalyticsBoundary>");
  const end = appSource.indexOf("</AnalyticsBoundary>");
  const outside = appSource.slice(0, start) + appSource.slice(end);
  for (const name of ANALYTICS_COMPONENTS) {
    assert.ok(
      !outside.includes(`<${name} />`) && !outside.includes(`<${name}/>`),
      `${name} renderes uden for AnalyticsBoundary — telemetri maa aldrig kunne tage spillet ned`,
    );
  }
});

test("sentry.jsx: AnalyticsBoundary er tavs (fallback={null}) og tagger scope", () => {
  assert.ok(
    /export function AnalyticsBoundary\(/.test(sentrySource),
    "sentry.jsx skal eksportere AnalyticsBoundary",
  );
  const start = sentrySource.indexOf("export function AnalyticsBoundary(");
  const body = sentrySource.slice(start, start + 1200);
  assert.ok(
    body.includes("fallback={null}"),
    "AnalyticsBoundary skal rendere null ved fejl — ingen fejlside for en telemetri-fejl",
  );
  assert.ok(
    body.includes('scope.setTag("frontend_error_scope", "analytics")'),
    "AnalyticsBoundary skal tagge fejlen som analytics, saa den forbliver synlig i Sentry",
  );
});
