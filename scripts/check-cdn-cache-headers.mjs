#!/usr/bin/env node
// check-cdn-cache-headers.mjs — forward-guard: hold Vercels CDN-cache-headers på plads.
//
// Baggrund (2026-08-07, Vercel-alarm "Edge Requests spike", refs #2423):
// Vercels DEFAULT for statiske filer er `Cache-Control: public, max-age=0, must-revalidate`.
// Det betyder at browseren revaliderer HVER fil ved HVERT sideload — og hver revalidering
// tæller som en billable Edge Request, også når svaret er 304. Med ~27 asset-referencer i
// app.html kostede ét gensyn ~27 edge requests i stedet for ~3.
//
// Fejlklassen er lumsk fordi den er 100 % USYNLIG i produktet: siden er hurtig, alt virker,
// intet fejler. Den viser sig kun på Vercels forbrugstal. Derfor denne gate: den måler de
// LEVENDE headers efter deploy, ikke konfigurationen — en regel i vercel.json der ikke
// matcher (forkert glob, ændret output-mappe) ser korrekt ud i review men virker ikke.
//
// Kør: node scripts/check-cdn-cache-headers.mjs [origin]
//   origin default https://cyclingzone.org
// exit 0 = alle regler holder, exit 1 = mindst én regression.

const ORIGIN = (process.argv[2] || "https://cyclingzone.org").replace(/\/$/, "");

// Krav pr. sti-klasse. minMaxAge i sekunder; requireImmutable for content-hashede filer.
const RULES = [
  { label: "hashed build-assets", pick: pickHashedAsset, minMaxAge: 31536000, requireImmutable: true },
  { label: "fonts", pick: () => "/fonts/dm-sans-latin-wght-normal.woff2", minMaxAge: 86400, requireImmutable: false },
  { label: "brand-assets", pick: () => "/brand/wordmark-ondark.svg", minMaxAge: 86400, requireImmutable: false },
  { label: "favicon", pick: () => "/favicon.svg", minMaxAge: 86400, requireImmutable: false },
];

// SPA-entry SKAL forblive kortlivet — ellers ser brugere en gammel index efter deploy.
const ENTRY_MAX_MAX_AGE = 60;

function parseMaxAge(cc) {
  const m = /max-age=(\d+)/.exec(cc || "");
  return m ? Number(m[1]) : null;
}

async function head(path) {
  const res = await fetch(`${ORIGIN}${path}`, { method: "GET", redirect: "follow" });
  return {
    status: res.status,
    cc: res.headers.get("cache-control") || "",
    ct: res.headers.get("content-type") || "",
  };
}

// Find en rigtig hashet asset-URL i den serverede HTML i stedet for at hardcode et filnavn
// (hashen skifter ved hvert build).
let cachedHtml = null;
async function getHtml() {
  if (cachedHtml === null) cachedHtml = await (await fetch(`${ORIGIN}/`)).text();
  return cachedHtml;
}
async function pickHashedAsset() {
  const html = await getHtml();
  const m = /(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/.exec(html);
  if (!m) throw new Error("fandt ingen /assets/*.js|css i den serverede HTML — er build-output flyttet?");
  return m[1];
}

const failures = [];
const lines = [];

for (const rule of RULES) {
  let path;
  try {
    path = typeof rule.pick === "function" ? await rule.pick() : rule.pick;
  } catch (e) {
    failures.push(`${rule.label}: ${e.message}`);
    continue;
  }
  const { status, cc, ct } = await head(path);
  if (status !== 200) {
    failures.push(`${rule.label}: ${path} svarede ${status}`);
    continue;
  }
  // SPA-rewriten `/(.*)` → /app.html gør at ENHVER ukendt sti svarer 200 med HTML.
  // Uden dette tjek ville et forkert filnavn i RULES fejle med en forvirrende
  // cache-besked i stedet for "filen findes ikke".
  if (/text\/html/.test(ct)) {
    failures.push(`${rule.label}: ${path} returnerede HTML (SPA-fallback) — filen findes ikke, ret stien i RULES`);
    continue;
  }
  const maxAge = parseMaxAge(cc);
  const problems = [];
  if (maxAge === null || maxAge < rule.minMaxAge) {
    problems.push(`max-age=${maxAge ?? "mangler"} < krævet ${rule.minMaxAge}`);
  }
  if (rule.requireImmutable && !/immutable/.test(cc)) {
    problems.push("mangler `immutable`");
  }
  if (problems.length) {
    failures.push(`${rule.label} (${path}): ${problems.join("; ")} — fik "${cc}"`);
    lines.push(`  ✗ ${rule.label.padEnd(20)} ${cc}`);
  } else {
    lines.push(`  ✓ ${rule.label.padEnd(20)} ${cc}`);
  }
}

// Omvendt krav: SPA-entry må IKKE cache længe.
{
  const { status, cc } = await head("/");
  const maxAge = parseMaxAge(cc);
  if (status === 200 && maxAge !== null && maxAge > ENTRY_MAX_MAX_AGE) {
    failures.push(`SPA-entry (/): max-age=${maxAge} > ${ENTRY_MAX_MAX_AGE} — nye deploys når ikke ud til brugerne`);
    lines.push(`  ✗ ${"SPA-entry".padEnd(20)} ${cc}`);
  } else {
    lines.push(`  ✓ ${"SPA-entry".padEnd(20)} ${cc}`);
  }
}

console.log(`CDN-cache-headers @ ${ORIGIN}`);
lines.forEach((l) => console.log(l));

if (failures.length) {
  console.error("\n✗ CDN-cache-regression — hver manglende cache-header koster edge requests på HVERT sideload:");
  failures.forEach((f) => console.error(`  - ${f}`));
  console.error("\nRet reglerne i frontend/vercel.json (headers[]). Se #2423 + .claude/learnings/2026-08-07-vercel-edge-requests-spike.md");
  process.exit(1);
}

console.log("\n✓ Alle cache-regler holder.");
