// Regressionstest for Express 5-migrationen (#4565).
//
// Dækker de to ting ved body-parsing der FAKTISK ændrede sig i Express 5, og som
// backenden er afhængig af:
//   1. `req.body` er undefined når intet parses (body-parser 2) — normalizeRequestBody
//      skal sætte `{}` tilbage, ellers bliver `const { x } = req.body` en 500'er.
//   2. Den rå webhook-Buffer skal stadig overleve den globale express.json() der
//      mountes efter. Mekanismen skiftede fra `req._body` til
//      `onFinished.isFinished(req)`, så nettoeffekten skal pinnes eksplicit.
//
// Middleware-rækkefølgen herunder spejler server.js bevidst: raw-mounts →
// express.json() → normalizeRequestBody.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { normalizeRequestBody } from "./normalizeRequestBody.js";

function buildApp() {
  const app = express();
  app.use("/api/billing/alunta-webhook", express.raw({ type: "*/*" }));
  app.use(express.json({ limit: "10mb" }));
  app.use(normalizeRequestBody);

  app.post("/api/billing/alunta-webhook", (req, res) => {
    res.json({ isBuffer: Buffer.isBuffer(req.body), raw: Buffer.isBuffer(req.body) ? req.body.toString("utf8") : null });
  });
  // Samme mønster som de 67 destrukturerende handlers i routes/api.js.
  app.post("/destructure", (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    return res.json({ name });
  });
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: "Internal server error", message: err?.message });
  });
  return app;
}

async function withServer(fn) {
  const server = buildApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("POST uden Content-Type giver 400-validering, ikke 500 (Express 5 body-default)", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/destructure`, { method: "POST" });
    assert.equal(res.status, 400, "manglende body skal ramme rutens egen validering");
    assert.deepEqual(await res.json(), { error: "name required" });
  });
});

test("POST med tom JSON-body giver 400-validering, ikke 500", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/destructure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "",
    });
    assert.equal(res.status, 400);
  });
});

test("POST med gyldig JSON parses uændret", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/destructure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Fabio" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { name: "Fabio" });
  });
});

test("webhook beholder RÅ Buffer selv om express.json() mountes efter", async () => {
  await withServer(async (base) => {
    const payload = '{"event":"subscription.updated","id":"abc"}';
    const res = await fetch(`${base}/api/billing/alunta-webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.isBuffer, true, "signaturverifikation kræver de rå bytes");
    assert.equal(body.raw, payload, "bytes må ikke være re-serialiseret undervejs");
  });
});

test("normalizeRequestBody rører ikke en body der allerede er sat", () => {
  const buffer = Buffer.from("raw");
  const req = { body: buffer };
  let called = false;
  normalizeRequestBody(req, {}, () => {
    called = true;
  });
  assert.equal(req.body, buffer);
  assert.equal(called, true, "skal altid kalde next()");
});

test("normalizeRequestBody rører ikke en falsy men defineret body", () => {
  for (const value of ["", 0, null, false]) {
    const req = { body: value };
    normalizeRequestBody(req, {}, () => {});
    assert.equal(req.body, value, `body=${JSON.stringify(value)} skal være uændret`);
  }
});
