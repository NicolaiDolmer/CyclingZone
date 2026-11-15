// #6490: test fakes return whole rows and ignore the select list. A select with a PostgREST JSON
// projection (`alias:column->key`, e.g. `condition_per_date:report->condition_per_date`) must still
// give the caller the aliased field, with Postgres' `->` semantics: the key's JSON value, or null
// when the key is missing or the column is not a JSON object. Other fields are left as they are.
const TOKEN = /^\s*([A-Za-z_][\w]*)\s*:\s*([A-Za-z_][\w]*)->([A-Za-z_][\w]*)\s*$/;

export function applyJsonArrowProjection(rows, cols) {
  if (!Array.isArray(rows) || typeof cols !== "string" || !cols.includes("->")) return rows;
  const projections = cols.split(",").map((part) => part.match(TOKEN)).filter(Boolean);
  if (!projections.length) return rows;
  return rows.map((row) => {
    const out = { ...row };
    for (const [, alias, column, key] of projections) {
      const value = row?.[column];
      out[alias] = value && typeof value === "object" && !Array.isArray(value) && key in value ? value[key] : null;
    }
    return out;
  });
}
