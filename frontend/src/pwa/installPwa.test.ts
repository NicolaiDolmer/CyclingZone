// #6584 · session-markoeren der gater install-tilbuddet.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasSessionCookie } from "./installPwa.ts";

test("reads the cz_session marker cookie exactly", () => {
  assert.equal(hasSessionCookie("cz_session=1"), true);
  assert.equal(hasSessionCookie("a=b; cz_session=1; c=d"), true);
  assert.equal(hasSessionCookie(""), false);
  assert.equal(hasSessionCookie("cz_session=0"), false);
  assert.equal(hasSessionCookie("cz_session=10"), false);
  assert.equal(hasSessionCookie("xcz_session=1"), false);
});

test("main.jsx boots the PWA layer; Layout feeds the icon badge from the nav unread count", () => {
  const main = readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
  assert.match(main, /installPwa\(\)/);
  const layout = readFileSync(new URL("../components/Layout.jsx", import.meta.url), "utf8");
  assert.match(layout, /useAppBadge\(unread\)/);
});

test("index.html links the manifest", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"/);
});

test("the manifest has what install + shortcuts need", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/dashboard");
  const sizes = new Set(manifest.icons.filter((i: { purpose: string }) => i.purpose === "any").map((i: { sizes: string }) => i.sizes));
  assert.ok(sizes.has("192x192") && sizes.has("512x512"));
  assert.ok(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable"));
  assert.deepEqual(
    manifest.shortcuts.map((s: { url: string }) => s.url),
    ["/auctions", "/race-centre", "/team"],
  );
  for (const icon of [...manifest.icons, ...manifest.shortcuts.flatMap((s: { icons: unknown[] }) => s.icons)]) {
    const src = (icon as { src: string }).src;
    assert.doesNotThrow(() => readFileSync(new URL(`../../public${src}`, import.meta.url)), `missing ${src}`);
  }
});

test("the service worker never caches app code", () => {
  const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
  // Kun navigationer haandteres; ingen cache-first paa assets eller API.
  assert.match(sw, /request\.mode !== "navigate"/);
  assert.doesNotMatch(sw, /cache\.(put|add)\([^)]*\/assets/);
  assert.doesNotMatch(sw, /caches\.match\(request\)/);
  assert.doesNotMatch(sw, /cache\.put\(request/);
});
