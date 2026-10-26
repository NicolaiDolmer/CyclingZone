// #6804 motor v3: taend-gatens nye gates (G16-G19 + G2 udvidet til flad) og
// #2757 S0-maalingen af spurtfinalen. Spec: docs/superpowers/specs/
// 2026-10-23-6804-v3-tilvalg-design.md §2 og §5. Ejer 24/10 (valg 8 A): gaterne
// BLOKERER taendingen af v3. En gate uden maaling eller uden privat baand er
// "MANGLER" og blokerer ogsaa (fail closed), aldrig et stille PASS.
//
// REN: ingen IO. Baandene er private (hard rule 17) og laeses af motorTestport
// fra den private taerskelfil (noeglen `v3Gates`); her staar kun definitionerne.
//
// ── Kontrakten (pr. seed i tourDryRun-JSON'ens runs[].perSeed[]) ─────────────
//   gcWinner, finishers                       findes (tourScorecard.runTour)
//   pointsWinner, komWinner                   tourScorecard (lib/jerseyTally.mjs)
//   komWinnerBreakawayPoints: number          G16, leveres af motor-sporet #6937:
//                                             bjergpoint bjergtroejens vinder tog i udbrud
//   abandons: { starters, out,                G17, leveres af motor-sporet #6938
//     byRole: { <race_role|"none">: { starters, out } } }
//   rows[].sprintTop10: string[]              S0, tourScorecard (massespurt-etaper)
//   rows[].breakawayMaxLead: number (s)       G2-flad, leveres af motor-sporet #6912:
//   rows[].breakawayUnchased: boolean         udbruddets stoerste forspring / ingen jagt-interesse
// Mangler et felt i ALLE seeds, er maalingen null (MANGLER). Motor-sporenes egne
// maalefunktioner kan erstatte stub-laesningen her uden at gaten aendres.
//
// ── Loebskonteksten (fra loebets cache.json, se motorTestport.raceContextFromCache) ─
//   { stages, group, divisionId, roleByRider, teamByRider, sprintRankByRider,
//     flatStages, mountainNonSummitStages: Set<stage_number> }

export const GATE_STATUS = Object.freeze({ PASS: "PASS", FAIL: "FAIL", MISSING: "MANGLER", NA: "N/A" });

/** Gaterne i den raekkefoelge kortet viser dem. Alle er blokerende. */
export const V3_GATES = Object.freeze([
  { id: "G16", issue: "#6937", label: "bjergtroeje: klassementsvinderen vinder ikke ogsaa bjergtroejen for ofte; udbrydere scorer bjergpoint" },
  { id: "G17", issue: "#6938", label: "udgaaede pr. loebsgruppe; kaptajner udgaar ikke oftere end hjaelpere" },
  { id: "G18", issue: "#2757", label: "pointtroeje: en sprinter vinder i loeb med flere flade etaper; klassementsvinderen sjaeldent" },
  { id: "G19", issue: "#6486", label: "bjerg uden topankomst: nr. 10 inden for loftet i alle divisioner" },
  { id: "G2F", issue: "#6912", label: "forspring paa flad/rullende: intet over den oevre zone uden jagt-interesse, intet over den haarde graense" },
  { id: "gcFromBreakaway", issue: "#7258", label: "klassementet afgoeres sjaeldent af et morgenudbrud; klassementsvinderen vinder meget sjaeldent en etape fra udbrud" },
]);

const STAGE_RACE_GROUPS = ["stage_race", "gt"];
const CAPTAIN_ROLES = new Set(["captain", "sprint_captain"]);
const SUPPORT_ROLES = new Set(["helper", "hunter", "free_role"]);
const share = (hits, n) => (n > 0 ? hits / n : null);
const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/** Loebsgruppe som breakawayIntent.raceGroupOf: endagsloeb, etapeloeb (2-14), Grand Tour (15+). */
export function raceGroupOfStages(stages) {
  const n = Number(stages) || 1;
  return n <= 1 ? "one_day" : n >= 15 ? "gt" : "stage_race";
}

export function median(xs) {
  const s = xs.filter((v) => num(v) !== null).map(Number).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Vaerdien inden for {min?, max?}. Et baand uden graenser er ugyldigt (null). */
export function inBand(value, band) {
  if (!band || (band.min === undefined && band.max === undefined)) return null;
  if (value === null || value === undefined) return null;
  if (band.min !== undefined && value < band.min) return false;
  if (band.max !== undefined && value > band.max) return false;
  return true;
}

/** Seeds for en revision, hver med sin loebskontekst. */
function seedsOf(raceResults, revision, contexts) {
  const out = [];
  for (const rr of raceResults) {
    const run = rr?.runs?.[revision];
    if (!run) continue;
    const ctx = contexts?.get?.(rr.raceId) ?? null;
    const stages = ctx?.stages ?? rr.stages;
    for (const s of run.perSeed ?? []) out.push({ raceId: rr.raceId, stages, group: ctx?.group ?? raceGroupOfStages(stages), ctx, seed: s });
  }
  return out;
}

// ── Maalefunktionerne ────────────────────────────────────────────────────────

/** G16: pr. loebsgruppe andelen af seeds hvor klassementsvinderen ogsaa vinder bjergtroejen, og hvor bjergtroejens vinder har udbrudspoint. */
export function measureG16(raceResults, revision, contexts) {
  const seeds = seedsOf(raceResults, revision, contexts).filter((x) => STAGE_RACE_GROUPS.includes(x.group) && has(x.seed, "komWinner"));
  if (!seeds.length) return null;
  const byGroup = {};
  for (const g of STAGE_RACE_GROUPS) {
    const xs = seeds.filter((x) => x.group === g && x.seed.komWinner && x.seed.gcWinner);
    byGroup[g] = { n: xs.length, gcAlsoKom: share(xs.filter((x) => x.seed.komWinner === x.seed.gcWinner).length, xs.length) };
  }
  const withBreak = seeds.filter((x) => x.seed.komWinner && num(x.seed.komWinnerBreakawayPoints) !== null);
  return {
    byGroup,
    komFromBreak: withBreak.length ? { n: withBreak.length, share: share(withBreak.filter((x) => Number(x.seed.komWinnerBreakawayPoints) > 0).length, withBreak.length) } : null,
  };
}

/** G17: pr. loebsgruppe andelen af startere der udgik, og kaptajners mod hjaelperes udgangsrate. */
export function measureG17(raceResults, revision, contexts) {
  const seeds = seedsOf(raceResults, revision, contexts).filter((x) => x.seed.abandons && num(x.seed.abandons.starters) > 0);
  if (!seeds.length) return null;
  const byGroup = {};
  for (const x of seeds) {
    const g = (byGroup[x.group] ??= { seeds: 0, starters: 0, out: 0 });
    g.seeds += 1;
    g.starters += Number(x.seed.abandons.starters);
    g.out += Number(x.seed.abandons.out) || 0;
  }
  for (const g of Object.values(byGroup)) g.share = share(g.out, g.starters);
  // Codex: begge kaptajn-roller er kaptajner; hjaelper-kohorten er rollen helper (eksplicit).
  const roles = { captain: { starters: 0, out: 0 }, helper: { starters: 0, out: 0 } };
  for (const x of seeds) {
    for (const [role, c] of Object.entries(x.seed.abandons.byRole ?? {})) {
      const k = CAPTAIN_ROLES.has(role) ? "captain" : role === "helper" ? "helper" : null;
      if (!k) continue;
      roles[k].starters += Number(c?.starters) || 0;
      roles[k].out += Number(c?.out) || 0;
    }
  }
  return { byGroup, captainRate: share(roles.captain.out, roles.captain.starters), helperRate: share(roles.helper.out, roles.helper.starters), roles };
}

/** Er rytteren en sprinter: sprint-kaptajn eller blandt feltets `topSprinters` bedste sprintere (privat antal). */
export function isSprinter(riderId, ctx, topSprinters) {
  if (!riderId || !ctx) return false;
  if (ctx.roleByRider?.get?.(riderId) === "sprint_captain") return true;
  const rank = ctx.sprintRankByRider?.get?.(riderId);
  return Number.isFinite(topSprinters) && Number.isFinite(rank) && rank <= topSprinters;
}

/** G18: i etapeloeb med mindst `minFlatStages` flade etaper: andelen hvor en sprinter vinder pointtroejen, og hvor klassementsvinderen goer. */
export function measureG18(raceResults, revision, contexts, { minFlatStages, topSprinters } = {}) {
  if (!Number.isFinite(minFlatStages) || !Number.isFinite(topSprinters)) return null;
  const seeds = seedsOf(raceResults, revision, contexts)
    .filter((x) => STAGE_RACE_GROUPS.includes(x.group) && x.ctx && has(x.seed, "pointsWinner") && x.seed.pointsWinner)
    .filter((x) => (x.ctx.flatStages ?? 0) >= minFlatStages);
  if (!seeds.length) return null;
  return {
    n: seeds.length,
    races: new Set(seeds.map((x) => x.raceId)).size,
    sprinterWins: share(seeds.filter((x) => isSprinter(x.seed.pointsWinner, x.ctx, topSprinters)).length, seeds.length),
    gcWinnerWins: share(seeds.filter((x) => x.seed.pointsWinner === x.seed.gcWinner).length, seeds.length),
  };
}

/** G19: nr. 10 paa bjergetaper uden topankomst (hvor udbruddet ikke vandt), median pr. division og samlet. */
export function measureG19(raceResults, revision, contexts) {
  const byDivision = new Map();
  const all = [];
  const seeds = seedsOf(raceResults, revision, contexts);
  // Codex: en manglende loebskontekst er manglende evidens (MANGLER), ikke "ingen etape" (N/A).
  const missingContext = new Set(seeds.filter((x) => !x.ctx).map((x) => x.raceId)).size;
  let qualifying = 0;
  // Codex P2 (#7152): hver division med kvalificerende etaper skal have mindst én brugbar
  // maaling; ellers kan en anden divisions maalinger give PASS uden evidens.
  const qualifyingDivisions = new Set();
  for (const x of seeds) {
    const set = x.ctx?.mountainNonSummitStages;
    if (!set?.size) continue;
    const q = (x.seed.rows ?? []).filter((r) => set.has(r.stage)).length;
    qualifying += q;
    if (q) qualifyingDivisions.add(x.ctx.divisionId ?? "ukendt");
    for (const r of x.seed.rows ?? []) {
      if (!set.has(r.stage) || r.breakawayWon === true || num(r.gapTo10) === null) continue;
      const key = x.ctx.divisionId ?? "ukendt";
      if (!byDivision.has(key)) byDivision.set(key, []);
      byDivision.get(key).push(Number(r.gapTo10));
      all.push(Number(r.gapTo10));
    }
  }
  if (missingContext) return { missingContext, n: all.length };
  if (!all.length) return { n: 0, qualifying };
  const missingDivisions = [...qualifyingDivisions].filter((k) => !byDivision.has(k));
  if (missingDivisions.length) return { n: all.length, qualifying, missingDivisions };
  return { n: all.length, qualifying, median: median(all), byDivision: Object.fromEntries([...byDivision].map(([k, xs]) => [k, { n: xs.length, median: median(xs) }])) };
}

/** G2-flad: flade og rullende vejetaper hvor udbruddets stoerste forspring passerer den oevre zone uden "ingen jagt-interesse", eller den haarde graense. */
export function measureG2F(raceResults, revision, contexts, { upperZoneSeconds = null, hardMaxSeconds = null } = {}) {
  const rows = seedsOf(raceResults, revision, contexts).flatMap((x) => x.seed.rows ?? [])
    .filter((r) => (r.profile_type === "flat" || r.profile_type === "rolling") && has(r, "breakawayMaxLead"));
  if (!rows.length) return null;
  if (!upperZoneSeconds || !Number.isFinite(hardMaxSeconds)) return { n: rows.length, overUpperWithoutUnchased: null, overHardMax: null };
  // Codex: kun brugbare maalinger taeller, og hvert maalt terraen skal have sin oevre zone.
  const usable = rows.filter((r) => num(r.breakawayMaxLead) !== null);
  if (!usable.length) return null;
  const missingZone = [...new Set(usable.map((r) => r.profile_type))].filter((t) => num(upperZoneSeconds[t]) === null);
  if (missingZone.length) return { n: usable.length, missingZone, overUpperWithoutUnchased: null, overHardMax: null };
  let overUpper = 0;
  let overHard = 0;
  for (const r of usable) {
    const lead = Number(r.breakawayMaxLead);
    if (lead > Number(upperZoneSeconds[r.profile_type]) && r.breakawayUnchased !== true) overUpper += 1;
    if (lead > hardMaxSeconds) overHard += 1;
  }
  return { n: usable.length, overUpperWithoutUnchased: overUpper, overHardMax: overHard };
}

/** #7258: loebsgruppen til udbrudsmaalingerne (strukturelle graenser, ikke balance). */
export function breakawayRaceGroupOf(stages) {
  const n = Number(stages) || 1;
  return n <= 1 ? "one_day" : n <= 4 ? "short" : n >= 15 ? "gt" : "week";
}

/**
 * #7258 gcFromBreakaway: andelen af etapeloeb x seeds hvor et morgenudbrud afgjorde
 * klassementet (seed.gcWinnerBreak.decisive, gcFromBreakaway7258.mjs), og hvor
 * klassementsvinderen vandt en etape fra udbrud (wonFromBreak). Samlet og pr.
 * loebsgruppe. Desuden (maaling, ingen dom, #7258 B/C): andelen af dannede
 * morgenudbrud med en klassementsfavorit (rows[].breakawayGcFav > 0) og med en
 * etapefavorit (rows[].breakawayStageFav > 0), pr. loebsgruppe inkl. endagsloeb.
 * null uden maaling (gcWinnerBreak mangler i alle seeds).
 */
export function measureGcFromBreakaway(raceResults, revision, contexts) {
  const all = seedsOf(raceResults, revision, contexts);
  const seeds = all.filter((x) => Number(x.stages) > 1 && x.seed?.gcWinnerBreak);
  if (!seeds.length) return null;
  const count = (xs) => ({
    n: xs.length,
    decided: xs.filter((x) => x.seed.gcWinnerBreak.decisive === true).length,
    won: xs.filter((x) => x.seed.gcWinnerBreak.wonFromBreak === true).length,
  });
  const withShares = (c) => ({ ...c, decidedShare: share(c.decided, c.n), wonShare: share(c.won, c.n) });
  const byGroup = {};
  for (const g of ["short", "week", "gt"]) {
    const xs = seeds.filter((x) => breakawayRaceGroupOf(x.stages) === g);
    if (xs.length) byGroup[g] = withShares(count(xs));
  }
  const favourites = {};
  for (const x of all) {
    const g = breakawayRaceGroupOf(x.stages);
    for (const r of x.seed?.rows ?? []) {
      if (num(r.breakawayGcFav) === null && num(r.breakawayStageFav) === null) continue;
      const f = (favourites[g] ??= { breakaways: 0, withGcFav: 0, withStageFav: 0 });
      f.breakaways += 1;
      if (Number(r.breakawayGcFav) > 0) f.withGcFav += 1;
      if (Number(r.breakawayStageFav) > 0) f.withStageFav += 1;
    }
  }
  for (const f of Object.values(favourites)) { f.gcFavShare = share(f.withGcFav, f.breakaways); f.stageFavShare = share(f.withStageFav, f.breakaways); }
  return { ...withShares(count(seeds)), byGroup, favourites };
}

// ── Domme ────────────────────────────────────────────────────────────────────

function gateResult(gate, status, value, why) {
  return { id: gate.id, issue: gate.issue, label: gate.label, status, value, why };
}

/** Alle dommes AND: et ugyldigt/manglende baand eller en manglende maaling = MANGLER. */
function judgeChecks(checks) {
  if (checks.some((c) => c.ok === null)) return { status: GATE_STATUS.MISSING, failed: checks.filter((c) => c.ok === null).map((c) => c.what) };
  const failed = checks.filter((c) => c.ok === false).map((c) => c.what);
  return { status: failed.length ? GATE_STATUS.FAIL : GATE_STATUS.PASS, failed };
}

/**
 * Doem G16-G19 + G2-flad for en revision. `bands` = den private taerskelfils
 * `v3Gates`. Returnerer {gates, blocked, reasons}: blocked = mindst én gate er
 * FAIL eller MANGLER (ejer valg 8 A: de blokerer taendingen).
 */
export function evaluateV3Gates({ raceResults, revision, contexts = new Map(), bands = null }) {
  const b = bands ?? {};
  const by = Object.fromEntries(V3_GATES.map((g) => [g.id, g]));
  const out = [];

  const g16 = measureG16(raceResults, revision, contexts);
  if (!g16) out.push(gateResult(by.G16, GATE_STATUS.MISSING, null, "ingen maaling (komWinner mangler i scorecardet)"));
  else {
    const checks = STAGE_RACE_GROUPS.filter((g) => g16.byGroup[g].n > 0).map((g) => ({ what: `${g}: klassementsvinder = bjergtroeje`, ok: inBand(g16.byGroup[g].gcAlsoKom, b.G16?.gcAlsoKom?.[g]) }));
    checks.push({ what: "bjergtroejens vinder med udbrudspoint", ok: g16.komFromBreak ? inBand(g16.komFromBreak.share, b.G16?.komFromBreak) : null });
    const j = judgeChecks(checks);
    out.push(gateResult(by.G16, j.status, g16, j.failed.join("; ") || null));
  }

  const g17 = measureG17(raceResults, revision, contexts);
  if (!g17) out.push(gateResult(by.G17, GATE_STATUS.MISSING, null, "ingen maaling (abandons mangler i scorecardet)"));
  else {
    const checks = Object.entries(g17.byGroup).map(([g, v]) => ({ what: `${g}: andel udgaaede`, ok: inBand(v.share, b.G17?.abandonShare?.[g]) }));
    const ratio = num(b.G17?.captainVsHelperMaxRatio);
    checks.push({ what: "kaptajner udgaar ikke oftere end hjaelpere", ok: ratio === null || g17.captainRate === null || g17.helperRate === null ? null : g17.captainRate <= g17.helperRate * ratio });
    const j = judgeChecks(checks);
    out.push(gateResult(by.G17, j.status, g17, j.failed.join("; ") || null));
  }

  const g18Opts = { minFlatStages: num(b.G18?.minFlatStages) ?? NaN, topSprinters: num(b.G18?.topSprinters) ?? NaN };
  const g18 = measureG18(raceResults, revision, contexts, g18Opts);
  if (!g18) out.push(gateResult(by.G18, GATE_STATUS.MISSING, null, Number.isFinite(g18Opts.minFlatStages) && Number.isFinite(g18Opts.topSprinters) ? "ingen maaling (pointsWinner/loebskontekst mangler, eller ingen loeb med nok flade etaper)" : "privat baand mangler (minFlatStages/topSprinters)"));
  else {
    const j = judgeChecks([
      { what: "sprinter vinder pointtroejen", ok: inBand(g18.sprinterWins, b.G18?.sprinterWins) },
      { what: "klassementsvinderen vinder pointtroejen", ok: inBand(g18.gcWinnerWins, b.G18?.gcWinnerWins) },
    ]);
    out.push(gateResult(by.G18, j.status, g18, j.failed.join("; ") || null));
  }

  const g19 = measureG19(raceResults, revision, contexts);
  if (g19.missingContext) out.push(gateResult(by.G19, GATE_STATUS.MISSING, g19, `${g19.missingContext} loeb uden loebskontekst (cache.json)`));
  else if (!g19.qualifying) out.push(gateResult(by.G19, GATE_STATUS.NA, null, "ingen bjergetape uden topankomst i koerslen"));
  else if (!g19.n) out.push(gateResult(by.G19, GATE_STATUS.MISSING, g19, "bjergetaper uden topankomst, men intet brugbart nr. 10"));
  else if (g19.missingDivisions?.length) out.push(gateResult(by.G19, GATE_STATUS.MISSING, g19, `ingen brugbar maaling i division ${g19.missingDivisions.join(", ")}`));
  else {
    const band = b.G19?.gapTo10Median;
    const checks = Object.entries(g19.byDivision).map(([d, v]) => ({ what: `division ${d}: nr. 10 (median)`, ok: inBand(v.median, band) }));
    const j = judgeChecks(checks);
    out.push(gateResult(by.G19, j.status, g19, j.failed.join("; ") || null));
  }

  const g2f = measureG2F(raceResults, revision, contexts, { upperZoneSeconds: b.G2F?.upperZoneSeconds ?? null, hardMaxSeconds: num(b.G2F?.hardMaxSeconds) ?? NaN });
  if (!g2f) out.push(gateResult(by.G2F, GATE_STATUS.MISSING, null, "ingen maaling (breakawayMaxLead mangler i scorecardet)"));
  else if (g2f.overUpperWithoutUnchased === null) out.push(gateResult(by.G2F, GATE_STATUS.MISSING, g2f, g2f.missingZone ? `privat oevre zone mangler for ${g2f.missingZone.join(", ")}` : "privat baand mangler (upperZoneSeconds/hardMaxSeconds)"));
  else {
    const j = judgeChecks([
      { what: "over den oevre zone uden 'ingen jagt-interesse'", ok: g2f.overUpperWithoutUnchased === 0 },
      { what: "over den haarde graense", ok: g2f.overHardMax === 0 },
    ]);
    out.push(gateResult(by.G2F, j.status, g2f, j.failed.join("; ") || null));
  }

  // #7258: fail closed. Ingen maaling eller ingen private graenser = MANGLER.
  const gfb = measureGcFromBreakaway(raceResults, revision, contexts);
  const gfbBand = b.gcFromBreakaway ?? {};
  if (!gfb) out.push(gateResult(by.gcFromBreakaway, GATE_STATUS.MISSING, null, "ingen maaling (gcWinnerBreak mangler i scorecardet)"));
  else {
    const j = judgeChecks([
      { what: "klassementsvinderen i et udbrud der afgjorde loebet", ok: inBand(gfb.decidedShare, num(gfbBand.maxGcWinnerInBreakawayShare) === null ? null : { max: Number(gfbBand.maxGcWinnerInBreakawayShare) }) },
      { what: "klassementsvinderen vandt en etape fra udbrud", ok: inBand(gfb.wonShare, num(gfbBand.maxGcWinnerWonFromBreakawayShare) === null ? null : { max: Number(gfbBand.maxGcWinnerWonFromBreakawayShare) }) },
    ]);
    out.push(gateResult(by.gcFromBreakaway, j.status, gfb, j.failed.join("; ") || null));
  }

  const blocking = out.filter((g) => g.status === GATE_STATUS.FAIL || g.status === GATE_STATUS.MISSING);
  return { gates: out, blocked: blocking.length > 0, reasons: blocking.map((g) => `${g.id} ${g.status}${g.why ? ` (${g.why})` : ""}`) };
}

/** v3-gaterne gaelder en kandidat fra s5_profiles_v3 og frem (taend-gaten for v3). */
export function v3GatesApply(revision) {
  const m = /^s5_profiles_v(\d+)$/.exec(String(revision ?? ""));
  return Boolean(m && Number(m[1]) >= 3);
}

// ── #2757 S0: spurtfinalen ───────────────────────────────────────────────────

/** Spurtfinale = vej-etape paa flad eller brosten med top 10 i scorecardet, hvor udbruddet ikke vandt. */
export function isSprintFinishRow(r) {
  return (r?.profile_type === "flat" || r?.profile_type === "cobbles") && Array.isArray(r.sprintTop10) && r.sprintTop10.length > 0 && r.breakawayWon !== true;
}

/**
 * S0 (ingen motorændring, kun maaling): hvem vinder spurtfinalerne, og hvor godt
 * foelger resultatet sprint-evnen. Pr. terraen (flat/cobbles) og loebsgruppe.
 *  - vinderens sprint-rang i feltet (1 = feltets bedste sprinter): andel 1, top 3, top 10, median
 *  - vinderens rolle; en hjaelper paa sprint-kaptajnens hold der vandt foran ham (holdordrernes
 *    lead-out-markering er ikke i scorecardet, saa det er hjaelperen, ikke praecist lead-out-rytteren)
 *  - top 10: middel |sprint-rang - placering| for de 10 forreste, og andel af feltets 5 bedste sprintere i top 10
 */
export function measureSprintFinale(raceResults, revision, contexts) {
  const buckets = new Map();
  const bucket = (k) => {
    if (!buckets.has(k)) buckets.set(k, { n: 0, winnerRanks: [], roles: {}, helperBeatOwnSprintCaptain: 0, rankDiffs: [], top5InTop10: [], unknownWinner: 0 });
    return buckets.get(k);
  };
  for (const x of seedsOf(raceResults, revision, contexts)) {
    if (!x.ctx) continue;
    for (const r of x.seed.rows ?? []) {
      if (!isSprintFinishRow(r)) continue;
      for (const k of ["alle", `terraen:${r.profile_type}`, `gruppe:${x.group}`]) {
        const b = bucket(k);
        b.n += 1;
        const w = r.sprintTop10[0];
        const rank = x.ctx.sprintRankByRider?.get?.(w);
        if (Number.isFinite(rank)) b.winnerRanks.push(rank); else b.unknownWinner += 1;
        const role = x.ctx.roleByRider?.get?.(w) ?? "none";
        b.roles[role] = (b.roles[role] ?? 0) + 1;
        const team = x.ctx.teamByRider?.get?.(w);
        // Codex: holdordrernes lead-out-markering er ikke i scorecardet; maalingen er derfor
        // "en hjaelper (helper/hunter/free_role) paa sprint-kaptajnens hold vandt foran ham".
        if (SUPPORT_ROLES.has(role) && team != null) {
          const ownCaptainBehind = r.sprintTop10.slice(1).some((id) => x.ctx.teamByRider.get(id) === team && x.ctx.roleByRider.get(id) === "sprint_captain");
          if (ownCaptainBehind) b.helperBeatOwnSprintCaptain += 1;
        }
        const diffs = r.sprintTop10.map((id, i) => { const sr = x.ctx.sprintRankByRider?.get?.(id); return Number.isFinite(sr) ? Math.abs(sr - (i + 1)) : null; }).filter((v) => v !== null);
        if (diffs.length) b.rankDiffs.push(diffs.reduce((a, c) => a + c, 0) / diffs.length);
        const top5 = r.sprintTop10.filter((id) => (x.ctx.sprintRankByRider?.get?.(id) ?? Infinity) <= 5).length;
        b.top5InTop10.push(top5 / 5);
      }
    }
  }
  const out = {};
  for (const [k, b] of buckets) {
    const known = b.winnerRanks.length;
    out[k] = {
      n: b.n,
      bestSprinterWins: share(b.winnerRanks.filter((v) => v === 1).length, known),
      top3Wins: share(b.winnerRanks.filter((v) => v <= 3).length, known),
      top10Wins: share(b.winnerRanks.filter((v) => v <= 10).length, known),
      winnerSprintRankMedian: median(b.winnerRanks),
      unknownWinner: b.unknownWinner,
      roleShares: Object.fromEntries(Object.entries(b.roles).sort().map(([role, c]) => [role, share(c, b.n)])),
      helperBeatOwnSprintCaptain: share(b.helperBeatOwnSprintCaptain, b.n),
      top10MeanRankDiffMedian: median(b.rankDiffs),
      top5SprintersInTop10Median: median(b.top5InTop10),
    };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Loebskonteksten fra en tourDryRun-cache (startliste, evner, etaper). Sprint-
 * rangen er rytterens plads i feltet efter evnen `sprint` (1 = bedst; lige
 * evne deler ikke plads: rider_id bryder). Bjerg uden topankomst foelger
 * tourScorecard.isMountainNonSummit (injiceres, saa denne fil er motor-fri).
 */
export function raceContextFromCache(cache, { isMountainNonSummit = () => false } = {}) {
  if (!cache?.race) return null;
  const profiles = Array.isArray(cache.profiles) ? cache.profiles : [];
  const stages = profiles.length || Number(cache.race.stages) || 1;
  const abilities = new Map((cache.abilities ?? []).map((a) => [a.rider_id, a]));
  const entries = (cache.entries ?? []).filter((e) => abilities.has(e.rider_id));
  const bySprint = entries.map((e) => ({ id: e.rider_id, v: Number(abilities.get(e.rider_id)?.sprint) || 0 }))
    .sort((a, b) => b.v - a.v || String(a.id).localeCompare(String(b.id)));
  return {
    raceId: cache.race.id ?? null,
    stages,
    group: raceGroupOfStages(stages),
    divisionId: cache.race.league_division_id ?? null,
    roleByRider: new Map(entries.map((e) => [e.rider_id, e.race_role ?? null])),
    teamByRider: new Map(entries.map((e) => [e.rider_id, e.team_id ?? null])),
    sprintRankByRider: new Map(bySprint.map((x, i) => [x.id, i + 1])),
    flatStages: profiles.filter((p) => p.profile_type === "flat").length,
    mountainNonSummitStages: new Set(profiles.filter((p) => isMountainNonSummit(p)).map((p) => p.stage_number)),
  };
}
