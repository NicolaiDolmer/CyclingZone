import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #5325 — den kanoniske ErrorState (bruges på alle sider) manglede en
// programmatisk annoncering af fejlen til skærmlæsere. Komponenten monteres
// altid conditionally ({error && <ErrorState .../>} / `if (error) return
// <ErrorState .../>`), aldrig som en fast beholder hvis indhold ændres — så
// role="alert" (ikke aria-live="assertive") er den korrekte fix, se
// begrundelsen i ErrorState.jsx.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "ErrorState.jsx"), "utf8");

test("ErrorState annoncerer fejlen til skærmlæsere via role=alert (#5325)", () => {
  assert.match(src, /role="alert"/, "rod-elementet skal have role=\"alert\"");
});

test("role=alert sidder på selve rod-div'en, ikke et vilkårligt underelement", () => {
  assert.match(
    src,
    /<div\s+role="alert"\s+className=\{`flex flex-col items-center justify-center/,
    "role=\"alert\" skal stå på ErrorState's rod-div, så attributten følger komponenten uanset hvor den bruges",
  );
});

test("ingen aria-live tilføjet ved siden af — role=alert er tilstrækkeligt for et fresh-mounted element", () => {
  assert.doesNotMatch(
    src,
    /aria-live/,
    "ErrorState monteres altid conditionally, så aria-live er overflødigt ved siden af role=alert",
  );
});
