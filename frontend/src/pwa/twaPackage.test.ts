// #6584 · vagt for Google Play-pakken (TWA): web-manifestet, assetlinks-skabelonen og
// android-twa/twa-manifest.json skal hele tiden sige det samme. Glider de fra hinanden,
// bygger ejeren en app der viser adresselinje, forkerte farver eller forkert pakke, og
// det opdages foerst efter en Play-upload og dagene hos Googles gennemsyn.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

interface WebIcon { sizes: string; purpose: string; type: string }
interface WebShortcut { url: string }
interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  display: string;
  start_url: string;
  scope: string;
  theme_color: string;
  background_color: string;
  icons: WebIcon[];
  shortcuts: WebShortcut[];
}
interface AssetLinkStatement {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
}
interface TwaShortcut { name: string; shortName: string; url: string; chosenIconUrl: string }
interface TwaManifest {
  packageId: string;
  host: string;
  display: string;
  startUrl: string;
  themeColor: string;
  backgroundColor: string;
  webManifestUrl: string;
  fullScopeUrl: string;
  iconUrl: string;
  maskableIconUrl: string;
  monochromeIconUrl: string;
  enableNotifications: boolean;
  shortcuts: TwaShortcut[];
  signingKey: Record<string, string>;
}
interface VercelHeaderRule { source: string; headers: { key: string; value: string }[] }
interface VercelConfig {
  headers: VercelHeaderRule[];
  rewrites: { source: string; destination: string }[];
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as T;
}

const webManifest = readJson<WebManifest>("../../public/manifest.webmanifest");
const assetLinks = readJson<AssetLinkStatement[]>("../../public/.well-known/assetlinks.json");
const twa = readJson<TwaManifest>("../../../android-twa/twa-manifest.json");
const vercel = readJson<VercelConfig>("../../vercel.json");

const PLACEHOLDER = "REPLACE_WITH_SHA256_OF_PLAY_APP_SIGNING_KEY";
const SHA256_COLON_HEX = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

test("web manifest has what a Trusted Web Activity needs", () => {
  assert.ok(webManifest.name && webManifest.short_name, "name + short_name");
  assert.equal(webManifest.display, "standalone");
  assert.ok(webManifest.start_url.startsWith("/"), "start_url is same-origin");
  assert.ok(webManifest.scope === "/" && webManifest.id, "scope + id are set");
  const has = (size: string, purpose: string) =>
    webManifest.icons.some((i) => i.sizes === size && i.purpose === purpose && i.type === "image/png");
  assert.ok(has("192x192", "any"), "192 any icon");
  assert.ok(has("512x512", "any"), "512 any icon");
  assert.ok(has("512x512", "maskable"), "512 maskable icon");
  assert.ok(has("512x512", "monochrome"), "512 monochrome icon");
  assert.match(webManifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(webManifest.background_color, /^#[0-9a-f]{6}$/i);
});

test("assetlinks.json is a valid Digital Asset Links statement list for the TWA package", () => {
  assert.ok(Array.isArray(assetLinks) && assetLinks.length >= 1);
  for (const statement of assetLinks) {
    assert.deepEqual(statement.relation, ["delegate_permission/common.handle_all_urls"]);
    assert.equal(statement.target.namespace, "android_app");
    assert.equal(statement.target.package_name, twa.packageId);
    assert.ok(Array.isArray(statement.target.sha256_cert_fingerprints));
    assert.ok(statement.target.sha256_cert_fingerprints.length >= 1);
    for (const fp of statement.target.sha256_cert_fingerprints) {
      // Skabelonen maa indeholde pladsholderen indtil ejeren har Play App Signing-noeglen;
      // alt andet skal vaere et aegte SHA-256-fingeraftryk (store hex-par med kolon).
      assert.ok(fp === PLACEHOLDER || SHA256_COLON_HEX.test(fp), `ugyldigt fingeraftryk: ${fp}`);
    }
  }
});

test("twa-manifest.json follows the web manifest (host, start url, colours, icons, shortcuts)", () => {
  assert.equal(twa.host, "cyclingzone.org");
  assert.equal(twa.packageId, "org.cyclingzone.app");
  assert.equal(twa.startUrl, webManifest.start_url);
  assert.equal(twa.display, webManifest.display);
  assert.equal(twa.themeColor.toLowerCase(), webManifest.theme_color.toLowerCase());
  assert.equal(twa.backgroundColor.toLowerCase(), webManifest.background_color.toLowerCase());
  assert.equal(twa.webManifestUrl, `https://${twa.host}/manifest.webmanifest`);
  assert.equal(twa.fullScopeUrl, `https://${twa.host}/`);

  // Hvert ikon pakken peger paa, skal findes i frontend/public, ellers bygger Bubblewrap en tom app.
  for (const url of [twa.iconUrl, twa.maskableIconUrl, twa.monochromeIconUrl]) {
    const path = new URL(url).pathname;
    assert.ok(existsSync(new URL(`../../public${path}`, import.meta.url)), `${url} peger paa ${path}, som ikke findes`);
  }

  const webShortcuts = webManifest.shortcuts.map((s) => s.url).sort();
  const twaShortcuts = twa.shortcuts.map((s) => new URL(s.url).pathname).sort();
  assert.deepEqual(twaShortcuts, webShortcuts);
  assert.ok(twa.shortcuts.length <= 4, "Android viser hoejst 4 genveje");
  for (const s of twa.shortcuts) {
    assert.ok(s.name && s.shortName && s.url && s.chosenIconUrl, "hver genvej skal have name, shortName, url, chosenIconUrl");
  }
});

test("push is not part of the first Play release", () => {
  assert.equal(twa.enableNotifications, false);
});

test("no signing material can end up in the repo from android-twa/", () => {
  const dir = new URL("../../../android-twa/", import.meta.url);
  const ignore = readFileSync(new URL(".gitignore", dir), "utf8");
  for (const pattern of ["*.jks", "*.keystore", "*.aab", "*.apk"]) {
    assert.ok(ignore.split(/\r?\n/).includes(pattern), `android-twa/.gitignore mangler ${pattern}`);
  }
  const leaked = readdirSync(dir).filter(
    (f) => /\.(jks|keystore|p12|pfx|pem|key)$/i.test(f) || f === "keystore.properties",
  );
  assert.deepEqual(leaked, [], "en signeringsnoegle ligger i android-twa/");
  // Signeringsstien i konfigurationen maa gerne pege paa en lokal fil, men aldrig indeholde kodeord.
  assert.ok(!("storePassword" in twa.signingKey) && !("keyPassword" in twa.signingKey));
});

test("vercel serves assetlinks.json as JSON, short-lived, and never through the app fallback", () => {
  const rule = vercel.headers.find((h) => h.source === "/.well-known/assetlinks.json");
  assert.ok(rule, "der skal vaere en header-regel for assetlinks.json");
  const header = (key: string) => rule.headers.find((h) => h.key === key)?.value ?? "";
  assert.equal(header("Content-Type"), "application/json");
  const maxAge = Number(/max-age=(\d+)/.exec(header("Cache-Control"))?.[1] ?? Infinity);
  assert.ok(maxAge <= 3600, "kort cache, saa et nyt fingeraftryk naar ud hurtigt");
  assert.ok(!/immutable/.test(header("Cache-Control")));

  const spa = vercel.rewrites.find((r) => r.destination === "/app.html");
  assert.ok(spa, "SPA-fallback findes");
  assert.ok(
    !new RegExp(`^${spa.source}$`).test("/.well-known/assetlinks.json"),
    "assetlinks.json maa ikke omskrives til app.html",
  );
});
