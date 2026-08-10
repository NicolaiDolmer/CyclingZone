// Forward-guard-test for #3570/#3588 — beviser at guarden i
// scripts/lintRiderTypeWrites.js FANGER en ny skrivesti til riders.primary_type
// der omgår resolveRiderTypes, og at den er GRØN på det repo vi står med.
//
// Struktur (samme kontrakt som nattens porte: en port uden negativ-test er ikke
// leveret):
//   • POSITIV KONTROL — hele backend-korpuset scanner rent.
//   • NEGATIV-TEST 1 — den KENDTE HISTORISKE DEFEKT: runRiderTypesBackfill's
//     krop som den så ud FØR denne PR (computeRiderTypes fra caps, intet
//     archetype_draw). Guarden skal fejle på den.
//   • NEGATIV-TEST 2-5 — syntetiske overtrædelser (direkte kald, ny fil,
//     fjernet identitets-kald, opt-out uden dækning).
//   • MASKERINGS-TESTS — en `.select("id, primary_type")`-streng eller en
//     kommentar må ALDRIG tælle som en objekt-nøgle (ellers er guarden støj).

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKEND_ROOT,
  TYPE_WRITE_FILES,
  IDENTITY_ANCHORS,
  OPT_OUT,
  maskNonCode,
  findTypeKeySites,
  findClassifierBindings,
  findClassifierDerivedTypeWrites,
  findRidersWrites,
  functionBody,
  scanBackend,
} from "./lintRiderTypeWrites.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── POSITIV KONTROL ─────────────────────────────────────────────────────────

test("guarden er grøn på backend-korpuset som det står", () => {
  const res = scanBackend(BACKEND_ROOT);
  assert.deepEqual(res.sourceFindings, [], "klassifikator-afledte type-writes");
  assert.deepEqual(res.unknownWriters, [], "udokumenterede skrivesti-filer");
  assert.deepEqual(res.staleAllowlist, [], "forældede allowlist-poster");
  assert.deepEqual(res.anchorFindings, [], "identitets-ankre");
});

test("inventaret matcher den dokumenterede allowlist præcist", () => {
  const res = scanBackend(BACKEND_ROOT);
  assert.deepEqual(res.inventory.sort(), Object.keys(TYPE_WRITE_FILES).sort());
});

test("alle tre identitets-ankre kalder faktisk resolveRiderTypes", () => {
  for (const anchor of IDENTITY_ANCHORS) {
    const masked = maskNonCode(readFileSync(join(BACKEND_ROOT, anchor.file), "utf8"));
    const body = functionBody(masked, anchor.fn);
    assert.ok(body, `${anchor.file}: ${anchor.fn} findes`);
    assert.match(body, /resolveRiderTypes\(/, `${anchor.file}: ${anchor.fn}`);
  }
});

// ── NEGATIV-TEST 1: den kendte historiske defekt ────────────────────────────
// Ordret den kode der stod i backfillCores.js fra #1103 til denne PR — det
// tredje skrivested K1's verifikator fandt. Guarden SKAL fejle på den.

const HISTORICAL_DEFECT = `
import { computeRiderTypes } from "./riderTypes.js";

export async function runRiderTypesBackfill(supabase, { dryRun = true } = {}) {
  const rows = await fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select("rider_id, ability_caps, riders!inner(id, birthdate)")
      .order("rider_id"));
  const updates = rows.map((r) => {
    const age = ageForSeason(r.riders?.birthdate, seasonNumber);
    const rowModel = selectTypesBaseline(age, model, youthModel);
    const { primary, secondary } = computeRiderTypes(r.ability_caps || {}, rowModel);
    return { id: r.rider_id, primary_type: primary.key, secondary_type: secondary.key };
  });
  if (dryRun) return { riders: rows.length, written: 0 };
  await supabase.from("riders").update(updates[0]).eq("id", updates[0].id);
  return { riders: rows.length, written: updates.length };
}
`;

test("NEGATIV: guarden fanger den historiske defekt (runRiderTypesBackfill før #3588-hullet blev lukket)", () => {
  const findings = findClassifierDerivedTypeWrites(HISTORICAL_DEFECT, "lib/backfillCores.js");
  assert.equal(findings.length, 2, "primary_type + secondary_type skal begge fanges");
  assert.deepEqual(findings.map((f) => f.column).sort(), ["primary_type", "secondary_type"]);
  for (const f of findings) assert.match(f.reason, /computeRiderTypes\(\)/);
});

test("POSITIV: samme funktion med resolveRiderTypes er ren", () => {
  const fixed = HISTORICAL_DEFECT
    .replace("computeRiderTypes(r.ability_caps", "resolveRiderTypes(r.riders?.archetype_draw, r.ability_caps")
    .replace('import { computeRiderTypes }', 'import { resolveRiderTypes }');
  assert.deepEqual(findClassifierDerivedTypeWrites(fixed, "lib/backfillCores.js"), []);
});

// ── NEGATIV-TEST 2: direkte kald i værdien ──────────────────────────────────

test("NEGATIV: primary_type: computeRiderTypes(...).primary.key fanges", () => {
  const src = `
const patch = { id: r.id, primary_type: computeRiderTypes(caps, model).primary.key };
await supabase.from("riders").update(patch).eq("id", r.id);
`;
  const findings = findClassifierDerivedTypeWrites(src, "lib/fake.js");
  assert.equal(findings.length, 1);
  assert.match(findings[0].reason, /kaldt direkte/);
});

test("POSITIV: samme udtryk med resolveRiderTypes er rent", () => {
  const src = `
const patch = { id: r.id, primary_type: resolveRiderTypes(r.archetype_draw, caps, model).primary.key };
await supabase.from("riders").update(patch).eq("id", r.id);
`;
  assert.deepEqual(findClassifierDerivedTypeWrites(src, "lib/fake.js"), []);
});

// ── NEGATIV-TEST 3: opt-out ─────────────────────────────────────────────────

test("opt-out-markøren neutraliserer et bevidst ikke-persisteret gæt", () => {
  const src = `
const { primary, secondary } = computeRiderTypes(abilities, NEUTRAL_BASELINE);
// ${OPT_OUT}: bootstrap til caps-formning, skrives aldrig.
const t = { primary_type: primary.key, secondary_type: secondary.key };
`;
  assert.deepEqual(findClassifierDerivedTypeWrites(src, "lib/fake.js"), []);
});

test("opt-out på en ANDEN objekt-literal dækker ikke overtrædelsen", () => {
  const src = `
const { primary, secondary } = computeRiderTypes(abilities, NEUTRAL_BASELINE);
// ${OPT_OUT}: kun dette gæt er harmløst.
const bootstrap = { primary_type: primary.key };
const patch = { id: r.id, primary_type: primary.key, secondary_type: secondary.key };
await supabase.from("riders").update(patch).eq("id", r.id);
`;
  const findings = findClassifierDerivedTypeWrites(src, "lib/fake.js");
  assert.equal(findings.length, 2, "patch-literalen er ikke markeret og skal fanges");
});

// ── NEGATIV-TEST 4: hele korpus-scanningen på et syntetisk repo ─────────────
// Beviser at INVENTAR-checket fanger en HELT NY fil der begynder at skrive
// typen — den fejlform en funktions-lokal regel ikke kan se.

function makeCorpus(files) {
  const root = mkdtempSync(join(tmpdir(), "cz-type-guard-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return root;
}

const CLEAN_WRITER = `
import { resolveRiderTypes } from "./riderTypes.js";
export function sweep(supabase, rows) {
  return rows.map((r) => {
    const { primary, secondary } = resolveRiderTypes(r.archetype_draw, r.ability_caps, model);
    const patch = { primary_type: primary.key, secondary_type: secondary.key };
    return supabase.from("riders").update(patch).eq("id", r.id);
  });
}
`;

const ROGUE_WRITER = `
import { computeRiderTypes } from "./riderTypes.js";
export function rogueSweep(supabase, rows) {
  return rows.map((r) => {
    const { primary, secondary } = computeRiderTypes(r.ability_caps, model);
    const patch = { primary_type: primary.key, secondary_type: secondary.key };
    return supabase.from("riders").update(patch).eq("id", r.id);
  });
}
`;

test("NEGATIV: en ny fil der skriver typen dukker op som ukendt skrivesti", () => {
  const root = makeCorpus({
    "lib/cleanWriter.js": CLEAN_WRITER,
    "lib/rogueWriter.js": ROGUE_WRITER,
  });
  try {
    const res = scanBackend(root, {
      anchors: [],
      allowlist: { "lib/cleanWriter.js": "kendt, bruger resolveRiderTypes" },
    });
    assert.deepEqual(res.inventory.sort(), ["lib/cleanWriter.js", "lib/rogueWriter.js"]);
    assert.deepEqual(res.unknownWriters, ["lib/rogueWriter.js"]);
    assert.equal(res.sourceFindings.length, 2, "og KILDE-checket fanger den også");
    assert.ok(res.sourceFindings.every((f) => f.file === "lib/rogueWriter.js"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("POSITIV: samme korpus uden den skæve fil er rent", () => {
  const root = makeCorpus({ "lib/cleanWriter.js": CLEAN_WRITER });
  try {
    const res = scanBackend(root, {
      anchors: [],
      allowlist: { "lib/cleanWriter.js": "kendt, bruger resolveRiderTypes" },
    });
    assert.deepEqual(res.unknownWriters, []);
    assert.deepEqual(res.staleAllowlist, []);
    assert.deepEqual(res.sourceFindings, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── NEGATIV-TEST 5: anker der mister sit identitets-kald ────────────────────

test("NEGATIV: et anker der holder op med at kalde resolveRiderTypes fanges", () => {
  const root = makeCorpus({
    "lib/sweep.js": ROGUE_WRITER,
  });
  try {
    const res = scanBackend(root, {
      anchors: [{ file: "lib/sweep.js", fn: "rogueSweep" }],
      allowlist: { "lib/sweep.js": "midlertidig fixture" },
    });
    assert.equal(res.anchorFindings.length, 1);
    assert.match(res.anchorFindings[0].problem, /kalder ikke resolveRiderTypes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("NEGATIV: et anker der forsvinder fanges", () => {
  const root = makeCorpus({ "lib/sweep.js": CLEAN_WRITER });
  try {
    const res = scanBackend(root, {
      anchors: [{ file: "lib/sweep.js", fn: "someRemovedFunction" }],
      allowlist: { "lib/sweep.js": "midlertidig fixture" },
    });
    assert.equal(res.anchorFindings.length, 1);
    assert.match(res.anchorFindings[0].problem, /findes ikke/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── MASKERING: guarden må ikke være støj ────────────────────────────────────

test("en select-streng med primary_type er IKKE en objekt-nøgle", () => {
  // pagination-safe: fixture-tekst til den statiske scanner, aldrig en DB-query.
  const src = `const q = supabase.from("riders").select("id, primary_type, secondary_type");`;
  assert.deepEqual(findTypeKeySites(maskNonCode(src)), []);
});

test("primary_type i en kommentar tæller ikke", () => {
  const src = `
// vi sætter primary_type: primary.key her en dag
/* eller { primary_type: computeRiderTypes(x).primary.key } */
const x = 1;
`;
  assert.deepEqual(findTypeKeySites(maskNonCode(src)), []);
  assert.deepEqual(findClassifierDerivedTypeWrites(src, "lib/fake.js"), []);
});

test("maskering bevarer linjenumre og lader kode i ${} stå", () => {
  const src = [
    'const a = "primary_type:";',
    "const b = `x ${primary.key} y`;",
    "const c = { primary_type: primary.key };",
  ].join("\n");
  const masked = maskNonCode(src);
  assert.equal(masked.split("\n").length, 3);
  assert.match(masked.split("\n")[1], /primary\.key/, "${…} bevares som kode");
  const sites = findTypeKeySites(masked);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].column, "primary_type");
});

test("en regex-literal med et apostrof-tegn ryster ikke maskeringen", () => {
  const src = [
    "const re = /['\"]/g;",
    "const c = { primary_type: primary.key };",
  ].join("\n");
  const sites = findTypeKeySites(maskNonCode(src));
  assert.equal(sites.length, 1);
});

test("findRidersWrites ser update/insert/upsert på riders — og kun der", () => {
  assert.equal(findRidersWrites(`supabase.from("riders").update(p).eq("id", 1)`).length, 1);
  assert.equal(findRidersWrites(`supabase.from("riders").insert(rows)`).length, 1);
  // pagination-safe: fixture-tekst til den statiske scanner, aldrig en DB-query.
  assert.equal(findRidersWrites(`supabase.from("riders").select("id")`).length, 0);
  assert.equal(findRidersWrites(`supabase.from("teams").update(p)`).length, 0);
});

test("findClassifierBindings skelner de to kilder og deres rækkefølge", () => {
  const src = [
    "const { primary, secondary } = computeRiderTypes(a, m);",
    "const { primary: p2 } = resolveRiderTypes(d, caps, m);",
    "const derived = computeRiderTypes(a, m).primary.key;",
  ].join("\n");
  const b = findClassifierBindings(maskNonCode(src));
  assert.deepEqual(
    b.map((x) => `${x.name}:${x.source}`),
    ["primary:computeRiderTypes", "secondary:computeRiderTypes", "p2:resolveRiderTypes", "derived:computeRiderTypes"],
  );
});

test("scanneren ligger hvor CI kan finde den", () => {
  assert.ok(readFileSync(join(__dirname, "lintRiderTypeWrites.js"), "utf8").includes("scanBackend"));
});
