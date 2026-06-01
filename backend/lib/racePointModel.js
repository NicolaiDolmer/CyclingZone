// R2 (#894 / epic #893): sammenkædet/relativ point-model — ren kaskade-matematik.
// Design: docs/slices/prize-money-audit-r2-design.md
//
// Denne fil er den data-agnostiske JS-reference for kaskaden. SQL-versionen
// (database/2026-06-01-race-point-model.sql + regenerate_race_points()) skal give
// IDENTISK output. Regressionstesten beviser generateRows(buildModelFromRows(X)) === X.
//
// Model:
//   template[class,rt,rank].weight = points / rank1[class,rt]   (kurveform, per kategori)
//   master[rt].anchor              = rank1[masterClassFor(rt), rt]
//   cascade[class,rt].factor       = rank1[class,rt] / master[rt].anchor   (master selv = 1)
//   generate: points = round(factor × anchor × weight)

// Endags-result-typer mastres af Monuments; alt andet af TourFrance (TdF har ingen endags-klasse).
const ONE_DAY_RESULT_TYPES = new Set(["Klassiker", "KlassikerHold"]);

export function masterClassFor(resultType) {
  return ONE_DAY_RESULT_TYPES.has(resultType) ? "Monuments" : "TourFrance";
}

// Halv-vejs-op afrunding (matcher Postgres round() for ikke-negative tal).
function roundHalfUp(value) {
  return Math.floor(value + 0.5);
}

// rows: [{ race_class, result_type, rank, points }]
// → { templates: [{race_class,result_type,rank,weight}],
//     masters:   [{result_type, master_class, anchor}],
//     cascades:  [{race_class, result_type, factor}] }
export function buildModelFromRows(rows) {
  const rank1 = new Map(); // "class|rt" -> points@rank1
  for (const r of rows) {
    if (r.rank === 1) rank1.set(`${r.race_class}|${r.result_type}`, r.points);
  }

  // Master-ankre: pr. result_type → masterklassens rank-1.
  const masterAnchor = new Map(); // rt -> anchor
  const resultTypes = new Set(rows.map((r) => r.result_type));
  for (const rt of resultTypes) {
    const mClass = masterClassFor(rt);
    const anchor = rank1.get(`${mClass}|${rt}`);
    if (anchor !== undefined) masterAnchor.set(rt, anchor);
  }

  const templates = [];
  for (const r of rows) {
    const r1 = rank1.get(`${r.race_class}|${r.result_type}`);
    if (!r1) continue; // rank-1 mangler/0 → kan ikke normalisere (sker ikke i prod, verificeret)
    templates.push({
      race_class: r.race_class,
      result_type: r.result_type,
      rank: r.rank,
      weight: r.points / r1,
    });
  }

  const masters = [];
  for (const [rt, anchor] of masterAnchor) {
    masters.push({ result_type: rt, master_class: masterClassFor(rt), anchor });
  }

  const cascades = [];
  for (const [key, r1] of rank1) {
    const [race_class, result_type] = key.split("|");
    const anchor = masterAnchor.get(result_type);
    if (!anchor) continue;
    cascades.push({ race_class, result_type, factor: r1 / anchor });
  }

  return { templates, masters, cascades };
}

// model → rows: [{ race_class, result_type, rank, points }]
export function generateRows({ templates, masters, cascades }) {
  const anchorByRt = new Map(masters.map((m) => [m.result_type, Number(m.anchor)]));
  const factorByKey = new Map(
    cascades.map((c) => [`${c.race_class}|${c.result_type}`, Number(c.factor)]),
  );

  const rows = [];
  for (const t of templates) {
    const anchor = anchorByRt.get(t.result_type);
    const factor = factorByKey.get(`${t.race_class}|${t.result_type}`);
    if (anchor === undefined || factor === undefined) continue;
    rows.push({
      race_class: t.race_class,
      result_type: t.result_type,
      rank: t.rank,
      points: roundHalfUp(factor * anchor * Number(t.weight)),
    });
  }
  return rows;
}
