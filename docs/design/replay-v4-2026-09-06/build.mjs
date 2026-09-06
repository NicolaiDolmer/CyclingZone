#!/usr/bin/env node
// docs/design/replay-v4-2026-09-06/build.mjs
//
// Prototype: "foelg loebet live" — en ~30 sekunders afspilning af EN AEGTE
// etape koert af race engine v4 (backend/lib/engine/v4). Ingen opdigtede tal:
// rute, haendelser, grupper og resultat kommer 1:1 fra simulateStageV4's
// StageOutput.
//
// 100% READ-ONLY mod repoet: laeser population-snapshot + S3-etapeprofiler fra
// disk og skriver KUN i denne mappe. Ingen DB, ingen netvaerkskald, ingen
// prod-mutationer.
//
// Trin:
//   node build.mjs --sim --stages=<sti til season-3-stages.json>   -> stage.json
//   node build.mjs                                                 -> replay-en.html + replay-da.html
//   node build.mjs --record                                        -> webm (+ mp4 hvis ffmpeg findes)
//
// Stil: docs/design/TASTE.md + docs/design/coming-soon-v4-2026-09-06/poster.css
// (samme tokens, fonte og wordmark som plakaterne — hairlines, ingen skygger,
// 5px radius, tabular figures, stroke-ikoner, Bebas kun i overskriften).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const POSTER_DIR = join(REPO, "docs", "design", "coming-soon-v4-2026-09-06");

// Den udvalgte etape: aegte S3-kalender-raekke + seed. Valgt (blandt 560
// gennemkoerte etape/seed-kombinationer) fordi tidslinjen indeholder ALLE fire
// hændelsestyper — udbrud, styrt, mekanisk uheld med hjulskift og en afgjort
// finale — og fordi gruppebilledet er laesbart hele vejen.
const PICK = {
  race_name: "Tour de l'Ain Nouveau",
  stage_number: 2,
  seed: "replay-v4:Tour de l'Ain Nouveau:2:2",
  field_size: 180,
};

const STAGE_JSON = join(HERE, "stage.json");
const argHas = (n) => process.argv.includes(`--${n}`);
const argVal = (n, d = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// ---------------------------------------------------------------------------
// 1) Simulation -> stage.json
// ---------------------------------------------------------------------------

const STAGES_CANDIDATES = [
  argVal("stages"),
  join(REPO, "backend", "scripts", "out", "season-3-stages.json"),
  join(REPO, "backend", "scripts", "out", "baseline", "season-3-stages.json"),
  join(REPO, ".claude", "worktrees", "agent-a8d4d2f7e81fb11b8", "backend", "scripts", "out", "season-3-stages.json"),
].filter(Boolean);

async function simulate() {
  const enginePath = join(REPO, "backend", "lib", "engine", "v4", "index.ts");
  const { simulateStageV4 } = await import(pathToFileURL(enginePath).href);
  const { RACE_V4_TUNING } = await import(pathToFileURL(join(REPO, "backend", "lib", "engine", "v4", "tuning.ts")).href);
  const { entrantsFromAbilitiesRows } = await import(
    pathToFileURL(join(REPO, "backend", "lib", "engine", "v4", "adapters", "entrantAdapter.ts")).href
  );
  const { routeFromStageProfileRow } = await import(
    pathToFileURL(join(REPO, "backend", "lib", "engine", "v4", "adapters", "routeAdapter.ts")).href
  );
  const { buildStageTeamOrders } = await import(
    pathToFileURL(join(REPO, "backend", "scripts", "lib", "headToHeadOrders.js")).href
  );
  const { sampleField } = await import(pathToFileURL(join(REPO, "backend", "scripts", "lib", "headToHeadStats.js")).href);
  const { makeRng } = await import(pathToFileURL(join(REPO, "backend", "lib", "fictionalRiderGenerator.js")).href);
  const { stableSeed } = await import(pathToFileURL(join(REPO, "backend", "lib", "raceSimulator.js")).href);

  const popPath = join(REPO, "backend", "scripts", "baselines", "population-snapshot-2026-07-11.json");
  const population = readJson(popPath);

  const stagesPath = STAGES_CANDIDATES.find((p) => existsSync(p));
  if (!stagesPath) throw new Error(`fandt ingen season-3-stages.json (proevede: ${STAGES_CANDIDATES.join(", ")})`);
  const stagesFile = readJson(stagesPath);
  const stages = Array.isArray(stagesFile) ? stagesFile : stagesFile.stages;
  const stageRow = stages.find((s) => s.race_name === PICK.race_name && s.stage_number === PICK.stage_number);
  if (!stageRow) throw new Error(`fandt ikke etapen ${PICK.race_name} #${PICK.stage_number} i ${stagesPath}`);

  // Samme opstilling som backend/scripts/headToHeadV4.js's --orders=ai-gren:
  // deterministisk feltudtraek, AI-roller/-ordrer, laast feltstoerrelse.
  const rng = makeRng(stableSeed(`${PICK.seed}:field`));
  const fieldRiders = sampleField(rng, population.riders, PICK.field_size);
  const route = routeFromStageProfileRow(stageRow);
  const built = buildStageTeamOrders({ riders: fieldRiders, route });
  const teamByRider = new Map(fieldRiders.map((r) => [r.id, r.team_id ?? null]));
  const startlist = entrantsFromAbilitiesRows(
    fieldRiders.map((r) => ({ rider_id: r.id, ...r.abilities })),
    (riderId) => ({
      role: built.roles?.get(riderId) ?? "free_role",
      effort: "normal",
      condition: 1,
      teamId: teamByRider.get(riderId) ?? null,
    }),
  );

  const out = simulateStageV4({ route, startlist, orders: built.orders, seed: PICK.seed, tuning: RACE_V4_TUNING });

  const nameById = Object.fromEntries(fieldRiders.map((r) => [r.id, r.name]));
  const payload = {
    generated_by: "docs/design/replay-v4-2026-09-06/build.mjs --sim",
    engine: "backend/lib/engine/v4 (simulateStageV4)",
    sources: {
      population: "backend/scripts/baselines/population-snapshot-2026-07-11.json",
      stages: stagesPath.replace(REPO, "<repo>"),
    },
    pick: PICK,
    stage_row: stageRow,
    route,
    rider_names: nameById,
    timeline: out.timeline,
    incidents: out.incidents ?? [],
    groupSnapshots: out.groupSnapshots,
    results: [...out.results].sort((a, b) => a.rank - b.rank).slice(0, 25),
    result_status_counts: out.results.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {}),
  };
  writeFileSync(STAGE_JSON, JSON.stringify(payload, null, 1));
  console.log(`stage.json skrevet (${out.timeline.events.length} events, ${payload.incidents.length} uheld, ${out.groupSnapshots.length} gruppe-snapshots)`);
}

// ---------------------------------------------------------------------------
// 2) Hoejdeprofil ud af rutens segmenter (ingen opfundne tal: klatrelaengde x
//    gennemsnitsgradient giver stigningen, top_elevation_m giver toppen).
// ---------------------------------------------------------------------------

function buildProfile(route) {
  const segs = [...route.segments].sort((a, b) => a.from_km - b.from_km);
  const elev = new Array(segs.length + 1).fill(null);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.kind === "climb") {
      const gain = (s.to_km - s.from_km) * s.avg_gradient * 10; // m
      elev[i + 1] = s.top_elevation_m;
      elev[i] = Math.max(40, s.top_elevation_m - gain);
    }
  }
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.kind === "descent" && elev[i] != null && elev[i + 1] == null) {
      elev[i + 1] = Math.max(60, elev[i] - (s.to_km - s.from_km) * 55);
    }
  }
  const known = elev.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
  if (known.length === 0) throw new Error("ruten har ingen klatresegmenter — profilen kan ikke ankres");
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] != null) continue;
    const before = [...known].reverse().find((k) => k < i);
    const after = known.find((k) => k > i);
    if (before != null && after != null) {
      const t = (i - before) / (after - before);
      elev[i] = elev[before] + (elev[after] - elev[before]) * t;
    } else if (before != null) elev[i] = Math.max(60, elev[before] - 40);
    else elev[i] = Math.max(60, elev[after] - 60);
  }

  const pts = [];
  const step = 0.5;
  for (let km = 0; km <= route.distance_km + 1e-6; km = Math.min(route.distance_km, km + step)) {
    const i = Math.max(0, segs.findIndex((s) => km <= s.to_km + 1e-9));
    const s = segs[i] ?? segs[segs.length - 1];
    const t = (km - s.from_km) / Math.max(0.01, s.to_km - s.from_km);
    const a = elev[i], b = elev[i + 1];
    // klatring/nedkoersel: let s-kurve. flad/rolling: lineaer + deterministisk boelge.
    const ease = s.kind === "climb" || s.kind === "descent" ? t * t * (3 - 2 * t) : t;
    let e = a + (b - a) * ease;
    if (s.kind === "rolling" || s.kind === "flat") {
      const amp = s.kind === "rolling" ? 34 : 12;
      e += (Math.sin(km * 0.33) + 0.6 * Math.sin(km * 0.11 + 1.3)) * amp * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    }
    pts.push([Number(km.toFixed(2)), Math.round(Math.max(20, e))]);
    if (km >= route.distance_km) break;
  }
  return pts;
}

// ---------------------------------------------------------------------------
// 3) Gruppebilledet pr. segmentgraense -> frames (ranglagte, saa de kan
//    interpoleres blidt mellem to snapshots).
// ---------------------------------------------------------------------------

function buildFrames(data) {
  const field = data.pick.field_size;
  const frames = [{ km: 0, groups: [{ kind: "peloton", n: field, gap: 0 }] }];
  for (const snap of data.groupSnapshots) {
    const groups = [...snap.groups]
      .sort((a, b) => a.gap_seconds - b.gap_seconds)
      .map((g) => ({ kind: g.kind, n: g.rider_ids.length, gap: Math.round(g.gap_seconds * 10) / 10 }));
    frames.push({ km: snap.km, groups });
  }
  frames.sort((a, b) => a.km - b.km);
  return frames;
}

// ---------------------------------------------------------------------------
// 4) Beats — spillerens sprog, bygget PAA hændelserne (ingen fri fantasi).
// ---------------------------------------------------------------------------

const cap = (s) => String(s).replace(/^./, (c) => c.toUpperCase());

function buildBeats(data) {
  const ev = data.timeline.events;
  const nm = (id) => data.rider_names[id] ?? id;
  const inc = data.incidents;
  const route = data.route;
  const find = (type, from = 0) => ev.find((e) => e.type === type && e.km >= from);
  const komAt = (km) => ev.find((e) => e.type === "kom_passage" && Math.abs(e.km - km) < 0.01);

  const crash1 = inc.find((x) => x.kind === "crash");
  const mech = inc.find((x) => x.kind === "mechanical" && x.helper_assist);
  const brk = find("breakaway_formed");
  const sprint = find("intermediate_sprint");
  const caught = find("breakaway_caught");
  const finish = find("finish");
  const decided = find("sprint_decided");
  const komMid = ev.find((e) => e.type === "kom_passage" && e.km > brk.km && e.km < route.distance_km - 20);
  const komLast = [...ev].reverse().find((e) => e.type === "kom_passage" && e.km < route.distance_km);
  const firstDescentKm = ev.find((e) => e.type === "finale_attack" && e.params?.direction === "descent")?.km;
  const descentAttacks = ev.filter(
    (e) => e.type === "finale_attack" && e.params?.direction === "descent" && Math.abs(e.km - firstDescentKm) < 0.01,
  );
  const crashLate = [...inc].reverse().find((x) => x.kind === "crash" && x.km > (komLast?.km ?? 0));
  const snapAtKom = data.groupSnapshots.find((s) => Math.abs(s.km - (komLast?.km ?? -1)) < 0.01);
  const clearCount = snapAtKom ? snapAtKom.groups.slice().sort((a, b) => a.gap_seconds - b.gap_seconds)[0].rider_ids.length : 2;

  const top = data.results;
  const winner = nm(top[0].rider_id);
  const second = nm(top[1].rider_id);
  const winGap = Math.floor(top[1].time_seconds - top[0].time_seconds);

  const nEn = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const nDa = ["", "en", "to", "tre", "fire", "fem", "seks", "syv", "otte", "ni", "ti"];
  const brkN = brk.params.rider_ids?.length ?? 0;
  const attackN = descentAttacks.length; // antal angrebs-grupper paa nedkoerslen

  const beats = [
    {
      km: 0,
      icon: route.weather?.kind === "wind" ? "wind" : "flag",
      en: `Stage ${data.pick.stage_number}. ${route.distance_km} km through the high mountains, and a windy day.`,
      da: `${data.pick.stage_number}. etape. ${route.distance_km} km i højbjergene, og det blæser.`,
      hold: 1.0,
    },
    {
      km: crash1.km,
      icon: "crash",
      tone: "hit",
      en: `${nm(crash1.rider_id)} goes down early. He loses time and rides on.`,
      da: `${nm(crash1.rider_id)} går ned tidligt. Han taber tid og kører videre.`,
      hold: 0.8,
    },
    {
      km: sprint.km,
      icon: "sprint",
      en: `Intermediate sprint. ${nm(sprint.params.top[0].rider_id)} takes it.`,
      da: `Indlagt spurt. ${nm(sprint.params.top[0].rider_id)} tager den.`,
      hold: 0.7,
    },
    {
      km: brk.km,
      icon: "break",
      tone: "lead",
      en: `The break goes. ${cap(nEn[brkN] ?? brkN)} riders up the road.`,
      da: `Udbruddet er væk. ${cap(nDa[brkN] ?? brkN)} mand foran.`,
      hold: 0.9,
    },
    {
      km: komMid.km,
      icon: "mountain",
      en: `${komMid.params.name}. The break splits, and so does the bunch.`,
      da: `${komMid.params.name}. Udbruddet knækker, og feltet deler sig.`,
      hold: 0.7,
    },
    {
      km: descentAttacks[0].km,
      icon: "attack",
      en: `Attacks on the descent. ${cap(nEn[attackN] ?? attackN)} groups take the risk.`,
      da: `Angreb på nedkørslen. ${cap(nDa[attackN] ?? attackN)} grupper tager chancen.`,
      hold: 0.6,
    },
    {
      km: mech.km,
      icon: "wheel",
      en: `Puncture for ${nm(mech.rider_id)}. A teammate hands him a wheel.`,
      da: `Punktering til ${nm(mech.rider_id)}. En holdkammerat giver ham et hjul.`,
      hold: 0.9,
    },
    {
      km: caught.km,
      icon: "caught",
      en: `Caught. The break is back in the bunch at the foot of the last climb.`,
      da: `Fanget. Udbruddet er tilbage i feltet ved foden af det sidste bjerg.`,
      hold: 0.8,
    },
    {
      km: komLast.km,
      icon: "mountain",
      tone: "lead",
      en: `${komLast.params.name}. ${cap(nEn[clearCount] ?? clearCount)} riders go clear over the top.`,
      da: `${komLast.params.name}. ${cap(nDa[clearCount] ?? clearCount)} ryttere kommer fri over toppen.`,
      hold: 0.8,
    },
    {
      km: crashLate.km,
      icon: "crash",
      tone: "hit",
      en: `${nm(crashLate.rider_id)} goes down on the descent and loses time.`,
      da: `${nm(crashLate.rider_id)} går ned på nedkørslen og taber tid.`,
      hold: 0.7,
    },
    {
      km: finish.km,
      icon: "finish",
      tone: "win",
      en: `${winner} wins the sprint. ${winGap} seconds to ${second}.`,
      da: `${winner} vinder spurten. ${winGap} sekunder til ${second}.`,
      hold: 0.0,
    },
  ];

  for (const b of beats) if (!Number.isFinite(b.km)) throw new Error(`beat uden km: ${b.en}`);
  return { beats, decidedType: decided.params.finale_type };
}

// Tidsplan: 30 s i alt. Hver etape mellem to beats faar tid efter afstand
// (jaevnt tempo), og hvert beat faar en lille pause.
function buildSchedule(beats, distanceKm, totalSeconds = 30, outroSeconds = 3.6) {
  const holds = beats.reduce((a, b) => a + (b.hold ?? 0.7), 0);
  const travelBudget = totalSeconds - outroSeconds - holds;
  const legs = [];
  for (let i = 1; i < beats.length; i++) legs.push(beats[i].km - beats[i - 1].km);
  const totalKm = legs.reduce((a, b) => a + b, 0);
  // Blanding af "efter afstand" og "lige meget tid" saa de 50 km uden
  // hændelser ikke sluger halvdelen af filmen.
  const weights = legs.map((d) => 0.55 * (d / totalKm) + 0.45 * (1 / legs.length));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  const keys = [{ t: 0, km: beats[0].km, beat: 0 }];
  t += beats[0].hold ?? 0.7;
  keys.push({ t, km: beats[0].km, beat: null });
  for (let i = 1; i < beats.length; i++) {
    t += (travelBudget * weights[i - 1]) / wsum;
    keys.push({ t, km: beats[i].km, beat: i });
    t += beats[i].hold ?? 0.7;
    keys.push({ t, km: beats[i].km, beat: null });
  }
  return { keys, endT: t, total: totalSeconds };
}

// ---------------------------------------------------------------------------
// 5) HTML
// ---------------------------------------------------------------------------

const STRINGS = {
  en: {
    lang: "en",
    eyebrow: "Race replay",
    radar: "Race radar",
    result: "Stage result",
    kmLabel: "KM",
    togo: "km to go",
    onroad: "On the road",
    riders: "riders",
    rider: "rider",
    legend: { lead: "Lead", peloton: "Peloton", chase: "Chase", grupetto: "Grupetto" },
    note: "Positions are schematic — gaps are shown enlarged so you can read them.",
    tag: "Race engine v4 ·",
    tagB: "on the way for season 4",
    site: "cyclingzone.org",
    meta: (d) => `Stage ${d.pick.stage_number} · ${d.route.distance_km} km · High mountain · Windy`,
  },
  da: {
    lang: "da",
    eyebrow: "Løbsafspilning",
    radar: "Løbsradar",
    result: "Etaperesultat",
    kmLabel: "KM",
    togo: "km tilbage",
    onroad: "Ude på vejen",
    riders: "ryttere",
    rider: "rytter",
    legend: { lead: "Front", peloton: "Felt", chase: "Jagt", grupetto: "Grupetto" },
    note: "Positionerne er skematiske — afstandene er forstørret, så de kan læses.",
    tag: "Løbsmotor v4 ·",
    tagB: "på vej til sæson 4",
    site: "cyclingzone.org",
    meta: (d) => `${d.pick.stage_number}. etape · ${d.route.distance_km} km · Højbjerge · Blæst`,
  },
};

const ICONS = {
  flag: '<path d="M4 15V3h11l-1.6 3L15 9H4"/><path d="M4 21V3"/>',
  wind: '<path d="M3 8h9a3 3 0 1 0-3-3"/><path d="M3 13h13a3 3 0 1 1-3 3"/><path d="M3 18h7"/>',
  crash: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/>',
  wheel: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 3.5v6M12 14.5v6M3.5 12h6M14.5 12h6"/>',
  sprint: '<path d="M4 18h16"/><path d="M6 18V9l6-4 6 4v9"/>',
  break: '<circle cx="6.5" cy="12" r="2.4"/><circle cx="12.5" cy="9" r="2.4"/><circle cx="18" cy="13" r="2.4"/>',
  mountain: '<path d="M2 19 9 6l4.5 8 2.5-3.5L22 19H2Z"/>',
  attack: '<path d="M13 3 4 14h7l-1 7 9-11h-7l1-7Z"/>',
  caught: '<path d="M3 12h11"/><path d="M11 7.5 15.5 12 11 16.5"/><circle cx="19" cy="12" r="2.4"/>',
  finish: '<path d="M5 21V4"/><path d="M5 5h14v9H5"/><path d="M5 9.5h14M12 5v9"/>',
};

function svgIcon(name) {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ICONS.flag}</svg>`;
}

const CLIENT_JS = String.raw`
(function () {
  var D = window.__REPLAY__;
  var S = D.ui;
  var road = document.getElementById('road');
  var svgns = 'http://www.w3.org/2000/svg';
  var W = D.svg.w, H = D.svg.h, PAD_L = D.svg.padL, PAD_R = D.svg.padR, TOP = D.svg.top, BOT = D.svg.bot;
  var dist = D.distanceKm;
  var maxE = D.maxElev;

  function X(km) { return PAD_L + (km / dist) * (W - PAD_L - PAD_R); }
  function Y(e) { return H - BOT - (e / maxE) * (H - TOP - BOT); }

  // hoejde ved vilkaarlig km (lineaer mellem profilpunkter)
  var P = D.profile;
  function elevAt(km) {
    if (km <= P[0][0]) return P[0][1];
    var lo = 0, hi = P.length - 1;
    while (lo < hi - 1) { var mid = (lo + hi) >> 1; if (P[mid][0] <= km) lo = mid; else hi = mid; }
    var a = P[lo], b = P[hi];
    var t = (km - a[0]) / Math.max(0.001, b[0] - a[0]);
    return a[1] + (b[1] - a[1]) * t;
  }

  // ── statisk lag: profil, bjerge, maal ────────────────────────────────────
  var line = '', area = '';
  for (var i = 0; i < P.length; i++) {
    var x = X(P[i][0]).toFixed(2), y = Y(P[i][1]).toFixed(2);
    line += (i === 0 ? 'M' : 'L') + x + ' ' + y + ' ';
  }
  area = line + 'L' + X(dist).toFixed(2) + ' ' + (H - BOT) + ' L' + X(0).toFixed(2) + ' ' + (H - BOT) + ' Z';
  document.getElementById('pf-fill').setAttribute('d', area);
  document.getElementById('pf-line').setAttribute('d', line);

  var marks = document.getElementById('marks');
  function el(tag, attrs, text) {
    var n = document.createElementNS(svgns, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    marks.appendChild(n);
    return n;
  }
  for (var c = 0; c < D.climbs.length; c++) {
    var cl = D.climbs[c];
    var cx = X(cl.km), cy = Y(cl.elev);
    el('line', { x1: cx, y1: cy - 4, x2: cx, y2: TOP + 14, class: 'pf-axis' });
    el('text', { x: cx, y: TOP + 8, class: 'pf-cl', 'text-anchor': cl.km > dist * 0.72 ? 'end' : 'middle' }, cl.label);
  }
  el('line', { x1: X(dist), y1: H - BOT, x2: X(dist), y2: TOP + 2, class: 'pf-fin' });
  el('text', { x: X(dist) - 6, y: TOP - 4, class: 'pf-fin-t', 'text-anchor': 'end' }, S.finishLabel);
  var ticks = document.getElementById('ticks');
  for (var tk = 0; tk <= dist; tk += 25) {
    var tx = X(tk);
    var tl = document.createElementNS(svgns, 'line');
    tl.setAttribute('x1', tx); tl.setAttribute('x2', tx);
    tl.setAttribute('y1', H - BOT); tl.setAttribute('y2', H - BOT + 5);
    tl.setAttribute('class', 'pf-axis');
    ticks.appendChild(tl);
    var tt = document.createElementNS(svgns, 'text');
    tt.setAttribute('x', tx); tt.setAttribute('y', H - BOT + 18);
    tt.setAttribute('class', 'pf-tick'); tt.setAttribute('text-anchor', tk === 0 ? 'start' : 'middle');
    tt.textContent = tk;
    ticks.appendChild(tt);
  }

  // ── dynamisk lag ─────────────────────────────────────────────────────────
  var riders = document.getElementById('riders');
  var cursor = document.getElementById('cursor');
  var kmOut = document.getElementById('kmv');
  var togo = document.getElementById('togo');
  var list = document.getElementById('tl');
  var radarCard = document.querySelector('.right .card');
  var gapsEl = document.getElementById('gaps');
  var resCard = document.getElementById('res');

  function fmtGap(sec) {
    var v = Math.floor(sec);
    if (v <= 0) return '—';
    var m = Math.floor(v / 60);
    return m > 0 ? '+' + m + ':' + String(v % 60 < 10 ? '0' : '') + (v % 60) : '+0:' + (v < 10 ? '0' : '') + v;
  }
  var gapRows = [];
  function drawGaps(gs) {
    var vis = gs.filter(function (g) { return g.alpha > 0.5; });
    var maxN = Math.max.apply(null, vis.map(function (x) { return x.n; }));
    var bigIdx = 0;
    for (var q = 0; q < vis.length; q++) if (vis[q].n === maxN) { bigIdx = q; break; }
    // Feltet skal ALTID vaere med, ogsaa naar det er langt tilbage.
    var show = vis.slice(0, 3);
    if (bigIdx >= 3) show.push(vis[bigIdx]); else if (vis.length > 3) show.push(vis[3]);
    while (gapRows.length < show.length) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="sw"></span><span class="lb"></span><span class="ct tab"></span><span class="gp tab"></span>';
      gapsEl.appendChild(li);
      gapRows.push(li);
    }
    for (var i = 0; i < gapRows.length; i++) {
      if (i >= show.length) { gapRows[i].style.display = 'none'; continue; }
      gapRows[i].style.display = '';
      var g = show[i];
      var isLead = i === 0 && g.n <= 14;
      var isBig = !isLead && g.n === maxN;
      var cls = isLead ? 'a' : isBig ? 'b' : g.kind === 'gruppetto' ? 'd' : 'c';
      var lab = isLead ? S.legend.lead : isBig ? S.legend.peloton : g.kind === 'gruppetto' ? S.legend.grupetto : S.legend.chase;
      gapRows[i].className = isLead ? 'lead' : '';
      gapRows[i].children[0].className = 'sw ' + cls;
      gapRows[i].children[1].textContent = lab;
      gapRows[i].children[2].textContent = g.n + ' ' + (g.n === 1 ? S.rider : S.riders);
      gapRows[i].children[3].textContent = i === 0 ? '—' : fmtGap(g.gap - vis[0].gap);
    }
  }

  var frames = D.frames;
  function frameAt(km) {
    var a = frames[0], b = frames[frames.length - 1];
    for (var i = 0; i < frames.length - 1; i++) {
      if (km >= frames[i].km && km <= frames[i + 1].km) { a = frames[i]; b = frames[i + 1]; break; }
      if (km > frames[frames.length - 1].km) { a = b = frames[frames.length - 1]; }
    }
    var t = b.km === a.km ? 1 : (km - a.km) / (b.km - a.km);
    t = Math.max(0, Math.min(1, t));
    var n = Math.max(a.groups.length, b.groups.length);
    var out = [];
    for (var g = 0; g < n; g++) {
      var inA = g < a.groups.length, inB = g < b.groups.length;
      var ga = inA ? a.groups[g] : a.groups[a.groups.length - 1];
      var gb = inB ? b.groups[g] : b.groups[b.groups.length - 1];
      var fadeA = inA ? 1 : 0, fadeB = inB ? 1 : 0;
      out.push({
        kind: t < 0.5 ? ga.kind : gb.kind,
        n: Math.max(1, Math.round((inA ? ga.n : gb.n) + ((inB ? gb.n : ga.n) - (inA ? ga.n : gb.n)) * t)),
        gap: ga.gap + (gb.gap - ga.gap) * t,
        alpha: fadeA + (fadeB - fadeA) * t
      });
    }
    return out;
  }

  function gapToKm(g) { return D.gapKmScale * Math.sqrt(Math.max(0, g)); }
  // Samme regel som panelet: front (lille gruppe) = guld, stoerste gruppe =
  // felt, gruppetto = mork, resten = jagt.
  function classFor(g, idx, maxN) {
    if (idx === 0 && g.n <= 14) return 'g-lead';
    if (g.n === maxN) return 'g-pel';
    if (g.kind === 'gruppetto') return 'g-gru';
    return 'g-chase';
  }

  var nodes = [];
  function drawGroups(km) {
    var gs = frameAt(km);
    var big = 0;
    for (var i = 0; i < gs.length; i++) if (gs[i].n > gs[big].n) big = i;
    while (nodes.length < gs.length) {
      var grp = document.createElementNS(svgns, 'g');
      var band = document.createElementNS(svgns, 'ellipse');
      grp.appendChild(band);
      riders.appendChild(grp);
      nodes.push({ g: grp, e: band });
    }
    for (var j = 0; j < nodes.length; j++) {
      if (j >= gs.length) { nodes[j].g.setAttribute('opacity', 0); continue; }
      var gg = gs[j];
      var pos = Math.max(0, km - gapToKm(gg.gap - gs[0].gap));
      var cx = X(pos), cy = Y(elevAt(pos)) - 9;
      var rx = Math.min(24, 3.2 + Math.sqrt(gg.n) * 1.8);
      var ry = Math.min(5.2, 2.9 + Math.sqrt(gg.n) * 0.2);
      nodes[j].g.setAttribute('opacity', (0.35 + 0.65 * gg.alpha).toFixed(3));
      nodes[j].e.setAttribute('cx', cx.toFixed(2));
      nodes[j].e.setAttribute('cy', cy.toFixed(2));
      nodes[j].e.setAttribute('rx', rx.toFixed(2));
      nodes[j].e.setAttribute('ry', ry.toFixed(2));
      nodes[j].e.setAttribute('class', 'grp ' + classFor(gg, j, gs[big].n));
    }
    cursor.setAttribute('x1', X(km)); cursor.setAttribute('x2', X(km));
    drawGaps(gs);
  }

  // ── beats ────────────────────────────────────────────────────────────────
  var shown = 0;
  function pushBeat(i) {
    var b = D.beats[i];
    var li = document.createElement('li');
    if (b.tone) li.className = b.tone;
    li.innerHTML = '<span class="km tab">' + b.km.toFixed(1) + '</span>' +
      '<span class="ic">' + b.icon + '</span>' +
      '<span class="txt">' + b.text + '</span>';
    li.style.opacity = 0;
    li.style.transform = 'translateY(8px)';
    list.appendChild(li);
    requestAnimationFrame(function () {
      li.style.transition = 'opacity .45s ease, transform .45s ease';
      li.style.opacity = 1; li.style.transform = 'none';
    });
    var items = list.children;
    for (var k = 0; k < items.length; k++) items[k].classList.toggle('past', k < items.length - 1);
    while (list.children.length > 7) list.removeChild(list.children[0]);
    // markér paa profilen
    if (b.mark) {
      var mk = document.createElementNS(svgns, 'circle');
      mk.setAttribute('cx', X(b.km)); mk.setAttribute('cy', Y(elevAt(b.km)) - 9);
      mk.setAttribute('r', 3.2);
      mk.setAttribute('class', 'pin ' + b.mark);
      marks.appendChild(mk);
    }
  }

  // ── klok ─────────────────────────────────────────────────────────────────
  var keys = D.keys;
  function kmAt(t) {
    if (t <= keys[0].t) return keys[0].km;
    for (var i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) {
        var a = keys[i], b = keys[i + 1];
        if (b.t === a.t) return b.km;
        var u = (t - a.t) / (b.t - a.t);
        var e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        return a.km + (b.km - a.km) * e;
      }
    }
    return keys[keys.length - 1].km;
  }

  var START_DELAY = 0.7;
  var t0 = null;
  function tick(now) {
    if (t0 === null) t0 = now;
    var t = (now - t0) / 1000 - START_DELAY;
    var tc = Math.max(0, t);
    var km = kmAt(tc);
    drawGroups(km);
    kmOut.textContent = km.toFixed(1);
    togo.textContent = (dist - km).toFixed(0) + ' ' + S.togo;
    while (shown < D.beats.length && tc >= D.beats[shown].t) { pushBeat(shown); shown++; }
    if (tc >= D.finishT && !resCard.classList.contains('in')) { resCard.classList.add('in'); radarCard.classList.add('out'); }
    if (tc < D.endT + 3) requestAnimationFrame(tick);
  }
  drawGroups(0);
  requestAnimationFrame(tick);
})();
`;

function fmtGap(seconds) {
  const s = Math.floor(seconds);
  if (s <= 0) return "";
  const m = Math.floor(s / 60);
  return m > 0 ? `+${m}:${String(s % 60).padStart(2, "0")}` : `+0:${String(s).padStart(2, "0")}`;
}

function renderHtml(lang, data) {
  const S = STRINGS[lang];
  const route = data.route;
  const profile = buildProfile(route);
  const maxElev = Math.max(...profile.map((p) => p[1])) * 1.16;
  const frames = buildFrames(data);
  const { beats } = buildBeats(data);
  const sched = buildSchedule(beats, route.distance_km);

  // beat -> tid
  const beatTimes = [];
  for (const k of sched.keys) if (k.beat != null) beatTimes[k.beat] = k.t;

  const clientBeats = beats.map((b, i) => ({
    km: b.km,
    t: beatTimes[i],
    icon: svgIcon(b.icon),
    text: b[lang],
    tone: b.tone ?? "",
    mark: b.tone === "hit" ? "hit" : b.tone === "win" ? "win" : "",
  }));

  const climbs = route.waypoints
    .filter((w) => w.kind === "kom")
    .map((w) => {
      const seg = route.segments.find((s) => s.kind === "climb" && Math.abs(s.to_km - w.km) < 0.01);
      return { km: w.km, elev: seg ? seg.top_elevation_m : 0, label: `${w.name} · ${w.category}` };
    });

  const payload = {
    distanceKm: route.distance_km,
    profile,
    maxElev,
    climbs,
    frames,
    beats: clientBeats,
    keys: sched.keys,
    endT: sched.endT,
    finishT: beatTimes[beats.length - 1] + 1.7,
    // Skematisk afstandsskala: sqrt gir laesbare huller BAADE ved 20 s og
    // ved 7 minutter (en ren km/t-omregning ville goere 25 s usynlig).
    gapKmScale: 1.05,
    svg: { w: 960, h: 300, padL: 18, padR: 18, top: 34, bot: 34 },
    ui: {
      togo: S.togo,
      finishLabel: lang === "da" ? "MÅL" : "FINISH",
      legend: S.legend,
      riders: S.riders,
      rider: S.rider,
    },
  };

  const fonts = readFileSync(join(POSTER_DIR, "fonts.css"), "utf8");
  const poster = readFileSync(join(POSTER_DIR, "poster.css"), "utf8");
  const wordmark = readFileSync(join(POSTER_DIR, "wordmark-ondark.svg"), "utf8").replace(/<\?xml[^>]*\?>/, "").trim();

  const top5 = data.results.slice(0, 5);
  const resRows = top5
    .map(
      (r) =>
        `<tr><td class="rank tab">${r.rank}</td><td class="nm">${data.rider_names[r.rider_id] ?? r.rider_id}</td><td class="gp tab">${
          r.rank === 1 ? (lang === "da" ? "Vinder" : "Winner") : fmtGap(r.time_seconds - top5[0].time_seconds)
        }</td></tr>`,
    )
    .join("");

  const winnerLine = beats[beats.length - 1][lang];
  const title = lang === "da" ? "Cycling Zone · løbsafspilning" : "Cycling Zone · race replay";

  return `<!doctype html>
<html lang="${S.lang}"><head><meta charset="utf-8"><title>${title}</title>
<style>${fonts}</style>
<style>${poster}</style>
<style>
html,body{overflow:hidden;background:var(--bg)}
.sheet{padding:38px 54px 30px}
.hd{display:flex;align-items:flex-end;justify-content:space-between;gap:30px;padding:18px 0 14px}
.hd h1{font-size:58px;margin:0;line-height:.92}
.hd .sub{font-family:'Inter Tight',sans-serif;font-size:14.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--t3);margin-top:9px}
.kmbox{text-align:right;white-space:nowrap}
.kmbox .lab{font-family:'Inter Tight',sans-serif;font-size:11px;font-weight:600;letter-spacing:.2em;color:var(--t3)}
.kmbox .v{font-family:'Bebas Neue',Impact,sans-serif;font-size:74px;line-height:.86;color:var(--gold);font-variant-numeric:tabular-nums;letter-spacing:.01em}
.kmbox .togo{font-family:'Inter Tight',sans-serif;font-variant-numeric:tabular-nums;font-size:13px;letter-spacing:.08em;color:var(--t3);margin-top:4px}
.grid{display:grid;grid-template-columns:1fr 452px;gap:30px;align-items:stretch;flex:1;min-height:0}
.left{display:flex;flex-direction:column;gap:16px;min-width:0}
.left .pfcard{height:346px;display:flex;flex-direction:column;padding:12px 14px 6px}
.left .gapcard{flex:1;display:flex;flex-direction:column;padding:15px 22px 12px;min-height:0;overflow:hidden}
.gaps{list-style:none;margin-top:2px;overflow:hidden}
.gaps li{display:grid;grid-template-columns:22px 1fr 92px 78px;align-items:center;gap:12px;
  padding:7px 0;border-bottom:1px solid var(--border-2)}
.gaps li:last-child{border-bottom:0}
.gaps .sw{height:8px;border-radius:9999px}
.gaps .sw.a{background:var(--gold)}.gaps .sw.b{background:#cfd4e2}.gaps .sw.c{background:#7d8ba3}.gaps .sw.d{background:#4b5265}
.gaps .lb{font-family:'Inter Tight',sans-serif;font-size:16px;font-weight:600;letter-spacing:.01em;color:var(--t1)}
.gaps .ct{font-family:'Inter Tight',sans-serif;font-variant-numeric:tabular-nums;font-size:14.5px;color:var(--t2);text-align:right}
.gaps .gp{font-family:'Inter Tight',sans-serif;font-variant-numeric:tabular-nums;font-size:16px;color:var(--t2);text-align:right}
.gaps li.lead .gp{color:var(--gold-t)}
.right{position:relative;min-width:0}
.right .card{height:100%;display:flex;flex-direction:column;padding:20px 22px}
#road{width:100%;height:100%;flex:1;display:block}
.legend{display:flex;align-items:center;gap:22px;padding-top:12px;margin-top:auto;border-top:1px solid var(--border-2)}
.pf-tick{font-family:'Inter Tight',sans-serif;font-size:11px;fill:var(--t3);letter-spacing:.06em}
.lg{display:flex;align-items:center;gap:8px;font-family:'Inter Tight',sans-serif;font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--t3)}
.lg i{display:block;width:16px;height:7px;border-radius:9999px}
.lg i.a{background:var(--gold)}.lg i.b{background:#cfd4e2}.lg i.c{background:#7d8ba3}.lg i.d{background:#4b5265}
.note{margin-left:auto;font-size:12.5px;color:var(--t3);text-transform:none;letter-spacing:0}
.grp{stroke:none}
.g-lead{fill:var(--gold)}
.g-pel{fill:#cfd4e2}
.g-chase{fill:#7d8ba3}
.g-gru{fill:#4b5265}
.pin{fill:none;stroke-width:1.6;stroke:var(--danger)}
.pin.win{stroke:var(--gold);fill:var(--gold)}
#cursor{stroke:var(--gold);stroke-width:1;opacity:.42}
.tl{flex:1;overflow:hidden}
.tl li{display:grid;grid-template-columns:52px 26px 1fr;align-items:start;padding:11px 0;border-bottom:1px solid var(--border-2);transition:color .5s ease}
.tl li .km{font-family:'Inter Tight',sans-serif;font-variant-numeric:tabular-nums;font-size:13px;color:var(--t3);text-align:right;padding-right:12px;padding-top:3px}
.tl li .ic{color:var(--t2);padding-top:2px}
.tl li .txt{padding-left:2px;font-size:16.5px;line-height:1.38;color:var(--t1)}
.tl li.past .txt{color:var(--t2)}
.tl li.past .ic{color:var(--t3)}
.tl li.hit .ic{color:var(--danger)}
.tl li.lead .ic{color:var(--gold-t)}
.tl li.win .ic{color:var(--gold)}
.tl li.win .txt{color:var(--t1)}
#res{position:absolute;left:0;right:0;top:0;bottom:0;background:var(--card);border:1px solid var(--border);border-radius:var(--r);
  padding:20px 22px 18px;display:flex;flex-direction:column;
  opacity:0;transform:translateY(22px);transition:opacity .5s ease,transform .6s cubic-bezier(.2,.7,.3,1)}
#res.in{opacity:1;transform:none}
#res .res{margin-top:4px}
#res .res td{padding:13px 0}
#res .cap{margin-top:auto;padding-top:16px;border-top:1px solid var(--border);font-size:16.5px;line-height:1.4;color:var(--t2)}
.right .card{transition:opacity .45s ease}
.right .card.out{opacity:0}
#res .res td.gp{text-align:right;font-family:'Inter Tight',sans-serif;font-variant-numeric:tabular-nums;font-size:14.5px;color:var(--t2)}
#res .res tr:first-child td.gp{color:var(--gold-t);font-weight:600}
#res .res tr:first-child td.nm{color:var(--t1)}
.wm{height:26px;width:auto;display:block;opacity:.92}
.wm svg{height:26px;width:auto;display:block}
</style></head>
<body><div class="sheet">
  <div class="top">
    <span class="wm">${wordmark}</span>
    <div class="eyebrow">${S.eyebrow}</div>
  </div>

  <div class="hd">
    <div>
      <h1>${data.pick.race_name}</h1>
      <div class="sub">${S.meta(data)}</div>
    </div>
    <div class="kmbox">
      <div class="lab">${S.kmLabel}</div>
      <div class="v"><span id="kmv">0.0</span></div>
      <div class="togo" id="togo"></div>
    </div>
  </div>

  <div class="grid">
    <div class="left">
      <div class="card pfcard">
        <svg id="road" viewBox="0 0 960 300" preserveAspectRatio="none">
          <path id="pf-fill" class="pf-fill" d=""/>
          <path id="pf-line" class="pf-line" d=""/>
          <line id="cursor" x1="0" y1="34" x2="0" y2="266"/>
          <g id="ticks"></g>
          <g id="marks"></g>
          <g id="riders"></g>
          <line class="pf-axis" x1="18" y1="266" x2="942" y2="266"/>
        </svg>
      </div>
      <div class="card gapcard">
        <div class="slabel">${S.onroad}</div>
        <ul id="gaps" class="gaps"></ul>
        <div class="legend">
          <span class="lg"><i class="a"></i>${S.legend.lead}</span>
          <span class="lg"><i class="b"></i>${S.legend.peloton}</span>
          <span class="lg"><i class="c"></i>${S.legend.chase}</span>
          <span class="lg"><i class="d"></i>${S.legend.grupetto}</span>
          <span class="note">${S.note}</span>
        </div>
      </div>
    </div>

    <div class="right">
      <div class="card">
        <div class="slabel">${S.radar}</div>
        <ul class="tl" id="tl"></ul>
      </div>
      <div id="res">
        <div class="slabel">${S.result}</div>
        <table class="res">${resRows}</table>
        <div class="cap">${winnerLine}</div>
      </div>
    </div>
  </div>

  <div class="bottom">
    <div class="tag">${S.tag} <b>${S.tagB}</b></div>
    <div class="site">${S.site}</div>
  </div>
</div>
<script>window.__REPLAY__ = ${JSON.stringify(payload)};</script>
<script>${CLIENT_JS}</script>
</body></html>
`;
}

// ---------------------------------------------------------------------------
// 6) Optagelse (Playwright recordVideo -> webm, ffmpeg -> mp4 hvis den findes)
// ---------------------------------------------------------------------------

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function record(langs = ["en", "da"], seconds = 32) {
  const pw = await import(pathToFileURL(join(REPO, "frontend", "node_modules", "playwright-core", "index.js")).href).catch(
    () => import("playwright"),
  );
  const chromium = pw.chromium ?? pw.default?.chromium;
  if (!chromium) throw new Error("fandt ikke playwright's chromium");
  for (const lang of langs) {
    const dir = join(HERE, `.rec-${lang}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 1600, height: 900 },
      recordVideo: { dir, size: { width: 1600, height: 900 } },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(join(HERE, `replay-${lang}.html`)).href);
    await page.waitForTimeout(seconds * 1000);
    await ctx.close();
    await browser.close();
    const file = readdirSync(dir).find((f) => f.endsWith(".webm"));
    const webm = join(HERE, `replay-${lang}.webm`);
    rmSync(webm, { force: true });
    renameSync(join(dir, file), webm);
    rmSync(dir, { recursive: true, force: true });
    console.log(`optaget: ${webm}`);
    if (hasFfmpeg()) {
      const mp4 = join(HERE, `replay-${lang}.mp4`);
      execFileSync("ffmpeg", ["-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-r", "30", "-movflags", "+faststart", mp4], { stdio: "ignore" });
      console.log(`konverteret: ${mp4}`);
    } else {
      console.log("ffmpeg blev ikke fundet paa PATH — leverer webm (Discord afspiller webm inline).");
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  if (argHas("sim")) {
    await simulate();
    return;
  }
  const data = readJson(STAGE_JSON);
  for (const lang of ["en", "da"]) {
    const out = join(HERE, `replay-${lang}.html`);
    writeFileSync(out, renderHtml(lang, data));
    console.log(`skrevet: ${out}`);
  }
  if (argHas("record")) await record();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
