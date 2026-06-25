// PGlite-sanitizer (#1840 pre-live contract-harness, Part B).
//
// Den ægte committede DDL (database/*.sql) indeholder Supabase-/Postgres-isms som
// PGlite (in-memory Postgres uden Supabase-laget) ikke kan køre — eller som er
// irrelevante for de kolonne-KONTRAKT-tests vi loader skemaet for. Denne rene
// funktion strippper netop de statements, men BEVARER al strukturel DDL
// (CREATE TABLE, ALTER TABLE ... ADD COLUMN, CHECK-constraints, INDEX), så et
// select af en ikke-eksisterende kolonne (fx riders.overall) stadig fejler mod
// det loadede skema. Det er hele fidelitets-beviset bag #1840.
//
// Strip-listen (statement-leadende mønstre):
//   - CREATE POLICY / DROP POLICY                — RLS-policies (PGlite har RLS, men
//                                                  policy-bodies bruger auth.uid() mm.)
//   - ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY
//   - GRANT / REVOKE                             — kolonne-/tabel-privilegier
//   - CREATE EXTENSION                           — fx "uuid-ossp" (ikke i PGlite)
//   - COMMENT ON ...                             — ren dokumentation, irrelevant
//
// Vigtigt: vi rører IKKE ALTER TABLE der tilføjer kolonner/constraints — kun den
// specifikke ENABLE/DISABLE ROW LEVEL SECURITY-variant fjernes.

/**
 * Split rå SQL i top-level statements på `;`, men respektér single-quote-literaler
 * (med '' escape), dollar-quotes ($$ ... $$ / $tag$ ... $tag$) og kommentarer
 * (-- til linjeslut samt blok-kommentarer), så et semikolon inde i en literal
 * eller krop ikke fejlagtigt splitter et statement.
 *
 * @param {string} sql
 * @returns {string[]} statements UDEN det afsluttende semikolon (whitespace bevaret)
 */
function splitStatements(sql) {
  const statements = [];
  let buf = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Linje-kommentar: -- ... \n
    if (ch === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }

    // Blok-kommentar: /* ... */
    if (ch === "/" && next === "*") {
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }

    // Single-quote-literal (med '' som escape)
    if (ch === "'") {
      buf += ch;
      i += 1;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          buf += "''";
          i += 2;
          continue;
        }
        buf += sql[i];
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Dollar-quote: $$ ... $$ eller $tag$ ... $tag$
    if (ch === "$") {
      const tagMatch = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        buf += sql.slice(i, end);
        i = end;
        continue;
      }
    }

    if (ch === ";") {
      statements.push(buf);
      buf = "";
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }

  if (buf.trim() !== "") statements.push(buf);
  return statements;
}

/**
 * Returnér true hvis statementet skal STRIPPES (PGlite kan ikke / vi vil ikke køre det).
 * Matcher på det første SQL-nøgleord efter ledende kommentarer/whitespace.
 *
 * @param {string} stmt et enkelt statement (uden afsluttende `;`)
 * @returns {boolean}
 */
function shouldStrip(stmt) {
  // Fjern ledende linje-/blok-kommentarer + whitespace, så vi matcher på det
  // reelle statement-nøgleord (DDL i repoet har ofte en kommentar lige foran).
  const code = stmt
    .replace(/\/\*[\s\S]*?\*\//g, " ") // blok-kommentarer
    .replace(/--[^\n]*/g, " ") // linje-kommentarer
    .replace(/\s+/g, " ")
    .trim();

  if (code === "") return false; // tom (kun kommentar/whitespace) — bevar ikke, men heller ikke "strip"

  // CREATE [OR REPLACE] POLICY  /  DROP POLICY
  if (/^CREATE\s+POLICY\b/i.test(code)) return true;
  if (/^DROP\s+POLICY\b/i.test(code)) return true;

  // ALTER TABLE ... ENABLE|DISABLE ROW LEVEL SECURITY  (KUN den variant — ikke ADD COLUMN)
  if (/^ALTER\s+TABLE\b[\s\S]*\b(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/i.test(code)) return true;

  // GRANT ... / REVOKE ...
  if (/^GRANT\b/i.test(code)) return true;
  if (/^REVOKE\b/i.test(code)) return true;

  // CREATE EXTENSION ...
  if (/^CREATE\s+EXTENSION\b/i.test(code)) return true;

  // COMMENT ON TABLE|COLUMN|... IS ...
  if (/^COMMENT\s+ON\b/i.test(code)) return true;

  return false;
}

/**
 * Strip Supabase-/PGlite-inkompatible statements fra en SQL-streng, mens al
 * strukturel DDL bevares. Ren funktion — muterer ikke input.
 *
 * @param {string} sql
 * @returns {string} saneret SQL (statements adskilt af `;\n`)
 */
export function sanitizeForPglite(sql) {
  if (typeof sql !== "string") {
    throw new TypeError(`sanitizeForPglite: forventede string, fik ${typeof sql}`);
  }
  const kept = [];
  for (const stmt of splitStatements(sql)) {
    if (stmt.trim() === "") continue;
    if (shouldStrip(stmt)) continue;
    kept.push(stmt.trim());
  }
  // Afslut hvert statement med `;` igen så db.exec kan køre dem i serie.
  return kept.map((s) => `${s};`).join("\n");
}

export default sanitizeForPglite;
