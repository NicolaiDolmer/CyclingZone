// #5144 — fejl-middlewaren skal respektere err.status.
//
// Ingen supertest i denne kodebase (samme begrænsning som beskrevet i
// lib/queryParserSimple.routes.test.js): testene rejser en minimal Express-app
// på port 0 og laver en rigtig HTTP-roundtrip med fetch. Appen bruger PRÆCIS
// samme middleware som server.js monterer (errorMiddleware fra
// lib/errorMiddleware.js), så det er adfærden i produktion der måles — ikke en
// kopi af logikken.
//
// Sentry-siden testes via den SAMME predicate som server.js giver Sentrys
// express-error-handler (`shouldHandleError: shouldReportToSentry`). Mocken
// herunder efterligner Sentrys handler 1:1: den kalder predicaten, capturer
// hvis den er sand, og kalder altid next(err) videre.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STATUS_CODES } from "node:http";
import express from "express";

import {
  errorMiddleware,
  resolveErrorStatus,
  shouldReportToSentry,
  clientErrorMessage,
} from "../lib/errorMiddleware.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Lokal stand-in for `http-errors`' createError. http-errors er kun en
 * TRANSITIV afhængighed (via express), så den importeres bevidst ikke direkte
 * her. Formen er den samme som pakken producerer — status + statusCode +
 * expose (true for 4xx) + standard-HTTP-besked hvis ingen gives — og de ÆGTE
 * http-errors-instanser dækkes alligevel af defekt-JSON- og 413-testene, hvor
 * fejlen kommer fra body-parser selv.
 */
function createError(status, message) {
  const err = new Error(message || STATUS_CODES[status] || "Error");
  err.status = status;
  err.statusCode = status;
  err.expose = status < 500;
  return err;
}

/**
 * Minimal app med samme kæde som server.js: json-parser → route der kaster →
 * (Sentry-mock) → errorMiddleware. Returnerer { request, captured, close }.
 */
function buildApp({ throwFn } = {}) {
  const captured = [];
  const app = express();
  app.use(express.json({ limit: "1kb" }));
  app.post("/boom", (_req, res) => {
    if (throwFn) throw throwFn();
    res.json({ ok: true });
  });
  app.get("/boom", (_req, res) => {
    if (throwFn) throw throwFn();
    res.json({ ok: true });
  });
  // Efterligner Sentry.setupExpressErrorHandler(app, { shouldHandleError }).
  app.use((err, _req, _res, next) => {
    if (shouldReportToSentry(err)) captured.push(err);
    next(err);
  });
  app.use(errorMiddleware);

  const server = app.listen(0);
  const { port } = server.address();

  return {
    captured,
    async request(path, init) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return { status: res.status, body, text };
    },
    close() {
      server.close();
    },
  };
}

test("defekt JSON giver 400 med kort besked, ikke 500 (#5144)", async () => {
  const app = buildApp();
  try {
    const res = await app.request("/boom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Invalid JSON body");
    assert.ok(!("stack" in res.body), "stack må aldrig med i kroppen");
    assert.equal(app.captured.length, 0, "en klient-fejl må ikke i Sentry");
  } finally {
    app.close();
  }
});

test("for stor body giver 413 fra body-parser, ikke 500", async () => {
  const app = buildApp();
  try {
    const res = await app.request("/boom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pad: "x".repeat(4096) }),
    });
    assert.equal(res.status, 413);
    assert.equal(res.body.error, "Payload too large");
    assert.equal(app.captured.length, 0);
  } finally {
    app.close();
  }
});

test("kastet Error uden status giver 500 med uændret krop og ingen stack", async () => {
  const app = buildApp({ throwFn: () => new Error("intern detalje der ikke må lække") });
  try {
    const res = await app.request("/boom");
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: "Internal server error" });
    assert.ok(!res.text.includes("intern detalje"), "rå fejlbesked må ikke lække til klienten");
    assert.ok(!/at \w+ \(/.test(res.text), "stack-frames må ikke lække til klienten");
    assert.equal(app.captured.length, 1, "en server-fejl SKAL i Sentry");
  } finally {
    app.close();
  }
});

test("createError(403) giver 403 med http-errors' egen korte besked", async () => {
  const app = buildApp({ throwFn: () => createError(403, "Not your team") });
  try {
    const res = await app.request("/boom");
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "Not your team");
    assert.equal(app.captured.length, 0);
  } finally {
    app.close();
  }
});

test("createError(403) uden besked falder tilbage til standard-HTTP-teksten", async () => {
  const app = buildApp({ throwFn: () => createError(403) });
  try {
    const res = await app.request("/boom");
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "Forbidden");
  } finally {
    app.close();
  }
});

test("errorCode/errorParams følger med 4xx så frontendens resolveApiError kan oversætte", async () => {
  const app = buildApp({
    throwFn: () => {
      const err = new Error("Your club identity isn't ready yet.");
      err.status = 409;
      err.expose = true;
      err.errorCode = "dna_requires_identity_basis";
      err.errorParams = { season: 2 };
      return err;
    },
  });
  try {
    const res = await app.request("/boom");
    assert.equal(res.status, 409);
    assert.equal(res.body.errorCode, "dna_requires_identity_basis");
    assert.deepEqual(res.body.errorParams, { season: 2 });
    assert.equal(app.captured.length, 0);
  } finally {
    app.close();
  }
});

test("err.status = 503 svarer 500 som hidtil og capturees stadig", async () => {
  const app = buildApp({
    throwFn: () => {
      const err = new Error("upstream nede");
      err.status = 503;
      return err;
    },
  });
  try {
    const res = await app.request("/boom");
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: "Internal server error" });
    assert.equal(app.captured.length, 1);
  } finally {
    app.close();
  }
});

test("resolveErrorStatus: kun 400-499 respekteres", () => {
  assert.equal(resolveErrorStatus({ status: 404 }), 404);
  assert.equal(resolveErrorStatus({ statusCode: 429 }), 429);
  assert.equal(resolveErrorStatus({ status_code: "422" }), 422);
  assert.equal(resolveErrorStatus({ output: { statusCode: 401 } }), 401);
  assert.equal(resolveErrorStatus({ status: 302 }), 500);
  assert.equal(resolveErrorStatus({ status: 503 }), 500);
  assert.equal(resolveErrorStatus({ status: "ikke et tal" }), 500);
  assert.equal(resolveErrorStatus(new Error("ingen status")), 500);
  assert.equal(resolveErrorStatus(null), 500);
  assert.equal(resolveErrorStatus(undefined), 500);
  assert.equal(resolveErrorStatus("bare en streng"), 500);
});

test("shouldReportToSentry: 4xx nej, alt andet ja", () => {
  assert.equal(shouldReportToSentry({ status: 400 }), false);
  assert.equal(shouldReportToSentry({ status: 499 }), false);
  assert.equal(shouldReportToSentry({ status: 500 }), true);
  assert.equal(shouldReportToSentry(new Error("uden status")), true);
});

test("clientErrorMessage lækker aldrig en lang besked eller en stack", () => {
  const err = new Error(`linje 1\n    at handler (/app/routes/api.js:1:1)`);
  err.expose = true;
  assert.equal(clientErrorMessage(err, 400), "linje 1");

  const long = new Error("x".repeat(500));
  long.expose = true;
  assert.equal(clientErrorMessage(long, 400).length, 200);

  // expose !== true (typisk 5xx fra http-errors) → standard-teksten.
  const hidden = new Error("intern detalje");
  assert.equal(clientErrorMessage(hidden, 400), "Bad Request");
});

test("server.js monterer errorMiddleware og gater Sentry med shouldReportToSentry (#5144)", () => {
  const serverSource = readFileSync(resolve(__dirname, "../server.js"), "utf8");
  assert.match(
    serverSource,
    /setupSentryExpressErrorHandler\(app,\s*\{\s*shouldHandleError:\s*shouldReportToSentry\s*\}\)/,
    "Sentry-handleren skal gates med shouldReportToSentry",
  );
  assert.match(serverSource, /app\.use\(errorMiddleware\)/, "errorMiddleware skal monteres sidst");
  assert.ok(
    !/res\.status\(500\)\.json\(\{\s*error:\s*"Internal server error"\s*\}\)/.test(serverSource),
    "den gamle altid-500-middleware må ikke stå tilbage i server.js",
  );
});
