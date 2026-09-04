import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chunkUrlFromError,
  loadWithRetry,
  moduleUrlsFromDocument,
  purgeStaleChunkFromCache,
} from "./lazyWithRetry.js";

// Dokument-stub: kun det querySelectorAll-udsnit purge-stien bruger.
function fakeDocument(nodes) {
  return { querySelectorAll: () => nodes };
}

function chunkError() {
  return new TypeError(
    "Failed to fetch dynamically imported module: https://cycling-zone.vercel.app/assets/TeamPage-old.js",
  );
}

test("loadWithRetry — returnerer modulet ved succes (intet retry)", async () => {
  let calls = 0;
  const mod = { default: "X" };
  const result = await loadWithRetry(async () => {
    calls += 1;
    return mod;
  });
  assert.equal(result, mod);
  assert.equal(calls, 1);
});

test("loadWithRetry — ét retry redder en transient chunk-fejl", async () => {
  let calls = 0;
  const mod = { default: "X" };
  const result = await loadWithRetry(async () => {
    calls += 1;
    if (calls === 1) throw chunkError();
    return mod;
  });
  assert.equal(result, mod);
  assert.equal(calls, 2);
});

test("loadWithRetry — ét retry redder et resolved modul uden default export", async () => {
  let calls = 0;
  const mod = { default: "X" };
  const result = await loadWithRetry(async () => {
    calls += 1;
    return calls === 1 ? { default: undefined, html: "<!doctype html>" } : mod;
  });
  assert.equal(result, mod);
  assert.equal(calls, 2);
});

test("loadWithRetry — vedvarende resolved ugyldigt modul bliver en ChunkLoadError", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      loadWithRetry(async () => {
        calls += 1;
        return undefined;
      }),
    (err) => {
      assert.equal(err.name, "ChunkLoadError");
      assert.match(err.message, /invalid module/i);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("loadWithRetry — vedvarende chunk-fejl kastes som genkendelig ChunkLoadError", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      loadWithRetry(async () => {
        calls += 1;
        throw chunkError();
      }),
    (err) => {
      assert.equal(err.name, "ChunkLoadError");
      assert.match(err.message, /Failed to fetch dynamically imported module/i);
      return true;
    },
  );
  assert.equal(calls, 2); // initial + ét retry
});

test("loadWithRetry — ikke-chunk-fejl rethrows uden retry", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      loadWithRetry(async () => {
        calls += 1;
        throw new Error("ordinary render crash");
      }),
    /ordinary render crash/,
  );
  assert.equal(calls, 1);
});

// ── #4595: rens den cachede 404 ud af browser-cachen før reload ───────────────

test("chunkUrlFromError — plukker chunk-URL'en ud af fejlteksten", () => {
  assert.equal(
    chunkUrlFromError(chunkError()),
    "https://cycling-zone.vercel.app/assets/TeamPage-old.js",
  );
  assert.equal(
    chunkUrlFromError(new Error("Importing a module script failed: https://x.dev/assets/a-1.mjs?v=2")),
    "https://x.dev/assets/a-1.mjs?v=2",
  );
});

test("chunkUrlFromError — ingen URL i React.lazy's interne fejl", () => {
  assert.equal(chunkUrlFromError(new Error("e._result is undefined")), null);
});

test("moduleUrlsFromDocument — samler modulepreloads + entry, uden dubletter", () => {
  const doc = fakeDocument([
    { href: "https://cz.org/assets/react-dom-a.js" },
    { href: "https://cz.org/assets/react-dom-a.js" },
    { src: "https://cz.org/assets/index-b.js" },
  ]);
  assert.deepEqual(moduleUrlsFromDocument(doc), [
    "https://cz.org/assets/react-dom-a.js",
    "https://cz.org/assets/index-b.js",
  ]);
});

test("purgeStaleChunkFromCache — refetcher den fejlede chunk med cache:'reload'", async () => {
  const calls = [];
  const urls = await purgeStaleChunkFromCache(chunkError(), {
    fetchFn: async (url, init) => {
      calls.push([url, init]);
      return { ok: true };
    },
  });
  assert.deepEqual(urls, ["https://cycling-zone.vercel.app/assets/TeamPage-old.js"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://cycling-zone.vercel.app/assets/TeamPage-old.js");
  assert.equal(calls[0][1].cache, "reload");
});

test("purgeStaleChunkFromCache — uden URL i fejlen renses dokumentets modul-URL'er", async () => {
  const seen = [];
  const doc = fakeDocument([
    { href: "https://cz.org/assets/react-dom-a.js" },
    { src: "https://cz.org/assets/index-b.js" },
  ]);
  await purgeStaleChunkFromCache(new Error("e._result is undefined"), {
    doc,
    fetchFn: async (url, init) => {
      seen.push(`${url}|${init.cache}`);
      return { ok: true };
    },
  });
  assert.deepEqual(seen, [
    "https://cz.org/assets/react-dom-a.js|reload",
    "https://cz.org/assets/index-b.js|reload",
  ]);
});

test("purgeStaleChunkFromCache — en fejlende refetch bobler ikke op", async () => {
  await assert.doesNotReject(() =>
    purgeStaleChunkFromCache(chunkError(), {
      fetchFn: async () => {
        throw new TypeError("Load failed");
      },
    }),
  );
});

test("purgeStaleChunkFromCache — uden fetch/dokument sker der intet (node-miljø)", async () => {
  assert.deepEqual(await purgeStaleChunkFromCache(chunkError()), []);
});

test("loadWithRetry — vedvarende chunk-fejl renser cachen før den kaster", async () => {
  const calls = [];
  await assert.rejects(
    () =>
      loadWithRetry(
        async () => {
          throw chunkError();
        },
        {
          fetchFn: async (url, init) => {
            calls.push([url, init.cache]);
            return { ok: true };
          },
        },
      ),
    (err) => {
      assert.equal(err.name, "ChunkLoadError");
      return true;
    },
  );
  // Ét retry fejler også → præcis ét purge-forsøg på den fejlede chunk.
  assert.deepEqual(calls, [["https://cycling-zone.vercel.app/assets/TeamPage-old.js", "reload"]]);
});

test("loadWithRetry — succes rører aldrig cachen", async () => {
  let fetches = 0;
  await loadWithRetry(async () => ({ default: "X" }), {
    fetchFn: async () => {
      fetches += 1;
      return { ok: true };
    },
  });
  assert.equal(fetches, 0);
});
