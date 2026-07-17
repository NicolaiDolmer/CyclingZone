// #2598 · Delt, projektion-aware fake-supabase-helper til backend-tests.
// ========================================================================
// Kilde: backwards-check-companion til #2473 (auto-accept datatab, #2469).
// Fixet der afslørede at test-fake'erne var MERE large end databasen: de
// ignorerede select()-kolonnelisten og serverede hele rækken uanset hvad
// koden bad om. Det gjorde en hel bug-klasse usynlig — et kaldested der
// henter en smal select og læser `existingBoard?.x ?? <default>` ser i
// PROD `undefined ?? default` (datatab), men i test den fulde kolonne, så
// upserten ser korrekt ud selvom prod nulstiller en optjent værdi.
//
// Filtrering (.eq/.in/...) sker fortsat på den FULDE række, som i Postgres
// — kun outputtet (det queryen faktisk "sender over wire") projiceres ned
// til de kolonner der blev bedt om via .select(cols).
//
// To fabrikker eksporteres:
//   - createFakeSupabase(state, options) — fuldt filtrerende fake (select/
//     eq/in/gte/lte/gt/lt/is/neq/order/limit/single/maybeSingle +
//     insert/update/upsert/delete). Brug til tests der lader koden faktisk
//     læse/skrive tilstand.
//   - createRecorderSupabase(tableData, recorder) — "canned" variant der
//     ALTID returnerer de forudindstillede rækker pr. tabel (ingen reel
//     server-side filtrering) men REGISTRERER hvert filter-kald i
//     `recorder`, så tests kan assertere på hvilke filtre koden anvendte.
//     Bruges hvor testen selv styrer nøjagtigt hvilke rækker der kommer
//     tilbage (fx boardGoalContext.test.js).
//
// Begge er projektion-aware via samme parseSelectColumns/projectRow.

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Parser en PostgREST-agtig select-streng til en liste af TOP-LEVEL
 * output-nøgler. Respekterer parentes-dybde ved komma-splitting (så
 * embedded resources som "races!inner(race_class, race_type)" ikke
 * knækker splittet), og udleder output-nøglen for hvert token:
 *   - "alias:col(...)"  → "alias"  (embedded resource med alias)
 *   - "col!hint(...)"   → "col"    (embedded resource med join-hint)
 *   - "col(...)"        → "col"    (embedded resource uden hint)
 *   - "col"              → "col"    (almindelig kolonne)
 * @param {string|null|undefined} columns
 * @returns {string[]|null} null betyder "*"/tom → ingen projektion (fuld række)
 */
export function parseSelectColumns(columns) {
  if (!columns || columns === "*") return null;

  const tokens = [];
  let depth = 0;
  let current = "";
  for (const ch of String(columns)) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) tokens.push(current);

  // "*, team:team_id(...)" mixes "all base columns" with an embedded
  // resource. Base-row fields aren't individually enumerable here (the
  // fake's rows already carry the join inline), so treat any bare "*"
  // token as "no projection" — same as a plain "*" select.
  if (tokens.some((token) => token.trim() === "*")) return null;

  return tokens
    .map((token) => {
      let key = token.trim();
      const aliasMatch = key.match(/^(\w+)\s*:/);
      if (aliasMatch) return aliasMatch[1];
      const parenIdx = key.indexOf("(");
      if (parenIdx >= 0) key = key.slice(0, parenIdx);
      const bangIdx = key.indexOf("!");
      if (bangIdx >= 0) key = key.slice(0, bangIdx);
      return key.trim();
    })
    .filter(Boolean);
}

/**
 * Projicerer en enkelt række ned til de kolonner en select() bad om.
 * `columns === null` (fra parseSelectColumns) betyder "*" → hele rækken.
 * @param {object|null} row
 * @param {string[]|null} columns
 */
export function projectRow(row, columns) {
  if (!row || columns === null) return row;
  const out = {};
  for (const col of columns) {
    if (Object.prototype.hasOwnProperty.call(row, col)) out[col] = row[col];
  }
  return out;
}

const FILTER_MATCHERS = {
  eq: (row, col, value) => row[col] === value,
  neq: (row, col, value) => row[col] !== value,
  in: (row, col, value) => Array.isArray(value) && value.includes(row[col]),
  gte: (row, col, value) => row[col] >= value,
  lte: (row, col, value) => row[col] <= value,
  gt: (row, col, value) => row[col] > value,
  lt: (row, col, value) => row[col] < value,
  is: (row, col, value) => row[col] === value,
};

/**
 * Fuldt filtrerende, projektion-aware fake Supabase-klient.
 *
 * @param {object} initialState — { tableName: [row, ...] }
 * @param {object} [options]
 * @param {object} [options.errors] — { tableName: { action: "fejlbesked" } }.
 *   Simulerer en {data:null, error} for den givne tabel+action (select/
 *   insert/update/upsert/delete). Erstatter de tidligere ad-hoc
 *   failInsertOn/errorTables-varianter.
 * @returns {{ state: object, from: (table: string) => object }}
 */
export function createFakeSupabase(initialState = {}, options = {}) {
  // Bevidst INGEN clone her: mange kaldere holder deres egen reference til
  // det state-objekt de sendte ind og asserterer direkte på den (fx
  // `state.board_profiles[0].satisfaction` efter kørsel) — matcher
  // reference-implementationen i boardAutoAccept.test.js (#2473). Kun
  // læse-/skriveresultater (de data der "sendes over wire") klones.
  const state = initialState;
  const errors = options.errors ?? {};

  function ensureTable(table) {
    if (!state[table]) state[table] = [];
    return state[table];
  }

  function errorFor(table, action) {
    const message = errors[table]?.[action];
    return message ? { message } : null;
  }

  function makeQuery(table, action, payload = null, writeOpts = {}) {
    const filters = [];
    let order = null;
    let limit = null;
    let projection = null;

    function matches(row) {
      return filters.every(({ type, column, value }) => FILTER_MATCHERS[type](row, column, value));
    }

    function shapeOutput(rows) {
      let result = rows;
      if (order) {
        result = [...result].sort((a, b) => {
          const av = a[order.column];
          const bv = b[order.column];
          if (av === bv) return 0;
          const cmp = av < bv ? -1 : 1;
          return order.ascending ? cmp : -cmp;
        });
      }
      if (limit != null) result = result.slice(0, limit);
      return clone(result).map((row) => projectRow(row, projection));
    }

    function nextId() {
      return `${table}-${Math.random().toString(36).slice(2, 9)}`;
    }

    function execute() {
      const rows = ensureTable(table);
      const failure = errorFor(table, action);
      if (failure) return Promise.resolve({ data: null, error: failure });

      if (action === "select") {
        return Promise.resolve({ data: shapeOutput(rows.filter(matches)), error: null });
      }

      if (action === "insert") {
        const incoming = Array.isArray(payload) ? payload : [payload];
        const inserted = incoming.map((row) => ({ id: row.id ?? nextId(), ...clone(row) }));
        rows.push(...inserted);
        return Promise.resolve({ data: shapeOutput(inserted), error: null });
      }

      if (action === "update") {
        const updated = [];
        for (const row of rows) {
          if (matches(row)) {
            Object.assign(row, clone(payload));
            updated.push(row);
          }
        }
        return Promise.resolve({ data: shapeOutput(updated), error: null });
      }

      if (action === "upsert") {
        const conflictKeys = (writeOpts.onConflict ?? "id").split(",").map((k) => k.trim());
        const incoming = Array.isArray(payload) ? payload : [payload];
        const result = [];
        for (const row of incoming) {
          const existing = rows.find((existingRow) =>
            conflictKeys.every((key) => existingRow[key] === row[key])
          );
          if (existing) {
            Object.assign(existing, clone(row));
            result.push(existing);
          } else {
            const inserted = { id: row.id ?? nextId(), ...clone(row) };
            rows.push(inserted);
            result.push(inserted);
          }
        }
        return Promise.resolve({ data: shapeOutput(result), error: null });
      }

      if (action === "delete") {
        const deleted = rows.filter(matches);
        state[table] = rows.filter((row) => !matches(row));
        return Promise.resolve({ data: shapeOutput(deleted), error: null });
      }

      return Promise.resolve({ data: null, error: null });
    }

    const query = {
      eq(column, value) { filters.push({ type: "eq", column, value }); return query; },
      neq(column, value) { filters.push({ type: "neq", column, value }); return query; },
      in(column, value) { filters.push({ type: "in", column, value }); return query; },
      gte(column, value) { filters.push({ type: "gte", column, value }); return query; },
      lte(column, value) { filters.push({ type: "lte", column, value }); return query; },
      gt(column, value) { filters.push({ type: "gt", column, value }); return query; },
      lt(column, value) { filters.push({ type: "lt", column, value }); return query; },
      is(column, value) { filters.push({ type: "is", column, value }); return query; },
      order(column, opts = {}) { order = { column, ascending: opts.ascending !== false }; return query; },
      limit(n) { limit = n; return query; },
      select(columns) { projection = parseSelectColumns(columns); return query; },
      single() { return execute().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })); },
      maybeSingle() { return execute().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })); },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return query;
  }

  return {
    state,
    from(table) {
      ensureTable(table);
      return {
        select(columns) { return makeQuery(table, "select").select(columns); },
        insert(payload) { return makeQuery(table, "insert", payload); },
        update(payload) { return makeQuery(table, "update", payload); },
        upsert(payload, opts = {}) { return makeQuery(table, "upsert", payload, opts); },
        delete() { return makeQuery(table, "delete"); },
      };
    },
  };
}

/**
 * "Canned"/recorder-variant: returnerer altid de forudindstillede rækker
 * pr. tabel (ingen reel server-side filtrering af eq/gte/lte/in), men
 * REGISTRERER hvert filter-kald i `recorder` som [op, table, column, value]
 * så testen kan assertere på hvilke filtre koden faktisk anvendte. Stadig
 * projektion-aware: kun de kolonner der blev select()'et returneres.
 *
 * @param {object} tableData — { tableName: [row, ...] }
 * @param {Array} [recorder] — array der udfyldes med filter-kald
 */
export function createRecorderSupabase(tableData, recorder = []) {
  return {
    from(table) {
      const rows = tableData[table] ?? [];
      let projection = null;

      function result() {
        return { data: rows.map((row) => projectRow(row, projection)), error: null };
      }

      const builder = {
        select(columns) { projection = parseSelectColumns(columns); return builder; },
        eq(col, val) { recorder.push(["eq", table, col, val]); return builder; },
        gte(col, val) { recorder.push(["gte", table, col, val]); return builder; },
        lte(col, val) { recorder.push(["lte", table, col, val]); return builder; },
        in(col, val) { recorder.push(["in", table, col, val]); return builder; },
        order() { return Promise.resolve(result()); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return builder;
    },
  };
}
