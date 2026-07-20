import test from "node:test";
import assert from "node:assert/strict";
import { handleEmailUnsubscribe } from "./emailUnsubRoute.js";
import { signUnsubToken } from "./emailUnsubToken.js";

const SECRET = "test-secret";

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    contentType: null,
    status(code) { this.statusCode = code; return this; },
    sendStatus(code) { this.statusCode = code; this.body = null; return this; },
    type(t) { this.contentType = t; return this; },
    send(body) { this.body = body; return this; },
  };
}

// The real chain for the write is `.from("users").update(patch).eq("id", userId)`
// which resolves directly (thenable). Model that distinctly from the read chain.
function makeSupabaseFull({ existingPrefs = {}, updateError = null } = {}) {
  const updates = [];
  return {
    updates,
    from(table) {
      assert.equal(table, "users");
      let mode = null;
      const b = {
        select() { mode = "read"; return b; },
        update(patch) { mode = "write"; updates.push(patch); return b; },
        eq() {
          if (mode === "read") return { maybeSingle: async () => ({ data: { email_prefs: existingPrefs }, error: null }) };
          return Promise.resolve({ error: updateError });
        },
      };
      return b;
    },
  };
}

test("GET with an invalid token returns 400 with a generic HTML page (no leaked detail)", async () => {
  const res = fakeRes();
  await handleEmailUnsubscribe({ req: { method: "GET", query: { token: "garbage" } }, res, supabase: makeSupabaseFull(), secret: SECRET });
  assert.equal(res.statusCode, 400);
  assert.equal(res.contentType, "html");
  assert.ok(res.body.includes("invalid"));
});

test("POST with an invalid token returns a bare 400 (one-click header contract, no page)", async () => {
  const res = fakeRes();
  await handleEmailUnsubscribe({ req: { method: "POST", query: { token: "garbage" } }, res, supabase: makeSupabaseFull(), secret: SECRET });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body, null);
});

test("GET with a valid token sets email_prefs.all=false and shows a confirmation page", async () => {
  const token = signUnsubToken("user-1", SECRET);
  const supabase = makeSupabaseFull({ existingPrefs: { welcome: false } });
  const res = fakeRes();

  await handleEmailUnsubscribe({ req: { method: "GET", query: { token } }, res, supabase, secret: SECRET });

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes("unsubscribed"));
  assert.deepEqual(supabase.updates, [{ email_prefs: { welcome: false, all: false } }], "merges into existing prefs rather than clobbering them");
});

test("POST with a valid token returns a bare 200 (one-click header contract)", async () => {
  const token = signUnsubToken("user-2", SECRET);
  const supabase = makeSupabaseFull();
  const res = fakeRes();

  await handleEmailUnsubscribe({ req: { method: "POST", query: { token } }, res, supabase, secret: SECRET });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
  assert.deepEqual(supabase.updates, [{ email_prefs: { all: false } }]);
});

test("a token signed with a different secret is rejected", async () => {
  const token = signUnsubToken("user-3", "a-different-secret");
  const res = fakeRes();
  await handleEmailUnsubscribe({ req: { method: "GET", query: { token } }, res, supabase: makeSupabaseFull(), secret: SECRET });
  assert.equal(res.statusCode, 400);
});

test("a DB failure during the update returns 500, never leaks the error to the caller", async () => {
  const token = signUnsubToken("user-4", SECRET);
  const supabase = makeSupabaseFull({ updateError: { message: "connection reset" } });
  const res = fakeRes();

  await handleEmailUnsubscribe({ req: { method: "GET", query: { token } }, res, supabase, secret: SECRET });

  assert.equal(res.statusCode, 500);
  assert.equal(res.body, null);
});
