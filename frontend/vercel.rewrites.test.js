import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Vagt for #4545. Baggrund: SPA-catch-all'en fangede ogsaa /assets/*, saa en
// chunk der ikke fandtes i det serverede deploy svarede 200 + text/html i stedet
// for 404 — og /assets/(.*)-header-reglen stemplede det forkerte svar
// `immutable` i et aar. Browseren cachede altsaa en HTML-side paa en JS-URL,
// permanent, og `location.reload()` revaliderer ikke immutable-ressourcer.
//
// Maalt i prod 1/9 foer fixet:
//   curl -sI /assets/AuctionsPage-DEADBEEF.js
//   -> 200, content-type: text/html, cache-control: max-age=31536000, immutable
//
// Filsystemet vinder over rewrites paa Vercel, saa denne undtagelse rammer KUN
// filer der ikke findes. Rigtige assets serveres praecis som foer.

const config = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "vercel.json"), "utf8"),
);

const spaRewrite = config.rewrites.find((r) => r.destination === "/app.html");

// Vercels `source` er path-to-regexp. Formen her ("/(<regex>)") er ren regex, saa
// moensteret kan afproeves direkte i stedet for at blive string-matchet.
function servesSpaFallback(path) {
  return new RegExp(`^${spaRewrite.source}$`).test(path);
}

test("SPA-fallback findes og peger paa app.html", () => {
  assert.ok(spaRewrite, "der skal vaere en catch-all rewrite til /app.html");
});

test("app-ruter serveres stadig af SPA-fallback", () => {
  for (const path of ["/", "/team", "/auctions", "/auctions/history", "/races/abc-123", "/dashboard"]) {
    assert.ok(servesSpaFallback(path), `${path} skal serveres af SPA-fallback`);
  }
});

test("statiske mapper falder IKKE tilbage til app.html (#4545)", () => {
  const staticPaths = [
    "/assets/index-IQ99eXuj.js",
    "/assets/AuctionsPage-DEADBEEF.js",
    "/assets/index-DT_ei3E8.css",
    "/fonts/bebas.woff2",
    "/brand/logo.svg",
    "/locales/en/common.json",
  ];
  for (const path of staticPaths) {
    assert.ok(
      !servesSpaFallback(path),
      `${path} maa give 404 naar filen mangler, ikke 200 + HTML — ellers resolver import() til en HTML-side, og svaret caches immutable i et aar`,
    );
  }
});

test("alle mapper med lang cache-header er undtaget fra fallback", () => {
  // Forward-guard: tilfoejes en ny mappe med lang max-age, skal den ogsaa undtages,
  // ellers genopstaar praecis den samme faelde et nyt sted.
  const longCacheDirs = config.headers
    .filter((h) => /max-age=(\d+)/.test(h.headers.find((x) => x.key === "Cache-Control")?.value ?? ""))
    .map((h) => h.source.match(/^\/([a-z]+)\/\(\.\*\)$/)?.[1])
    .filter(Boolean);

  assert.ok(longCacheDirs.length > 0, "forventede mindst én mappe med cache-header");
  for (const dir of longCacheDirs) {
    assert.ok(
      !servesSpaFallback(`/${dir}/vilkaarlig-fil.ext`),
      `/${dir}/ har en lang cache-header men falder tilbage til app.html — et forkert svar ville blive cachet lige saa laenge`,
    );
  }
});
