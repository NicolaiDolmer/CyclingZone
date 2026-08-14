// scripts/lint-unguarded-fetch-in-handler.test.mjs
// ============================================================
// Tests for forward-guarden mod `await fetch(...)` uden try/catch i frontend
// (#3628 / #3619 / #2719-rodårsagen).
// Run: node --test scripts/lint-unguarded-fetch-in-handler.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findUnguardedFetches, collectFiles } from "./lint-unguarded-fetch-in-handler.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ── Kernemønsteret: det der låste knappen i loading (#3619) ──────────────────

test("flager bart `await fetch(...)` i en handler", () => {
  const src = `
    async function save() {
      setSaving(true);
      const res = await fetch(url, { method: "POST" });
      setSaving(false);
    }
  `;
  const findings = findUnguardedFetches(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 4);
});

test("flager det faktiske #3628-mønster: fetch mellem setLoading(true) og (false)", () => {
  const src = `
    async function toggleDmEnabled(enabled) {
      setSavingDmEnabled(true);
      const headers = await getAuthHeaders();
      const res = await fetch(API + "/api/me/discord-dm-enabled", { method: "PATCH", headers });
      const data = await res.json();
      setSavingDmEnabled(false);
    }
  `;
  assert.equal(findUnguardedFetches(src).length, 1);
});

test("flager begge grene af en ternær med to fetch-kald", () => {
  const src = `
    async function handleAdminDelete(type, id) {
      const res = type === "post"
        ? await fetch(a, { method: "DELETE" })
        : await fetch(b, { method: "DELETE" });
    }
  `;
  assert.equal(findUnguardedFetches(src).length, 2);
});

// ── Det korrekte mønster må IKKE flages ──────────────────────────────────────

test("fetch i en try → ikke flaget", () => {
  const src = `
    async function save() {
      setSaving(true);
      try {
        const res = await fetch(url);
      } catch (cause) {
        setSaving(false);
      }
    }
  `;
  assert.equal(findUnguardedFetches(src).length, 0);
});

test("fetch i en try inde i en if inde i try → ikke flaget (nested blokke)", () => {
  const src = `
    async function save() {
      try {
        if (ok) {
          for (const x of xs) {
            const res = await fetch(url);
          }
        }
      } finally { setSaving(false); }
    }
  `;
  assert.equal(findUnguardedFetches(src).length, 0);
});

test("try i en YDRE funktion daekker IKKE en indre funktion", () => {
  // Det var praecis antagelsen der fejlede i #3619: kalderen "fanger vel".
  const src = `
    async function outer() {
      try {
        const inner = async () => {
          const res = await fetch(url);
        };
        inner();
      } catch { /* fanger aldrig inner's rejection */ }
    }
  `;
  assert.equal(findUnguardedFetches(src).length, 1);
});

test("catch-grenen taeller ikke som daekning", () => {
  const src = `
    async function retry() {
      try { primary(); } catch { const res = await fetch(fallbackUrl); }
    }
  `;
  assert.equal(findUnguardedFetches(src).length, 1);
});

test("fetch UDEN await → ikke flaget (uden for scope)", () => {
  const src = `fetch(url).then(r => r.json()).catch(() => {});`;
  assert.equal(findUnguardedFetches(src).length, 0);
});

// ── Escape-hatch ─────────────────────────────────────────────────────────────

test("`// best-effort`-markoer undertrykker fundet", () => {
  const src = `const res = await fetch(url); // best-effort: RiderManageActions fanger`;
  assert.equal(findUnguardedFetches(src).length, 0);
});

test("markoeren undertrykker IKKE et andet, umarkeret kald", () => {
  const src = [
    `const a = await fetch(x); // catch-ok: kalderen fanger`,
    `const b = await fetch(y);`,
  ].join("\n");
  const findings = findUnguardedFetches(src);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, 2);
});

// ── Strenge/kommentarer må ikke give falske fund ─────────────────────────────

test("moenster i en kommentar → ikke flaget", () => {
  const src = `// const res = await fetch(url);\nconst a = 1;`;
  assert.equal(findUnguardedFetches(src).length, 0);
});

test("moenster i en streng → ikke flaget", () => {
  const src = "const doc = `const res = await fetch(url);`;";
  assert.equal(findUnguardedFetches(src).length, 0);
});

test("tuborg inde i en template-streng forskyder ikke blok-stakken", () => {
  const src = `
    async function save() {
      try {
        const res = await fetch(\`\${API}/api/x\`);
      } catch { /* ok */ }
    }
  `;
  assert.equal(findUnguardedFetches(src).length, 0);
});

// ── Fil-udvælgelse: intet hardkodet, hele træet walkes ───────────────────────

test("collectFiles walker hele frontend/src", () => {
  const rels = collectFiles(ROOT).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
  assert.ok(rels.includes("frontend/src/pages/ProfilePage.jsx"), "pages skal walkes");
  assert.ok(rels.includes("frontend/src/lib/useAuctionBidding.js"), "lib skal walkes");
  assert.ok(rels.length > 100, `forventede et helt trae-walk, fik ${rels.length} filer`);
});

test("tests og preview-mocks scannes ikke", () => {
  const rels = collectFiles(ROOT).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
  assert.equal(rels.filter((r) => /\.test\.jsx?$/.test(r)).length, 0);
  assert.equal(rels.filter((r) => r.includes("/preview/")).length, 0);
});

// ── Regression: de sites #3628 rettede må ikke komme tilbage ─────────────────

test("de seks rettede handlere har ingen ubeskyttede fetch-kald igen (#3628)", () => {
  for (const rel of [
    "frontend/src/pages/ProfilePage.jsx",
    "frontend/src/pages/BoardPage.jsx",
  ]) {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    assert.deepEqual(
      findUnguardedFetches(src),
      [],
      `${rel} har ubeskyttet await fetch() igen`,
    );
  }
});
