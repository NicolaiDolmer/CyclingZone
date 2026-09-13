// #4565 - Express 5 aendrer default query parser fra "extended" (qs) til
// "simple" (querystring). Reviewer-fund 11/9: repoet har 0 nestede/array-
// query-noegler ([]=, filter[, qs.stringify i frontend/src og scripts), og
// alle 17 req.query.*-noegler i backend/routes/api.js er flade skalarer, saa
// "simple" er korrekt og sikrere. Laast eksplicit i server.js
// (app.set("query parser", "simple")) saa den ikke stille kan skifte tilbage.
//
// server.js har ingen export og kalder app.listen()/startCron() ved import
// (samme begraensning som beskrevet i
// apiSelectionWithdrawalGate.routes.test.js: ingen supertest-harness i denne
// kodebase). Denne test dokumenterer wiring via kilde-scanning OG verificerer
// den faktiske adfaerd med en isoleret Express-instans (samme express-version
// som er installeret i backend/node_modules), saa selve parser-valget er
// dækket af en rigtig HTTP-roundtrip og ikke kun en streng-sammenligning.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(resolve(__dirname, "../server.js"), "utf8");

test("server.js laaser query parser til simple lige efter app-init (#4565)", () => {
  const appInitIndex = serverSource.indexOf("const app = express();");
  assert.ok(appInitIndex !== -1, "kunne ikke finde app-init i server.js");

  const afterInit = serverSource.slice(appInitIndex, appInitIndex + 400);
  assert.match(
    afterInit,
    /app\.set\(\s*"query parser"\s*,\s*"simple"\s*\)/,
    'app.set("query parser", "simple") skal staa umiddelbart efter app-init',
  );
});

test("query parser simple giver flade skalar-noegler for nestede query-parametre (adfaerdstest)", async () => {
  const app = express();
  app.set("query parser", "simple");
  app.get("/probe", (req, res) => res.json({ query: req.query }));

  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/probe?a[b]=1`);
    const body = await res.json();
    // simple (querystring) parser: noeglen forbliver bogstaveligt "a[b]",
    // IKKE nestet til { a: { b: "1" } } som "extended" (qs) ville give.
    assert.deepEqual(body.query, { "a[b]": "1" });
  } finally {
    server.close();
  }
});

test("query parser simple giver samme resultat som app.get-lookup (fallback-kontrol)", () => {
  const app = express();
  app.set("query parser", "simple");
  assert.equal(app.get("query parser"), "simple");
});
