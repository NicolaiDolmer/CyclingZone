// CI-vagter for evne-registret + visnings-opskrifterne (#3665, spec §D2/§4).
//
// Disse fire tests ER vagterne. De kører i `backend-tests`, som er et required
// check, så en overtrædelse fejler bygningen — det er dét spec'en mener med
// "build fejler", ikke et separat workflow-step.
//
// Vagt 1 er den der ville have fanget §1.6: positioning og tactics indgik i NUL
// af de 8 gamle opskrifter, men påvirker løbene. En spiller kunne træne dem uden
// at se effekt i noget tal, og intet fejlede.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ABILITY_REGISTRY, REGISTRY_ABILITY_KEYS } from "./abilityRegistry.js";
import { DISPLAY_RECIPES, PENDING_DISPLAY_ABILITIES } from "./weights/displayRecipes.js";
import { GENERATED_FILES, normalizeEol } from "../../scripts/generate-ability-registry.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const recipeAbilities = (r) => new Set(Object.keys(r.weights));

// ── Vagt 1 (R4) ──────────────────────────────────────────────────────────────
// #5321: vagten sammenligner nu mod PENDING_DISPLAY_ABILITIES i stedet for mod
// en tom liste. Baggrunden er at det MODSATTE af vagten også er en fejl: #5268
// gav to helt nye evner en vægt for at tilfredsstille vagt 1, selvom ingen
// eksisterende rytter havde en værdi i kolonnerne. Resultatet var at hele
// bestandens synlige rating faldt uden at en eneste rytter var blevet dårligere.
// Sammenligningen er PRÆCIS (ikke "orphans ⊆ pending"), så en evne der falder
// ud af opskrifterne ved et uheld stadig fælder bygningen, og en key der bliver
// stående på pending-listen efter at evnen er kommet ind i en opskrift også gør.
test("#3665 vagt 1: hver evne i registret optræder i mindst én visnings-opskrift (undtagen de bevidst udskudte)", () => {
  const used = new Set(DISPLAY_RECIPES.flatMap((r) => Object.keys(r.weights)));
  const orphans = REGISTRY_ABILITY_KEYS.filter((k) => !used.has(k));
  assert.deepEqual(
    [...orphans].sort(), [...PENDING_DISPLAY_ABILITIES].sort(),
    `Evner uden plads i nogen visnings-opskrift: ${orphans.join(", ") || "(ingen)"}. `
    + "En evne spilleren kan træne uden at se effekt i noget tal er en usynlig evne. "
    + "Giv den en vægt i backend/lib/weights/displayRecipes.js, eller fjern den fra registret. "
    + "Er evnen bevidst udskudt fordi den endnu ikke har værdier på alle ryttere, "
    + "skal den stå i PENDING_DISPLAY_ABILITIES med et ejer-go (#5321)."
  );
});

// #5321: pending-listen må kun nævne evner der findes i registret — ellers
// kunne en stavefejl der stod her have slugt en ægte orphan.
test("#5321 vagt 1b: PENDING_DISPLAY_ABILITIES nævner kun evner der findes i registret", () => {
  const known = new Set(REGISTRY_ABILITY_KEYS);
  const unknown = PENDING_DISPLAY_ABILITIES.filter((k) => !known.has(k));
  assert.deepEqual(unknown, [], `Ukendte keys i PENDING_DISPLAY_ABILITIES: ${unknown.join(", ")}.`);
});

// ── Vagt 2 ───────────────────────────────────────────────────────────────────
test("#3665 vagt 2: hver evne i en opskrift har en registry-post", () => {
  const known = new Set(REGISTRY_ABILITY_KEYS);
  const unknown = [];
  for (const recipe of DISPLAY_RECIPES) {
    for (const ability of Object.keys(recipe.weights)) {
      if (!known.has(ability)) unknown.push(`${recipe.key}.${ability}`);
    }
  }
  assert.deepEqual(
    unknown, [],
    `Opskrifter refererer evner uden registry-post: ${unknown.join(", ")}. `
    + "En stavefejl her ville ellers bare tælle som en manglende evne og trække ratingen skævt."
  );
});

// ── Vagt 3 (#3664 spørgsmål 5) ───────────────────────────────────────────────
test("#3665 vagt 3: ingen visnings-opskrifts evne-sæt er delmængde af en andens", () => {
  // #3592 målte at fire typepar er matematisk uadskillelige, fordi det ene
  // vægt-sæts positive evner er indeholdt i det andets: tt ⊆ gc, puncheur ⊆
  // climber, rouleur ⊆ brostensrytter, rouleur ⊆ baroudeur. Ingen af de fire
  // overlever de nye opskrifter — men det var en SIDEEFFEKT af at hver opskrift
  // blev bredere, ikke et designmål. Denne vagt gør sideeffekten til en regel,
  // så den ikke kan krybe tilbage ubemærket ved en senere vægt-justering.
  const subsets = [];
  for (const a of DISPLAY_RECIPES) {
    for (const b of DISPLAY_RECIPES) {
      if (a.key === b.key) continue;
      const setA = recipeAbilities(a);
      const setB = recipeAbilities(b);
      if ([...setA].every((k) => setB.has(k))) subsets.push(`${a.key} ⊆ ${b.key}`);
    }
  }
  assert.deepEqual(
    subsets, [],
    `Uadskillelige rolle-par: ${subsets.join(", ")}. `
    + "Når én rolles evner er indeholdt i en andens, kan de to roller ikke skelnes "
    + "på et caps-sæt der er formet efter den bredeste af dem (#3592)."
  );
});

// ── Vagt 4 (R5) ──────────────────────────────────────────────────────────────
test("#3665 vagt 4: frontendens evne-filer er genereret fra backend-kilden, ikke håndholdte", () => {
  // Frontend-kopien i riderRating.js VAR drevet da denne vagt blev skrevet
  // (målt 13/8: brostensrytter cobblestone 5 mod backendens 6, puncheur med et
  // climbing:1-krydsled #3325 fjernede, rouleur flat 2 mod 4). Intet fejlede —
  // kopien drev bare stille. Byte-sammenligning er det eneste der fanger det.
  const stale = [];
  for (const { path, render } of GENERATED_FILES) {
    let current = null;
    try { current = readFileSync(path, "utf8"); } catch { /* mangler helt */ }
    // normalizeEol: linjeslutninger er ikke indhold. Uden den ville et Windows-
    // checkout med core.autocrlf=true fejle vagten efter hver rebase (samme
    // fælde som #3570). .gitattributes holder filerne på LF; dette er andet lag.
    if (normalizeEol(current) !== render()) stale.push(path.replace(REPO_ROOT, "."));
  }
  assert.deepEqual(
    stale, [],
    `Genererede frontend-filer er ikke i sync: ${stale.join(", ")}. `
    + "Kør: node scripts/generate-ability-registry.mjs"
  );
});

// ── Registrets egen integritet ───────────────────────────────────────────────
// Antallet er PINNET, ikke afledt: en evne der forsvinder ved et uheld (en dårlig
// merge, en fjernet linje) skal fælde bygningen, ikke bare give et mindre tal.
// Ændres tallet, skal migrationen (DB-kolonnen) og docs følge med i samme PR —
// se docs/HOWTO_ADD_ABILITY.md. 15 → 17 ved #5268 (teamwork + leadership).
const EXPECTED_ABILITY_COUNT = 17;

test("#3665: registret har unikke keys og sammenhængende ordener", () => {
  const keys = ABILITY_REGISTRY.map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length, "dublet-key i registret");
  assert.equal(keys.length, EXPECTED_ABILITY_COUNT,
    `de ${EXPECTED_ABILITY_COUNT} synlige evner skal alle stå i registret`);

  for (const field of ["storageOrder", "displayOrder"]) {
    const orders = ABILITY_REGISTRY.map((a) => a[field]).sort((x, y) => x - y);
    assert.deepEqual(
      orders, Array.from({ length: EXPECTED_ABILITY_COUNT }, (_, i) => i + 1),
      `${field} skal være 1..${EXPECTED_ABILITY_COUNT} uden huller eller dubletter`
    );
  }

  for (const a of ABILITY_REGISTRY) {
    assert.ok(["physical", "technical", "mental"].includes(a.category), `${a.key}: ukendt kategori`);
    assert.ok(a.i18nKey && a.shortLabel && a.icon, `${a.key}: mangler i18nKey/shortLabel/icon`);
    assert.ok(
      a.derivation?.source === "skill"
      || (a.derivation?.source === "pcm" && typeof a.derivation.stat === "string"),
      `${a.key}: derivation skal være { source: "skill" } eller { source: "pcm", stat }`
    );
  }
});
