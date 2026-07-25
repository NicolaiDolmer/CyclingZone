import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter, Routes, Route, Outlet, useResolvedPath } from "react-router";

// React Router v7-migration (Dependabot #22/#23/#24, 2026-07-25).
//
// v6 og v7 opløser RELATIVE paths inde i en splat-route forskelligt:
//   v6: relativt til route-path'en UDEN splatten   -> /admin/bogus + "season" = /admin/season
//   v7: relativt til HELE den matchede location    -> /admin/bogus + "season" = /admin/bogus/season
//
// Admin-fladens catch-all (`<Route path="*">` under `<Route path="admin">`) sender
// ukendte /admin/*-URL'er videre til season-tabben. Med et relativt to="season"
// ville v7 sende /admin/bogus -> /admin/bogus/season, som matcher splatten igen
// -> uendeligt redirect-loop. Derfor er redirect-målene absolutte i App.jsx.
//
// Test 1 fastholder v7-semantikken (så en fremtidig router-opgradering der ændrer
// den, fejler synligt her). Test 2 holder App.jsx ærlig.

const __dirname = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(__dirname, "App.jsx"), "utf8");

function Probe() {
  return React.createElement("i", null, useResolvedPath("season").pathname);
}

function resolveInAdminTree(location) {
  return renderToStaticMarkup(
    React.createElement(
      StaticRouter,
      { location },
      React.createElement(
        Routes,
        null,
        React.createElement(
          Route,
          { path: "admin", element: React.createElement(Outlet) },
          React.createElement(Route, { path: "season", element: React.createElement("b", null, "season") }),
          React.createElement(Route, { path: "*", element: React.createElement(Probe) }),
        ),
      ),
    ),
  );
}

test("react-router v7: relativ path i en splat-route opløses mod HELE den matchede location", () => {
  assert.equal(
    resolveInAdminTree("/admin/bogus"),
    "<i>/admin/bogus/season</i>",
    'v7-semantikken har ændret sig. Hvis relativ opløsning igen stripper splatten, kan App.jsx\'s absolutte admin-redirects forenkles — men verificér FØR du gør det.',
  );
  assert.equal(resolveInAdminTree("/admin/dybt/nested"), "<i>/admin/dybt/nested/season</i>");
});

test("App.jsx's admin-redirects er absolutte (ellers redirect-loop på /admin/*)", () => {
  const adminBlock = appSource.match(/<Route path="admin" element=\{<AdminLayout \/>\}>[\s\S]*?<\/Route>/);
  assert.ok(adminBlock, "kunne ikke finde admin-route-blokken i App.jsx");

  const relativeRedirect = /<Navigate\s+to="(?!\/)/.exec(adminBlock[0]);
  assert.equal(
    relativeRedirect,
    null,
    `admin-blokken har et relativt <Navigate to="...">. v7 opløser relative paths i splat-routes mod hele den matchede location, så /admin/bogus ville redirecte til /admin/bogus/season → ny splat-match → loop. Brug en absolut path (/admin/season).`,
  );

  assert.match(
    adminBlock[0],
    /<Route path="\*"\s+element=\{<Navigate to="\/admin\/season" replace \/>\} \/>/,
    "admin-catch-all peger ikke længere på /admin/season",
  );
});
