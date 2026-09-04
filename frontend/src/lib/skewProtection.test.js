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

// Det der betyder noget er ikke max-age i sig selv, men hvornår pinnen ABSOLUT
// ophører: aldrig senere end build + PIN_WINDOW_MS, uanset hvornår klienten
// booter. Ellers kan et deployment nå at aldre ud af Vercels Maximum Age mens en
// cookie stadig peger på det, og så er der hård 404 uden selvheling.
function absoluteExpiry(cookie, now) {
  return now + Number(parse(cookie).attrs["max-age"]) * 1000;
}

test("the pin never expires later than build + PIN_WINDOW_MS, whenever the client boots", () => {
  const deadline = BUILD + PIN_WINDOW_MS;
  for (const offsetMin of [0, 1, 5, 15, 29]) {
    const now = BUILD + offsetMin * 60 * 1000;
    const cookie = buildVdplCookie({ deploymentId: "dpl_abc123", buildTimeMs: BUILD, now });
    assert.ok(
      absoluteExpiry(cookie, now) <= deadline,
      `boot ${offsetMin} min inde: absolut udløb må ikke ligge efter build + vinduet`
    );
  }
});

test("a reload does not extend the pin (max-age shrinks with deployment age)", () => {
  const tenMin = 10 * 60 * 1000;
  const cookie = buildVdplCookie({
    deploymentId: "dpl_abc123",
    buildTimeMs: BUILD,
    now: BUILD + tenMin,
  });
  assert.equal(Number(parse(cookie).attrs["max-age"]), (PIN_WINDOW_MS - tenMin) / 1000);

  const later = buildVdplCookie({
    deploymentId: "dpl_abc123",
    buildTimeMs: BUILD,
    now: BUILD + 2 * tenMin,
  });
  assert.equal(Number(parse(later).attrs["max-age"]), (PIN_WINDOW_MS - 2 * tenMin) / 1000);
  assert.equal(absoluteExpiry(later, BUILD + 2 * tenMin), BUILD + PIN_WINDOW_MS);
});

test("the pin window is short enough that a bad deploy cannot outlive its own rollback", () => {
  // __vdpl pinner ogsaa dokument-navigationer: vinduet ER hvor længe et ødelagt
  // build overlever sin egen revert for en ramt spiller.
  assert.ok(PIN_WINDOW_MS <= 30 * 60 * 1000, "over 30 min gør en revert virkningsløs for pinnede klienter");
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

test("clock skew backwards yields no pin at all (never a window we cannot bound)", () => {
  // Med et ur der går bagud kan vi ikke beregne et pålideligt absolut udløb, og
  // en for lang cookie kan overleve deploymentet i Vercels Maximum Age → hård
  // 404. Så hellere ingen pin.
  assert.equal(
    buildVdplCookie({ deploymentId: "dpl_abc123", buildTimeMs: BUILD, now: BUILD - 1 }),
    null
  );
  assert.equal(
    buildVdplCookie({
      deploymentId: "dpl_abc123",
      buildTimeMs: BUILD,
      now: BUILD - 10 * 60 * 60 * 1000,
    }),
    null
  );
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
