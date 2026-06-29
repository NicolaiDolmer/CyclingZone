import { test } from "node:test";
import assert from "node:assert/strict";
import { getAuthedUser } from "./getAuthedUser.js";

// Stub-client der efterligner supabase.auth.getUser()-formen. Injiceres via
// getAuthedUser(client) — samme DI-mønster som dashboardSquadStats-testen.
function stubClient(user) {
  return { auth: { getUser: async () => ({ data: { user } }) } };
}

test("returnerer brugeren når sessionen er gyldig", async () => {
  const user = { id: "u-123" };
  assert.deepEqual(await getAuthedUser(stubClient(user)), user);
});

test("returnerer null (kaster IKKE) når user er null — udløbet session (#1792)", async () => {
  assert.equal(await getAuthedUser(stubClient(null)), null);
});

test("normaliserer undefined user til null", async () => {
  assert.equal(await getAuthedUser(stubClient(undefined)), null);
});

test("en repræsentativ loader rammer aldrig user.id på en null-session", async () => {
  // Spejler kaldssted-mønsteret: helper → guard → deref. Med null-session
  // returnerer loaderen tidligt og deref'er aldrig user.id (ingen throw).
  async function loadAll(client) {
    const user = await getAuthedUser(client);
    if (!user) return { loaded: false };
    return { loaded: true, id: user.id };
  }
  assert.deepEqual(await loadAll(stubClient(null)), { loaded: false });
  assert.deepEqual(await loadAll(stubClient({ id: "u-9" })), { loaded: true, id: "u-9" });
});
