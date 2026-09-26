// backend/scripts/dev/v4VisualPack/buildPack.js
// #5804: fra collectorens raa etape-poster til den pakke HTML-siden tegner:
// analyse pr. etape (packCore.analyzeStage), resumé-tal (summarizeAnalyses) og
// et resumé i klart dansk: hvad virker, hvad ser forkert ud, med tal.
//
// REN (ingen I/O). Tallene i resuméet er MAALINGER fra dagens koersel og lander kun
// i den private HTML-side uden for repoet (hard rule 17).

import { analyzeStage, summarizeAnalyses, FAMILY_LABEL, REQUIRED_FAMILIES, WIN_TYPE_LABEL } from "./packCore.js";
import { OWNER_INCIDENT_TARGET } from "../../v4FlipReadiness.mjs";

const pct = (v) => (v == null ? "n/a" : `${Math.round(v * 100)} %`);

function winTypeText(counts) {
  const entries = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]);
  return entries.map(([k, v]) => `${v} ${WIN_TYPE_LABEL[k] ?? k}`).join(", ") || "ingen";
}

/**
 * Resuméets to lister. Hver linje er en konstatering med tal, ikke en dom over
 * balancen: ejeren skal kunne se hvad motoren goer, og hvor den ser forkert ud.
 */
export function buildDanishSummary({ summary, analyses, coverage = [], readiness = null, suite = null }) {
  const works = [];
  const wrong = [];
  const watch = [];
  const s = summary;
  if (s.stages === 0) {
    wrong.push("Ingen etaper blev koert. Pakken er tom.");
    return { works, wrong, watch };
  }

  const groupLabel = (key) => (key.startsWith("senior:") ? `D${key.slice("senior:".length)}` : key.split(":")[0].toUpperCase());
  const missing = coverage.flatMap((c) => c.missingRequired.map((f) => `${groupLabel(c.key)} ${FAMILY_LABEL[f] ?? f}`));
  if (missing.length === 0) {
    works.push(`Alle seks terræntyper (${REQUIRED_FAMILIES.map((f) => FAMILY_LABEL[f]).join(", ")}) er kørt i hver division på S4's første uge.`);
  } else {
    watch.push(`Terræn der ikke findes i første uge og derfor ikke er kørt: ${missing.join(" · ")}.`);
  }

  const high = s.anomalies.hoej;
  if (high === 0) {
    works.push(`Ingen logiske brud i nogen af de ${s.stages} etaper: tidslinjen, udbrudsdommen og resultatlisten er enige hver gang.`);
  } else {
    wrong.push(`${high} alvorlige anomalier på tværs af ${s.stages} etaper (se de røde markeringer pr. etape).`);
  }

  const invalid = analyses.filter((a) => a.anomalies.some((x) => x.code === "timeline_invalid")).length;
  if (invalid === 0) works.push("Motorens egen validator godkendte hver eneste tidslinje, så filmen ville blive gemt på alle etaper.");
  else wrong.push(`${invalid} etape(r) fik tidslinjen afvist af validatoren og ville stå uden film.`);

  works.push(`Samme vinder i v3 og v4 på ${s.sameWinner} af ${s.stages} etaper; i snit ${s.meanTop10Overlap?.toFixed(1)} af top 10 er de samme ryttere.`);

  const fav = s.favorites;
  const favLine = `Favoritten (bedst egnede rytter i feltet til netop den etape) vandt ${fav.winV4}/${fav.stages} i v4 mod ${fav.winV3}/${fav.stages} i v3 og sluttede i top 10 ${fav.top10V4}/${fav.stages} gange i v4 mod ${fav.top10V3}/${fav.stages} i v3.`;
  if (fav.winV4 >= fav.winV3 || fav.top10V4 >= fav.top10V3) works.push(favLine);
  else watch.push(favLine);

  const bw = s.breakaway;
  const bwLine = `Udbrud: dannet undervejs på ${bw.formed} af ${bw.roadStages} linjeløbsetaper; udbrudssejr efter motorens egen dom ${bw.won} (${pct(bw.winShare)}); vinderen havde siddet i et udbrud undervejs ${bw.winnerEverInBreakaway} gange.`;
  if (bw.formed === 0 && bw.roadStages > 0) wrong.push(`${bwLine} Intet udbrud på nogen etape ligner ikke cykelsport.`);
  else if (bw.won === 0 && bw.roadStages >= 8) wrong.push(`${bwLine} Ingen udbrudssejre på en hel uges linjeløb ligner ikke cykelsport.`);
  else works.push(bwLine);

  works.push(`Sejrstyper v4: ${winTypeText(s.winTypesV4)}. v3: ${winTypeText(s.winTypesV3)}.`);

  const incRate = s.riderStarts > 0 ? s.incidentsV4 / s.riderStarts : null;
  const incLine = `Uheld i v4: ${s.incidentsV4} på ${s.riderStarts} rytterstarter (${incRate == null ? "n/a" : `${(incRate * 100).toFixed(1)} %`}); ${s.abandoned} udgik. v3 havde ${s.incidentsV3} uheld på de samme etaper.`;
  if (incRate != null && incRate > OWNER_INCIDENT_TARGET.max) watch.push(`${incLine} Det er over ejer-målet på ca. 1-2 % pr. etape (én uge er en lille stikprøve).`);
  else if (incRate != null && incRate < OWNER_INCIDENT_TARGET.min) watch.push(`${incLine} Det er under ejer-målet på ca. 1-2 % (én uge er en lille stikprøve).`);
  else works.push(incLine);

  const otlNonMountain = analyses.filter((a) => a.anomalies.some((x) => x.code === "otl_non_mountain")).length;
  if (s.otl === 0) watch.push("Ingen ryttere uden for tidsgrænsen i hele ugen, heller ikke på bjergetaperne. Tidsgrænsen blev ikke prøvet af.");
  else works.push(`Tidsgrænse: ${s.otl} ryttere uden for på ${s.stagesWithOtl} etape(r); grupettoen reddede ${s.rescued}.`);
  if (otlNonMountain > 0) {
    const list = analyses.filter((a) => a.anomalies.some((x) => x.code === "otl_non_mountain"));
    const n = list.reduce((sum, a) => sum + a.v4.otl, 0);
    wrong.push(`${otlNonMountain} etape(r) uden bjerge (${[...new Set(list.map((a) => FAMILY_LABEL[a.family] ?? a.family))].join(", ")}) sendte i alt ${n} ryttere uden for tidsgrænsen. På de samme etaper kom v3's sidste mand højst ${Math.round(Math.max(...list.map((a) => a.v3.lastGap)) / 60)} min efter vinderen, v4's op til ${Math.round(Math.max(...list.map((a) => a.v4.lastGap)) / 60)} min.`);
  }

  for (const [family, f] of Object.entries(s.byFamily)) {
    if ((family === "bjerg" || family === "hoejfjeld") && f.meanFinishGroupsV4 <= 1.5) {
      wrong.push(`${FAMILY_LABEL[family]}: i snit kun ${f.meanFinishGroupsV4.toFixed(1)} grupper i mål. Bjergene splitter ikke feltet.`);
    }
    if (family === "flad" && (f.winTypesV4.solo_win ?? 0) > (f.winTypesV4.sprint_win ?? 0)) {
      watch.push(`Flad: flere solosejre (${f.winTypesV4.solo_win ?? 0}) end massespurter (${f.winTypesV4.sprint_win ?? 0}) i v4.`);
    }
  }

  const withCode = (code) => analyses.filter((a) => a.anomalies.some((x) => x.code === code));
  const atFinish = withCode("breakaway_at_finish");
  if (atFinish.length) {
    const fams = [...new Set(atFinish.map((a) => FAMILY_LABEL[a.family] ?? a.family))].join(", ");
    wrong.push(`${atFinish.length} etape(r) (${fams}) hvor udbruddet først 'går' på mållinjen: intet skete undervejs, og spillerens film viser 'Udbrud går' i mål.`);
  }
  const single = withCode("single_segment");
  if (single.length) {
    const fams = [...new Set(single.map((a) => FAMILY_LABEL[a.family] ?? a.family))].join(", ");
    wrong.push(`${single.length} linjeløbsetape(r) (${fams}) er ét langt segment i motoren, så der er intet forløb at vise før målet.`);
  }
  const late = withCode("breakaway_late");
  if (late.length) watch.push(`${late.length} etape(r) hvor udbruddet først dannes i finalen.`);
  const traceMismatch = withCode("trace_breakaway_mismatch").length + withCode("trace_says_no_breakaway_win").length;
  if (traceMismatch) wrong.push(`${traceMismatch} etape(r) hvor motorens udbrudsdom og resultatet ikke stemmer overens.`);
  const beaten = withCode("survived_then_beaten").length;
  if (beaten) watch.push(`${beaten} etape(r) hvor tidslinjen viser 'Udbrud holder' på sidste segment, men udbruddet blev hentet eller slået i finalen. Korrekt efter motorens regel, men spilleren kan læse det som en udbrudssejr.`);

  const divergent = analyses.filter((a) => a.anomalies.some((x) => x.code === "favorite_diverges")).length;
  if (divergent > 0) watch.push(`${divergent} etape(r) hvor favoritten var på podiet i v3 men uden for top 10 i v4.`);
  const dom = analyses.filter((a) => a.anomalies.some((x) => x.code === "team_dominance_v4")).length;
  if (dom > 0) watch.push(`${dom} etape(r) hvor ét hold har fire eller flere i v4's top 10.`);

  if (readiness?.anchors) {
    const ra = readiness.anchors;
    const failed = ra.rows.filter((r) => r.v4.verdict === "FAIL").map((r) => r.label);
    if (failed.length) wrong.push(`Flip-klar-rapporten (faste måle-etaper, 5 seeds): ${ra.v4Pass.length} ankre PASS, ${failed.length} FAIL: ${failed.join("; ")}.`);
    else works.push(`Flip-klar-rapporten: alle ${ra.v4Pass.length} målte ankre PASS.`);
  }
  if (suite) {
    if (suite.fail) wrong.push(`v4-testsuiten: ${suite.fail} af ${suite.tests} tests røde.`);
    else works.push(`Hele v4-testsuiten er grøn: ${suite.pass}/${suite.tests}.`);
  }
  return { works, wrong, watch };
}

/**
 * @param {{meta: object, races: Array<object>, stages: Array<object>}} raw
 * @returns {{meta, races, stages: Array<object>, summary, text}}
 */
export function buildPack({ meta, races, stages }) {
  const raceByKey = new Map(races.map((r) => [r.key, r]));
  const out = [];
  for (const rec of stages) {
    const analysis = analyzeStage(rec);
    const { groupSnapshots: _drop, ...v4Rest } = rec.v4;
    out.push({ ...rec, v4: v4Rest, analysis, race: raceByKey.get(rec.raceKey) ? { key: rec.raceKey } : null });
  }
  out.sort((a, b) => String(a.scheduled_at ?? "").localeCompare(String(b.scheduled_at ?? "")) || a.stage_number - b.stage_number);
  const analyses = out.map((s) => s.analysis);
  const summary = summarizeAnalyses(analyses);
  const text = buildDanishSummary({ summary, analyses, coverage: meta.coverage ?? [], readiness: meta.readiness ?? null, suite: meta.suite ?? null });
  return { meta, races, stages: out, summary, text };
}
