// Motor-testbaenkens dom (#6451): rene funktioner, ingen I/O.
//
// 1. Nedkoerselsfinaler i endagsloeb markeres pr. etape med motorens egen
//    #6200-detektion (finishDescentIndexFor + official_times_v3-tuningen, sprøjtet
//    ind af kalderen), og taelles for sig, saa de ikke forvraenger udbrudsdommen.
// 2. Samme rute koert i flere divisioner er een stemme: raekkerne pr. loeb
//    bevares, men dommen tager gennemsnittet over divisionerne pr. rute.
// 3. Dommen pr. profil: bedre / vaerre / i tvivl for kandidat-revisionen mod
//    baseline, og (med en forrige bench.json) foer/efter mod forrige koersel.
//
// Ingen balance-tal her: baandene ligger i tourScorecard, og de maalte tal
// skrives kun til den gitignorerede balance-internals/.

/** Noegletal der doemmes (samme som summarizeStage's verdicts). */
export const VERDICT_METRICS = Object.freeze(["gapTo10", "gapTo30", "ittGapTo10Per40Km", "breakawaySize", "breakawayWinShare"]);

/** PASS/WARN/FAIL som point, saa divisioner kan midles. Alt andet (N/A, TODO) taeller ikke. */
export const STATUS_SCORE = Object.freeze({ PASS: 1, WARN: 0.5, FAIL: 0 });

/** Minimum for at kalde en profil bedre/vaerre: nettoet skal vaere mindst denne andel af sammenligningerne (og mindst 1). */
export const VERDICT_MIN_NET_SHARE = 0.1;

const mean = (xs) => {
  const v = xs.filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x))).map(Number);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Point -> naermeste status (1 PASS, 0,5 WARN, 0 FAIL). */
export function statusFromScore(score) {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score >= 0.75) return "PASS";
  if (score > 0.25) return "WARN";
  return "FAIL";
}

/**
 * Fingeraftryk for "samme rute": loebsnavn + etape + profil + finale + distance.
 * Divisioner af samme loeb faar samme noegle. Kun felter der ogsaa staar i en
 * aeldre bench.json, saa foer/efter kan matche ruterne. Tager baade en
 * etapeprofil (stage_number) og en bench-etaperaekke (stage).
 */
export function routeKey(raceName, stage) {
  return [raceName ?? "", stage?.stage_number ?? stage?.stage ?? "", stage?.profile_type ?? "", stage?.finale_type ?? "", stage?.distance_km ?? ""].join("|");
}

/**
 * Er etapen en nedkoerselsfinale i et endagsloeb? Genbruger motorens
 * #6200-detektion: `finishDescentIndexFor(route, tuning) >= 0` med
 * official_times_v3's tidsmodel-tuning (det er dér loftet gaelder).
 * Etapeloeb markeres aldrig (ejer 11/10: kun endagsloeb taelles for sig).
 */
export function isOneDayDescentFinish({ oneDay, route, finishDescentIndexFor, tuning }) {
  if (!oneDay || !route || typeof finishDescentIndexFor !== "function") return false;
  return finishDescentIndexFor(route, tuning) >= 0;
}

/**
 * Samme rute i flere divisioner -> een gruppe. Pr. revision: gennemsnit af
 * noegletallene og af statuspoint over divisionerne (een rute = een stemme).
 * `races` er bench.races; etaperne bruger `routeKey` (ellers beregnes den).
 * `descentByKey` (valgfri Map) overstyrer etapens descentFinish, fx naar en
 * aeldre bench.json uden markering sammenlignes.
 */
export function dedupRoutes(races, revisions, { descentByKey = null } = {}) {
  const groups = new Map();
  for (const race of races ?? []) {
    for (const st of race.stages ?? []) {
      const key = st.routeKey ?? routeKey(race.name, st);
      let g = groups.get(key);
      if (!g) {
        g = {
          key, raceName: race.name ?? null, stage: st.stage, profile_type: st.profile_type ?? null, cls: st.cls ?? null,
          oneDay: race.oneDay === true,
          descentFinish: descentByKey?.has(key) ? descentByKey.get(key) === true : st.descentFinish === true,
          divisions: 0, raceIds: [], rows: [],
        };
        groups.set(key, g);
      }
      g.divisions++;
      g.raceIds.push(race.id ?? null);
      g.rows.push(st);
    }
  }
  const out = [];
  for (const g of groups.values()) {
    const byRevision = {};
    for (const rev of revisions) {
      const values = {};
      const scores = {};
      for (const m of VERDICT_METRICS) {
        values[m] = mean(g.rows.map((st) => st.revisions?.[rev]?.[m]));
        const pts = g.rows
          .map((st) => STATUS_SCORE[st.revisions?.[rev]?.verdicts?.[m]?.status])
          .filter((p) => p !== undefined);
        scores[m] = pts.length ? mean(pts) : null;
      }
      byRevision[rev] = { values, scores, statuses: Object.fromEntries(Object.entries(scores).map(([m, s]) => [m, statusFromScore(s)])) };
    }
    const { rows: _rows, ...rest } = g;
    out.push({ ...rest, byRevision });
  }
  return out;
}

/** Udbrudssejre pr. revision: alle ruter, uden nedkoerselsfinaler, og kun dem. */
export function breakawaySplit(groups, rev) {
  const pick = (gs) => {
    const vals = gs.map((g) => g.byRevision?.[rev]?.values?.breakawayWinShare).filter((v) => v !== null && v !== undefined);
    return { routes: vals.length, meanWinShare: mean(vals) };
  };
  return {
    all: pick(groups),
    withoutDescentFinish: pick(groups.filter((g) => !g.descentFinish)),
    descentFinishOnly: pick(groups.filter((g) => g.descentFinish)),
  };
}

/**
 * Sammenlign to revisioner (eller to koersler) rute for rute og noegletal for
 * noegletal paa statuspoint. Udbrudssejre paa nedkoerselsfinaler i endagsloeb
 * taeller IKKE med i bedre/vaerre (de staar for sig i breakawaySplit).
 */
export function compareGroups(pairs) {
  let better = 0, worse = 0, same = 0;
  for (const { groupA, groupB, revA, revB, descentFinish } of pairs) {
    for (const m of VERDICT_METRICS) {
      if (m === "breakawayWinShare" && descentFinish) continue;
      const a = groupA?.byRevision?.[revA]?.scores?.[m];
      const b = groupB?.byRevision?.[revB]?.scores?.[m];
      if (a === null || a === undefined || b === null || b === undefined) continue;
      if (b > a) better++;
      else if (b < a) worse++;
      else same++;
    }
  }
  const comparisons = better + worse + same;
  return { comparisons, better, worse, same, status: judge({ better, worse, comparisons }) };
}

/** bedre/vaerre/i tvivl ud fra nettoet: mindst VERDICT_MIN_NET_SHARE af sammenligningerne (og mindst 1). */
export function judge({ better, worse, comparisons }) {
  if (!comparisons) return "unsure";
  const need = Math.max(1, Math.ceil(VERDICT_MIN_NET_SHARE * comparisons));
  const net = better - worse;
  if (net >= need) return "better";
  if (-net >= need) return "worse";
  return "unsure";
}

const byProfileType = (groups) => {
  const m = new Map();
  for (const g of groups) {
    const k = g.profile_type ?? "unknown";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(g);
  }
  return m;
};

/** Dom pr. profil: kandidat mod baseline paa de de-duplikerede ruter. */
export function profileVerdicts(groups, { baseline, candidate }) {
  const out = {};
  for (const [profile, gs] of byProfileType(groups)) {
    const cmp = compareGroups(gs.map((g) => ({ groupA: g, groupB: g, revA: baseline, revB: candidate, descentFinish: g.descentFinish })));
    out[profile] = {
      routes: gs.length,
      rows: gs.reduce((n, g) => n + g.divisions, 0),
      duplicateRows: gs.reduce((n, g) => n + g.divisions - 1, 0),
      descentFinishRoutes: gs.filter((g) => g.descentFinish).length,
      ...cmp,
      breakaway: { [baseline]: breakawaySplit(gs, baseline), [candidate]: breakawaySplit(gs, candidate) },
    };
  }
  return out;
}

/**
 * Foer/efter: samme revision i forrige og denne koersel, kun paa ruter der
 * findes i begge (matchet paa routeKey). Nedkoerselsmarkeringen tages fra
 * denne koersel, saa en aeldre bench.json uden markering doemmes ens.
 */
export function beforeAfter(prevGroups, currGroups, { revision }) {
  const prevByKey = new Map(prevGroups.map((g) => [g.key, g]));
  const matched = currGroups.filter((g) => prevByKey.has(g.key));
  const out = {
    revision, matchedRoutes: matched.length, onlyNow: currGroups.length - matched.length, onlyBefore: prevGroups.length - matched.length,
    overall: compareGroups(matched.map((g) => ({ groupA: prevByKey.get(g.key), groupB: g, revA: revision, revB: revision, descentFinish: g.descentFinish }))),
    byProfile: {},
  };
  for (const [profile, gs] of byProfileType(matched)) {
    const cmp = compareGroups(gs.map((g) => ({ groupA: prevByKey.get(g.key), groupB: g, revA: revision, revB: revision, descentFinish: g.descentFinish })));
    const prevGs = gs.map((g) => ({ ...prevByKey.get(g.key), descentFinish: g.descentFinish }));
    out.byProfile[profile] = { routes: gs.length, ...cmp, breakaway: { before: breakawaySplit(prevGs, revision), after: breakawaySplit(gs, revision) } };
  }
  return out;
}

/**
 * Hele den automatiske dom til bench.json (`bench.verdict`) og verdict.json
 * (`auto`). `previous` er en forrige bench.json (valgfri).
 */
export function buildVerdict(bench, { baseline = bench.revisions[0], candidate = bench.revisions[bench.revisions.length - 1], previous = null } = {}) {
  const groups = dedupRoutes(bench.races, bench.revisions);
  const rows = bench.races.reduce((n, r) => n + (r.stages?.length ?? 0), 0);
  const v = {
    baseline, candidate,
    dedup: { rows, routes: groups.length, duplicateRows: rows - groups.length },
    descentFinish: {
      oneDayRoutes: groups.filter((g) => g.oneDay).length,
      routes: groups.filter((g) => g.descentFinish).length,
      [baseline]: breakawaySplit(groups, baseline),
      [candidate]: breakawaySplit(groups, candidate),
    },
    overall: compareGroups(groups.map((g) => ({ groupA: g, groupB: g, revA: baseline, revB: candidate, descentFinish: g.descentFinish }))),
    byProfile: profileVerdicts(groups, { baseline, candidate }),
    beforeAfter: null,
  };
  if (previous?.races?.length) {
    const descentByKey = new Map(groups.map((g) => [g.key, g.descentFinish]));
    const prevRevs = previous.revisions ?? [];
    if (prevRevs.includes(candidate)) {
      const prevGroups = dedupRoutes(previous.races, [candidate], { descentByKey });
      v.beforeAfter = { previousGeneratedAt: previous.generatedAt ?? null, ...beforeAfter(prevGroups, groups, { revision: candidate }) };
    }
  }
  return v;
}
