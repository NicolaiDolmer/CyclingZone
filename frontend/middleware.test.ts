import { test } from "node:test";
import assert from "node:assert/strict";
import middleware from "./middleware.ts";

test("real session cookie redirects before marketing and is never shared-cacheable", async () => {
  process.env.VITE_SUPABASE_URL = "https://testproject.supabase.co";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html><head></head><body>Marketing</body></html>");
  try {
    const response = await middleware(
      new Request("https://cyclingzone.org/?utm_source=test", {
        headers: { cookie: "sb-testproject-auth-token.0=base64-test" },
      })
    );
    assert.equal(response?.status, 307);
    assert.equal(
      response?.headers.get("location"),
      "https://cyclingzone.org/dashboard?utm_source=test"
    );
    assert.match(response?.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("anonymous Danish marketing preserves attribution, strips cookies, and guards before markup", async () => {
  process.env.VITE_SUPABASE_URL = "https://testproject.supabase.co";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://cycling-zone-marketing.vercel.app/da?utm_campaign=club");
    assert.equal(new Headers(options?.headers).get("cookie"), null);
    return new Response("<html><head><title>Public</title></head><body>Marketing</body></html>", {
      headers: { "set-cookie": "unexpected=1", etag: "old" },
    });
  };
  try {
    const response = await middleware(
      new Request("https://cyclingzone.org/?utm_campaign=club", {
        headers: { "accept-language": "da-DK,en", cookie: "cz_session=1; other=private" },
      })
    );
    const html = await response!.text();
    assert.ok(html.indexOf("<script>") < html.indexOf("<title>"));
    assert.equal(response!.headers.get("set-cookie"), null);
    assert.equal(response!.headers.get("etag"), null);
    assert.match(response!.headers.get("cache-control")!, /no-store/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("failed upstream falls through to guarded local prerender", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("offline");
  };
  try {
    assert.equal(await middleware(new Request("https://cyclingzone.org/")), undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("external rewrites remove browser credentials while preserving useful request headers", async () => {
  for (const path of [
    "/ingest/e",
    "/ingest/static/array.js",
    "/_next/static/app.js",
    "/how-it-works",
    "/landing/hero.webp",
    "/api/email/unsubscribe",
  ]) {
    const response = await middleware(
      new Request(`https://cyclingzone.org${path}`, {
        headers: {
          cookie: "sb-testproject-auth-token=fixture-secret",
          authorization: "Bearer fixture-secret",
          "content-type": "application/json",
        },
      })
    );
    assert.equal(response!.headers.get("x-middleware-next"), "1");
    assert.equal(response!.headers.get("x-middleware-request-cookie"), null);
    assert.equal(response!.headers.get("x-middleware-request-authorization"), null);
    assert.equal(response!.headers.get("x-middleware-request-content-type"), "application/json");
    assert.doesNotMatch(
      response!.headers.get("x-middleware-override-headers")!,
      /cookie|authorization/
    );
  }
});

test("Danish upstream failure rewrites a guarded local app shell, never external fallback", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  try {
    const response = await middleware(new Request("https://cyclingzone.org/da?utm_source=club"));
    assert.equal(
      response!.headers.get("x-middleware-rewrite"),
      "https://cyclingzone.org/app.html?utm_source=club"
    );
    assert.match(response!.headers.get("cache-control")!, /no-store/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('every configured external rewrite is covered by the credential-stripping matcher', async () => {
  const { readFileSync } = await import('node:fs');
  const { config } = await import('./middleware.ts');
  const settings = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
  for (const rule of settings.rewrites.filter((rule: { destination: string }) => rule.destination.startsWith('https://'))) {
    const example = rule.source.replace(':path(.*)', 'fixture');
    assert.ok(config.matcher.some(pattern => pattern.endsWith('/:path*') ? example.startsWith(pattern.slice(0, -7)) : pattern === example), `Missing credential boundary for ${rule.source}`);
  }
});
