import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzeMessage, compareMessages, checkNamespace, registeredLanguages } from "./i18n-check-key-parity.mjs";

const SCRIPT = fileURLToPath(new URL("./i18n-check-key-parity.mjs", import.meta.url));

function languagesJs(codes) {
  return "export const LANGUAGES = [\n" + codes.map((c) => `  { code: "${c}", label: "${c}" },`).join("\n") + "\n];\n";
}

function makeRoot(t, registered, locales) {
  const root = mkdtempSync(join(tmpdir(), "i18n-key-parity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "frontend/src/i18n"), { recursive: true });
  writeFileSync(join(root, "frontend/src/i18n/languages.js"), languagesJs(registered));
  for (const [lng, namespaces] of Object.entries(locales)) {
    const dir = join(root, "frontend/public/locales", lng);
    mkdirSync(dir, { recursive: true });
    for (const [ns, data] of Object.entries(namespaces)) writeFileSync(join(dir, `${ns}.json`), JSON.stringify(data));
  }
  return root;
}

function run(root, ...extra) {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root, ...extra], { encoding: "utf8" });
  return { status: r.status, output: r.stdout + r.stderr };
}

const EN = { common: { greeting: "Hello {name}", items: "{count, plural, one {# item} other {# items}}", bold: "Press <b>save</b>" } };

test("registeredLanguages reads codes from languages.js", () => {
  assert.deepEqual(registeredLanguages(languagesJs(["en", "da", "fr"])), ["en", "da", "fr"]);
});

test("analyzeMessage finds placeholders, plural arms and tags", () => {
  const a = analyzeMessage("Hi {name}, {n, plural, =0 {none} one {# <b>x</b>} other {# xs}}<br/>");
  assert.ok(a.args.has("name|simple"));
  assert.ok(a.args.has("n|plural"));
  assert.ok(a.args.has("n|simple"));
  assert.deepEqual([...a.arms.get("n|plural")].sort(), ["=0", "one", "other"]);
  assert.deepEqual(a.tags, ["close:b", "open:b", "self:br"]);
});

test("identical message has no problems", () => {
  assert.deepEqual(compareMessages(EN.common.items, "{count, plural, one {# stk} other {# stk}}"), []);
});

test("wrong placeholder name is reported both ways", () => {
  const p = compareMessages("Hello {name}", "Hej {navn}");
  assert.ok(p.some((x) => x.includes("{name} missing")));
  assert.ok(p.some((x) => x.includes("{navn} not in en")));
});

test("missing plural form is reported, extra CLDR category is allowed", () => {
  assert.ok(compareMessages(EN.common.items, "{count, plural, one {# stk}}").some((x) => x.includes('"other" missing')));
  assert.deepEqual(compareMessages(EN.common.items, "{count, plural, one {#} few {#} many {#} other {#}}"), []);
});

test("select arms must match exactly", () => {
  const p = compareMessages("{g, select, m {He} f {She} other {They}}", "{g, select, m {Han} other {De}}");
  assert.ok(p.some((x) => x.includes('"f" missing')));
});

test("tag mismatch is reported", () => {
  assert.ok(compareMessages("Press <b>save</b>", "Tryk save").some((x) => x.includes("HTML tags differ")));
  assert.deepEqual(compareMessages("Press <b>save</b>", "Tryk <b>gem</b>"), []);
});

test("apostrophe-escaped braces are not placeholders", () => {
  assert.deepEqual(analyzeMessage("Use '{'name'}' literally").tags, []);
  assert.equal(analyzeMessage("Use '{'name'}' literally").args.size, 0);
});

test("checkNamespace: missing and extra key", () => {
  const p = checkNamespace({ a: "x", b: "y" }, { a: "x", c: "z" });
  assert.ok(p.includes('missing key "b"'));
  assert.ok(p.includes('extra key "c" (not in en)'));
});

test("checkNamespace: i18next plural suffix forms", () => {
  const en = { n_one: "{count} thing", n_other: "{count} things" };
  assert.ok(checkNamespace(en, { n_one: "{count} ting" }).some((x) => x.includes("_other")));
  assert.deepEqual(checkNamespace(en, { n_one: "{count} ting", n_other: "{count} ting", n_few: "{count} ting" }), []);
});

test("checkNamespace: plural forms with empty or null values are rejected", () => {
  const en = { n_one: "thing", n_other: "things" };
  assert.ok(checkNamespace(en, { n_one: "", n_other: null }).length >= 2);
});

test("repeated markup in an extra plural arm is allowed", () => {
  assert.deepEqual(compareMessages("{n, plural, one {<b>#</b>} other {<b>#</b>}}", "{n, plural, one {<b>#</b>} few {<b>#</b>} other {<b>#</b>}}"), []);
});

test("checkNamespace: a lone _many key is an ordinary key, not a plural form", () => {
  assert.deepEqual(checkNamespace({ too_many: "Max {max}" }, { too_many: "Hojst {max}" }), []);
});

test("checkNamespace: empty value is fine when en is empty too, not otherwise", () => {
  assert.deepEqual(checkNamespace({ p: "" }, { p: "" }), []);
  assert.ok(checkNamespace({ p: "Hi" }, { p: "" }).length > 0);
  assert.ok(checkNamespace({ p: "Hi" }, { p: "__MISSING__" }).length > 0);
});

test("CLI: perfect new language passes", (t) => {
  const root = makeRoot(t, ["en", "fr"], { en: EN, fr: { common: { greeting: "Bonjour {name}", items: "{count, plural, one {# objet} other {# objets}}", bold: "Appuyez sur <b>sauver</b>" } } });
  const r = run(root);
  assert.equal(r.status, 0, r.output);
});

test("CLI: registered new language with a missing key blocks", (t) => {
  const root = makeRoot(t, ["en", "fr"], { en: EN, fr: { common: { greeting: "Bonjour {name}" } } });
  const r = run(root);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /\[fr\] common: missing key "items"/);
});

test("CLI: registered new language with wrong placeholder blocks", (t) => {
  const root = makeRoot(t, ["en", "fr"], { en: EN, fr: { common: { greeting: "Bonjour {nom}", items: EN.common.items, bold: "<b>x</b>" } } });
  const r = run(root);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /placeholder \{name\} missing/);
});

test("CLI: registered language without locale folder blocks", (t) => {
  const root = makeRoot(t, ["en", "fr"], { en: EN });
  const r = run(root);
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /no locale folder/);
});

test("CLI: unregistered WIP language never blocks", (t) => {
  const root = makeRoot(t, ["en"], { en: EN, nl: { common: { greeting: "Hallo" } } });
  const r = run(root);
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /not registered, WIP/);
});

test("CLI: pseudo-locale en-XA is exempt", (t) => {
  const root = makeRoot(t, ["en"], { en: EN, "en-XA": { common: { greeting: "x" } } });
  const r = run(root);
  assert.equal(r.status, 0, r.output);
  assert.doesNotMatch(r.output, /en-XA/);
});

test("CLI: already-live da only warns, --strict blocks", (t) => {
  const root = makeRoot(t, ["en", "da"], { en: EN, da: { common: { greeting: "Hej {navn}", items: EN.common.items, bold: "<b>x</b>" } } });
  const warn = run(root);
  assert.equal(warn.status, 0, warn.output);
  assert.match(warn.output, /warn: \[da\]/);
  const strict = run(root, "--strict");
  assert.equal(strict.status, 1, strict.output);
});

test("compareMessages: exact plural selectors (=0, =1) must be kept in the target (#6806)", () => {
  const src = "{n, plural, =0 {none} =1 {one item} other {# items}}";
  const dropped = compareMessages(src, "{n, plural, one {# stk} other {# stk}}");
  assert.ok(dropped.some((x) => x.includes('"=0" missing')), dropped.join("; "));
  assert.ok(dropped.some((x) => x.includes('"=1" missing')), dropped.join("; "));
  assert.deepEqual(compareMessages(src, "{n, plural, =0 {ingen} =1 {en ting} other {# ting}}"), []);
  // a target may add its own exact selectors or CLDR categories
  assert.deepEqual(compareMessages(src, "{n, plural, =0 {ingen} =1 {en} =2 {to} few {#} other {#}}"), []);
  // en without exact selectors: nothing extra is demanded
  assert.deepEqual(compareMessages("{n, plural, one {#} other {#}}", "{n, plural, one {#} other {#}}"), []);
});

test("compareMessages: exact selectors are checked for i18next plural-suffix forms too (#6806)", () => {
  const en = { n_one: "{n, plural, =0 {none} other {#}}", n_other: "{n, plural, =0 {none} other {#}}" };
  const bad = { n_one: "{n, plural, other {#}}", n_other: "{n, plural, =0 {ingen} other {#}}" };
  assert.ok(checkNamespace(en, bad).some((x) => x.includes('"n_one"') && x.includes('"=0" missing')));
});

test("compareMessages: unmatched closing brace at top level is a syntax error (#6806)", () => {
  assert.ok(compareMessages("Hi {name}", "Hej {name}}").some((p) => p.includes("unmatched closing brace")));
  assert.ok(compareMessages("Hi {name}", "Hej } {name}").some((p) => p.includes("unmatched closing brace")));
  const src = "{count, plural, one {# item} other {# items}}";
  assert.ok(compareMessages(src, "{count, plural, one {# ting} other {# ting}}}").some((p) => p.includes("unmatched closing brace")));
  // balanced messages and apostrophe-escaped braces stay clean
  assert.deepEqual(compareMessages("Hi {name}", "Hej {name}"), []);
  assert.deepEqual(compareMessages("Use '{'name'}'", "Brug '{'navn'}'"), []);
  assert.equal(analyzeMessage("Hej '}' verden").strayClose, false);
  // not blamed on the target when en already has the same defect
  assert.deepEqual(compareMessages("Hi } {name}", "Hej } {name}"), []);
});

test("compareMessages: missing comma after plural/select type is a syntax error (#6806)", () => {
  const src = "{count, plural, one {# item} other {# items}}";
  const plural = compareMessages(src, "{count, plural one {# ting} other {# ting}}");
  assert.ok(plural.some((p) => p.includes("missing comma")), plural.join("; "));
  const select = compareMessages("{g, select, m {He} other {They}}", "{g, select m {Han} other {De}}");
  assert.ok(select.some((p) => p.includes("missing comma")), select.join("; "));
  const ordinal = compareMessages("{n, selectordinal, one {#st} other {#th}}", "{n, selectordinal one {#.} other {#.}}");
  assert.ok(ordinal.some((p) => p.includes("missing comma")), ordinal.join("; "));
  // with the comma, and with newlines/extra spaces around it, it is clean
  assert.deepEqual(compareMessages(src, "{count, plural, one {# ting} other {# ting}}"), []);
  assert.deepEqual(compareMessages(src, "{count , plural ,one {# ting} other {# ting}}"), []);
});

test("CLI: registered language with =0 dropped, stray brace or missing comma blocks (#6806)", (t) => {
  const en = { common: { items: "{n, plural, =0 {none} other {# items}}", hi: "Hi {name}" } };
  const cases = [
    [{ items: "{n, plural, other {# stk}}", hi: "Hej {name}" }, /"=0" missing/],
    [{ items: "{n, plural, =0 {ingen} other {# stk}}", hi: "Hej {name}}" }, /unmatched closing brace/],
    [{ items: "{n, plural =0 {ingen} other {# stk}}", hi: "Hej {name}" }, /missing comma/],
  ];
  for (const [common, pattern] of cases) {
    const root = makeRoot(t, ["en", "fr"], { en, fr: { common } });
    const r = run(root);
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, pattern);
  }
});

test("compareMessages: unterminated ICU target fails even when arms match (#6597 Codex)", () => {
  const src = "{count, plural, one {# item} other {# items}}";
  const problems = compareMessages(src, "{count, plural, one {# ting} other {# ting}");
  assert.ok(problems.some((p) => p.includes("unbalanced")), problems.join("; "));
  assert.deepEqual(compareMessages(src, "{count, plural, one {# ting} other {# ting}}"), []);
  assert.ok(compareMessages("Hi {name}", "Hej {name").some((p) => p.includes("unbalanced")));
  assert.ok(compareMessages("{n, number, integer}", "{n, number, integer").some((p) => p.includes("unbalanced")));
});

test("compareMessages: doubled apostrophe inside a quoted ICU section is a literal (Codex #6825)", () => {
  assert.deepEqual(compareMessages("Use '{foo isn''t bar}' now", "Brug '{foo isn''t bar}' nu"), []);
  assert.ok(compareMessages("Hi {name}", "Hej {name}}").some((p) => p.includes("unmatched closing brace")));
});
