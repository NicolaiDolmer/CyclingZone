// #6514 · #7439 · Viewer-bundne caches tømmes kun, når bruger-id'et reelt skifter.
import test from "node:test";
import assert from "node:assert/strict";
import { createViewerTracker, onViewerChange, type ViewerSessionLike } from "./viewerChange.ts";
import { createFreshFlagLoader } from "./freshFlagLoader.ts";

const as = (id: string | null): ViewerSessionLike => (id ? { user: { id } } : null);

function fakeAuth() {
  let listener: ((event: string, session: ViewerSessionLike) => void) | null = null;
  let unsubscribed = false;
  return {
    auth: {
      onAuthStateChange(cb: (event: string, session: ViewerSessionLike) => void) {
        listener = cb;
        return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } };
      },
    },
    emit: (event: string, id: string | null) => listener?.(event, as(id)),
    unsubscribed: () => unsubscribed,
  };
}

test("#7439 tracker: første session er udgangspunkt; kun nyt bruger-id er et skift", () => {
  const changed = createViewerTracker();
  assert.equal(changed(as("a")), false, "INITIAL_SESSION er udgangspunktet");
  assert.equal(changed(as("a")), false, "samme bruger igen");
  assert.equal(changed(as("b")), true, "anden bruger");
  assert.equal(changed(as(null)), true, "logout");
  assert.equal(changed(as(null)), false, "stadig logget ud");
  assert.equal(changed(as("b")), true, "login");
});

test("#7439 onViewerChange: SIGNED_IN/TOKEN_REFRESHED/USER_UPDATED for samme bruger kalder ikke", () => {
  const h = fakeAuth();
  let calls = 0;
  const stop = onViewerChange(h.auth, () => { calls += 1; });
  h.emit("INITIAL_SESSION", "a");
  h.emit("SIGNED_IN", "a");
  h.emit("TOKEN_REFRESHED", "a");
  h.emit("USER_UPDATED", "a");
  assert.equal(calls, 0, "faneskift (SIGNED_IN for samme bruger) er ikke et viewer-skift");
  h.emit("SIGNED_IN", "b");
  assert.equal(calls, 1, "anden bruger");
  h.emit("SIGNED_OUT", null);
  assert.equal(calls, 2, "logout");
  stop();
  assert.equal(h.unsubscribed(), true);
});

test("#7439 flag-loader + faneskift: samme bruger beholder flaget; anden bruger og logout nulstiller", async () => {
  const h = fakeAuth();
  let calls = 0;
  const loader = createFreshFlagLoader(async () => {
    calls += 1;
    return true;
  }, { maxAgeMs: 60_000, now: () => 0 });
  const seen: boolean[] = [];
  loader.subscribe((on) => seen.push(on));
  onViewerChange(h.auth, () => loader.reset());

  h.emit("INITIAL_SESSION", "a");
  assert.equal(await loader.load(), true);
  h.emit("SIGNED_IN", "a");
  h.emit("TOKEN_REFRESHED", "a");
  assert.deepEqual(seen, [true], "ingen publish(false) ved faneskift");
  assert.equal(await loader.load(), true);
  assert.equal(calls, 1, "svaret er stadig cachet: ingen ny hentning");

  h.emit("SIGNED_IN", "b");
  assert.deepEqual(seen, [true, false], "anden bruger nulstiller");
  assert.equal(await loader.load(), true);
  assert.equal(calls, 2, "den nye viewer henter sit eget svar");

  h.emit("SIGNED_OUT", null);
  assert.deepEqual(seen, [true, false, true, false], "logout nulstiller");
});
