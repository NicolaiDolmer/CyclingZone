import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildVdplCookie,
  installSkewProtection,
  PIN_WINDOW_MS,
  VDPL_COOKIE,
} from "./skewProtection.js";

const BUILD = Date.UTC(2026, 8, 4, 12, 0, 0);

function parse(cookie) {
  const parts = cookie.split(";").map((p) => p.trim());
  const [name, ...rest] = parts[0].split("=");
  const attrs = {};
  for (const p of parts.slice(1)) {
    const [k, v] = p.split("=");
    attrs[k.toLowerCase()] = v === undefined ? true : v;
  }
  return { name, value: rest.join("="), attrs };
}

test("no cookie when the build had no deployment id (Skew Protection off)", () => {
  assert.equal(buildVdplCookie({ deploymentId: "", buildTimeMs: BUILD, now: BUILD }), null);
  assert.equal(buildVdplCookie({ deploymentId: undefined, buildTimeMs: BUILD, now: BUILD }), null);
});

test("no cookie when build time is unknown (fail safe, never an unbounded pin)", () => {
  assert.equal(buildVdplCookie({ deploymentId: "dpl_x", buildTimeMs: 0, now: BUILD }), null);
  assert.equal(buildVdplCookie({ deploymentId: "dpl_x", buildTimeMs: NaN, now: BUILD }), null);
});

test("pins to the deployment id on a fresh build", () => {
  const cookie = buildVdplCookie({ deploymentId: "dpl_abc123", buildTimeMs: BUILD, now: BUILD });
  const { name, value, attrs } = parse(cookie);
  assert.equal(name, VDPL_COOKIE);
  assert.equal(value, "dpl_abc123");
  assert.equal(attrs.path, "/");
  assert.equal(attrs.samesite, "Lax", "Lax so document and assets resolve to the same deployment");
  assert.equal(attrs.secure, true);
  assert.equal(Number(attrs["max-age"]), PIN_WINDOW_MS / 1000);
});

test("max-age shrinks with deployment age and never extends the window", () => {
  const oneHour = 60 * 60 * 1000;
  const cookie = buildVdplCookie({
    deploymentId: "dpl_abc123",
    buildTimeMs: BUILD,
    now: BUILD + oneHour,
  });
  assert.equal(Number(parse(cookie).attrs["max-age"]), (PIN_WINDOW_MS - oneHour) / 1000);

  // Et reload 3 timer inde forlænger IKKE pinnen — cookien udløber stadig
  // PIN_WINDOW_MS efter buildet. Det er værnet mod at mure en bruger fast på et
  // deployment der senere aldrer ud af Vercels Maximum Age og begynder at 404'e.
  const later = buildVdplCookie({
    deploymentId: "dpl_abc123",
    buildTimeMs: BUILD,
    now: BUILD + 3 * oneHour,
  });
  assert.equal(Number(parse(later).attrs["max-age"]), oneHour / 1000);
});

test("clears the cookie once the deployment is older than the pin window", () => {
  const cookie = buildVdplCookie({
    deploymentId: "dpl_abc123",
    buildTimeMs: BUILD,
    now: BUILD + PIN_WINDOW_MS + 1,
  });
  const { name, value, attrs } = parse(cookie);
  assert.equal(name, VDPL_COOKIE);
  assert.equal(value, "");
  assert.equal(Number(attrs["max-age"]), 0, "expires the pin so the client falls back to latest");
});

test("clock skew backwards does not produce a window larger than PIN_WINDOW_MS", () => {
  const cookie = buildVdplCookie({
    deploymentId: "dpl_abc123",
    buildTimeMs: BUILD,
    now: BUILD - 10 * 60 * 60 * 1000,
  });
  assert.equal(Number(parse(cookie).attrs["max-age"]), PIN_WINDOW_MS / 1000);
});

test("the cookie value never carries a query string (the #4745 failure mode)", () => {
  const cookie = buildVdplCookie({ deploymentId: "dpl_abc123", buildTimeMs: BUILD, now: BUILD });
  assert.ok(!/[?&]dpl=/.test(cookie), "no ?dpl= anywhere — asset URLs stay untouched");
});

test("installSkewProtection writes to document.cookie", () => {
  const doc = { cookie: "" };
  const written = installSkewProtection({
    deploymentId: "dpl_abc123",
    buildTimeMs: BUILD,
    now: BUILD,
    doc,
  });
  assert.ok(written.startsWith(`${VDPL_COOKIE}=dpl_abc123;`));
  assert.equal(doc.cookie, written);
});

test("installSkewProtection is a no-op without a deployment id", () => {
  const doc = { cookie: "" };
  assert.equal(installSkewProtection({ deploymentId: "", buildTimeMs: BUILD, now: BUILD, doc }), null);
  assert.equal(doc.cookie, "");
});

test("installSkewProtection survives blocked cookies", () => {
  const doc = {
    set cookie(_v) {
      throw new Error("blocked");
    },
    get cookie() {
      return "";
    },
  };
  assert.equal(
    installSkewProtection({ deploymentId: "dpl_abc123", buildTimeMs: BUILD, now: BUILD, doc }),
    null
  );
});

test("installSkewProtection defaults are inert outside a bundled browser build", () => {
  // Ingen define'de globals og intet document i node --test → ingen bivirkning.
  assert.equal(installSkewProtection(), null);
});
