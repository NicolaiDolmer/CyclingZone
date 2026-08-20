import test from "node:test";
import assert from "node:assert/strict";

import { verifyAccessToken } from "./accessTokenVerify.js";

// Fake auth-klient der registrerer HVILKEN sti der blev brugt — pointen med
// #4010 er netop at den varme sti ikke må ramme getUser().
function makeSupabase({ claims = null, claimsError = null, user = null, userError = null } = {}) {
  const calls = { getClaims: 0, getUser: 0 };
  return {
    calls,
    auth: {
      async getClaims() {
        calls.getClaims += 1;
        return { data: claims ? { claims } : null, error: claimsError };
      },
      async getUser() {
        calls.getUser += 1;
        return { data: user ? { user } : { user: null }, error: userError };
      },
    },
  };
}

const CLAIMS = { sub: "user-1", email: "rider@example.com", exp: 4102444800 };

test("#4010 den varme sti verificerer lokalt og rammer ikke getUser", async () => {
  const supabase = makeSupabase({ claims: CLAIMS });
  const out = await verifyAccessToken(supabase, "aaa.bbb.ccc");

  assert.deepEqual(out, { id: "user-1", email: "rider@example.com" });
  assert.equal(supabase.calls.getClaims, 1);
  assert.equal(supabase.calls.getUser, 0, "110.938 getUser-kald i døgnet var netop problemet");
});

test("#4010 email er null når claim'et mangler", async () => {
  const supabase = makeSupabase({ claims: { sub: "user-1" } });
  assert.deepEqual(await verifyAccessToken(supabase, "aaa.bbb.ccc"), { id: "user-1", email: null });
});

test("#4010 afvist når getClaims fejler", async () => {
  const supabase = makeSupabase({ claimsError: { message: "Invalid JWT signature" } });
  assert.equal(await verifyAccessToken(supabase, "aaa.bbb.ccc"), null);
});

test("#4010 afvist når sub mangler (ikke et bruger-token)", async () => {
  // Fx et service_role-token: gyldig signatur, men ingen bruger bag sig. Det må
  // ikke kunne passere som en spiller.
  const supabase = makeSupabase({ claims: { role: "service_role" } });
  assert.equal(await verifyAccessToken(supabase, "aaa.bbb.ccc"), null);
});

test("#4010 tomt eller manglende token afvises uden opslag", async () => {
  const supabase = makeSupabase({ claims: CLAIMS });
  assert.equal(await verifyAccessToken(supabase, ""), null);
  assert.equal(await verifyAccessToken(supabase, undefined), null);
  assert.equal(await verifyAccessToken(supabase, null), null);
  assert.equal(supabase.calls.getClaims, 0);
});

test("#4010 strict går til getUser og ikke til getClaims", async () => {
  // Admin-ruter: her er tilbagekaldelses-vinduet ikke acceptabelt, så vi betaler
  // for fuld server-side verifikation.
  const supabase = makeSupabase({ user: { id: "admin-1", email: "admin@example.com" } });
  const out = await verifyAccessToken(supabase, "aaa.bbb.ccc", { strict: true });

  assert.deepEqual(out, { id: "admin-1", email: "admin@example.com" });
  assert.equal(supabase.calls.getUser, 1);
  assert.equal(supabase.calls.getClaims, 0);
});

test("#4010 strict afviser når auth-serveren siger nej", async () => {
  const supabase = makeSupabase({ userError: { message: "invalid JWT" } });
  assert.equal(await verifyAccessToken(supabase, "aaa.bbb.ccc", { strict: true }), null);
});

test("#4010 strict afviser en tom bruger uden fejl", async () => {
  const supabase = makeSupabase();
  assert.equal(await verifyAccessToken(supabase, "aaa.bbb.ccc", { strict: true }), null);
});
