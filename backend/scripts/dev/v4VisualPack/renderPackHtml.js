// backend/scripts/dev/v4VisualPack/renderPackHtml.js
// #5804: pakken -> ÉN selvstaendig HTML-side. Ingen eksterne scripts, ingen
// eksterne stylesheets: al CSS og alle tegninger (SVG) er inline, og den lille
// filter-knap er et par linjer inline JS. Siden kan aabnes direkte fra OneDrive.
//
// REN (ingen I/O). Siden baerer rytter- og holdnavne og maalte tal og skrives
// derfor KUN uden for repoet (hard rule 17); denne fil indeholder ingen af dem.

import { FAMILY_LABEL, REQUIRED_FAMILIES, WIN_TYPE_LABEL, copenhagenLabel, eventLabel, riderIdsOfEvent } from "./packCore.js";

export function esc(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export function fmtGap(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s === 0) return "s.t.";
  const m = Math.floor(s / 60);
  return m > 0 ? `+${m}:${String(s % 60).padStart(2, "0")}` : `+${s}s`;
}

const SQUAD_LABEL = { senior: "", u23: "U23 ", junior: "Junior " };

function divisionLabel(race) {
  if (!race) return "?";
  if (race.syntheticYouth) return `${(SQUAD_LABEL[race.squad] ?? race.squad).trim()} (syntetisk)`;
  if (race.squad && race.squad !== "senior") return `${SQUAD_LABEL[race.squad] ?? race.squad}D${race.tier}`;
  return `D${race.tier}`;
}

const GROUP_COLOR = {
  breakaway: "var(--c-break)",
  peloton: "var(--c-pel)",
  chase: "var(--c-chase)",
  gruppetto: "var(--c-grup)",
  solo: "var(--c-solo)",
};
const GROUP_LABEL = { breakaway: "udbrud", peloton: "felt", chase: "jagtgruppe", gruppetto: "grupetto", solo: "solo" };

const EVENT_MARK = {
  breakaway_formed: "U", breakaway_caught: "H", breakaway_survived: "U!", peloton_splits: "S", group_merged: "M",
  incident: "!", favorite_crack: "F", finale_attack: "A", sprint_decided: "Sp", finish: "Mål",
  outside_time_limit: "TG", grupetto_saved: "G", gc_change: "GC", kom_passage: "KOM", intermediate_sprint: "IS",
};
const EVENT_TONE = {
  incident: "var(--c-bad)", favorite_crack: "var(--c-bad)", outside_time_limit: "var(--c-bad)",
  breakaway_formed: "var(--c-break)", breakaway_caught: "var(--c-break)", breakaway_survived: "var(--c-break)",
  finale_attack: "var(--c-solo)", sprint_decided: "var(--c-pel)", grupetto_saved: "var(--c-grup)",
};

function riderName(race, id) {
  const r = race?.riders?.[id];
  return r?.name ?? `rytter ${String(id).slice(0, 6)}`;
}

function teamName(race, id) {
  const teamId = race?.riders?.[id]?.team;
  const t = teamId != null ? race?.teams?.[teamId] : null;
  return t?.name ?? "";
}

/**
 * Filmen: x = km, y = tidsgab bag teten (kvadratrods-skala, saa baade et udbrud paa
 * 40 s og en grupetto paa 25 min kan ses), én prik pr. gruppe pr. segmentgraense
 * (stoerrelse = antal ryttere), linjer mellem samme gruppe-id. Events som maerker
 * langs toppen.
 */
export function groupKindFromId(id) {
  const m = /^(breakaway|peloton|chase|gruppetto|solo)/u.exec(String(id ?? ""));
  if (m) return m[1];
  return String(id ?? "").startsWith("finale-bunch") ? "peloton" : "chase";
}

export function renderFilmSvg({ snapshots = [], events = [], gapTrack = [], distanceKm = null }) {
  const W = 960;
  const H = 260;
  const L = 52;
  const R = 12;
  const T = 40;
  const B = 26;
  const maxKm = Math.max(Number(distanceKm) || 0, ...snapshots.map((s) => s[0]), ...events.map((e) => e.km), 1);
  const maxGap = Math.max(30, ...snapshots.flatMap((s) => s[1].map((g) => g[2])), ...gapTrack.map((g) => g[2]));
  const x = (km) => L + ((W - L - R) * km) / maxKm;
  const y = (gap) => T + (H - T - B) * Math.sqrt(Math.max(0, gap) / maxGap);
  const parts = [];
  parts.push(`<svg class="film" viewBox="0 0 ${W} ${H}" role="img" aria-label="Etapens forløb: grupper og tidsgab pr. km">`);
  const ticks = [0, 30, 60, 120, 300, 600, 1200, 1800, 3600].filter((g) => g <= maxGap);
  for (const g of ticks) {
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}" class="grid"/>`);
    parts.push(`<text x="${L - 6}" y="${(y(g) + 3).toFixed(1)}" class="axis" text-anchor="end">${g === 0 ? "tet" : fmtGap(g)}</text>`);
  }
  const kmStep = maxKm > 150 ? 25 : maxKm > 60 ? 10 : 5;
  for (let km = 0; km <= maxKm; km += kmStep) {
    parts.push(`<text x="${x(km).toFixed(1)}" y="${H - 8}" class="axis" text-anchor="middle">${km}</text>`);
  }
  parts.push(`<text x="${W - R}" y="${H - 8}" class="axis" text-anchor="end">km</text>`);
  // Linjer pr. gruppe-id
  const pathById = new Map();
  for (const [km, groups] of snapshots) {
    for (const [kind, , gap, id] of groups) {
      if (!pathById.has(id)) pathById.set(id, { kind, pts: [] });
      pathById.get(id).pts.push([x(km), y(gap)]);
    }
  }
  // Tidslinjens gab-maalinger (gap_update) mellem segmentgraenserne.
  for (const [km, id, gap] of gapTrack) {
    if (!pathById.has(id)) pathById.set(id, { kind: groupKindFromId(id), pts: [] });
    pathById.get(id).pts.push([x(km), y(gap)]);
    parts.push(`<circle cx="${x(km).toFixed(1)}" cy="${y(gap).toFixed(1)}" r="1.6" fill="${GROUP_COLOR[groupKindFromId(id)] ?? "var(--muted)"}"><title>km ${km}: ${esc(GROUP_LABEL[groupKindFromId(id)] ?? id)} ${fmtGap(gap)}</title></circle>`);
  }
  for (const { kind, pts } of pathById.values()) {
    pts.sort((a, b) => a[0] - b[0]);
    if (pts.length < 2) continue;
    const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="${GROUP_COLOR[kind] ?? "var(--muted)"}" stroke-width="1.2" opacity="0.55"/>`);
  }
  // Prikker (tyndet ud til hver n'te snapshot hvis der er mange)
  const stride = Math.max(1, Math.ceil(snapshots.length / 90));
  snapshots.forEach(([km, groups], i) => {
    if (i % stride !== 0 && i !== snapshots.length - 1) return;
    for (const [kind, n, gap] of groups) {
      const r = Math.min(9, 1.6 + Math.sqrt(n) * 0.75);
      parts.push(
        `<circle cx="${x(km).toFixed(1)}" cy="${y(gap).toFixed(1)}" r="${r.toFixed(1)}" fill="${GROUP_COLOR[kind] ?? "var(--muted)"}" opacity="0.85">` +
          `<title>km ${km}: ${GROUP_LABEL[kind] ?? kind}, ${n} ryttere, ${fmtGap(gap)}</title></circle>`,
      );
    }
  });
  // Event-maerker
  // Maerker i op til tre raekker; et maerke tager den foerste raekke hvor det
  // ikke rammer det forrige. Er alle fulde, springes det over i tegningen (det
  // staar stadig i tidslinje-tabellen under filmen).
  const rowEnd = [-Infinity, -Infinity, -Infinity];
  for (const ev of events) {
    const mark = EVENT_MARK[ev.type];
    if (!mark || ev.type === "gap_update" || ev.type === "stage_start") continue;
    const ex = x(ev.km);
    const w = 6 + mark.length * 6;
    const row = rowEnd.findIndex((end) => ex - w / 2 > end + 2);
    if (row < 0) continue;
    rowEnd[row] = ex + w / 2;
    const ty = 10 + row * 10;
    const tone = EVENT_TONE[ev.type] ?? "var(--muted)";
    parts.push(`<line x1="${ex.toFixed(1)}" x2="${ex.toFixed(1)}" y1="${ty + 2}" y2="${H - B}" stroke="${tone}" stroke-width="0.6" opacity="0.35"/>`);
    parts.push(
      `<text x="${ex.toFixed(1)}" y="${ty}" class="mark" fill="${tone}" text-anchor="middle">${esc(mark)}<title>km ${ev.km}: ${esc(eventLabel(ev.type))}</title></text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

function eventText(race, ev) {
  const p = ev.params ?? {};
  const ids = riderIdsOfEvent(ev);
  const who = ids.length ? ids.slice(0, 4).map((id) => esc(riderName(race, id))).join(", ") + (ids.length > 4 ? ` +${ids.length - 4}` : "") : "";
  const bits = [];
  if (p.rider_count != null) bits.push(`${p.rider_count} ryttere`);
  if (p.gap_seconds != null) bits.push(fmtGap(p.gap_seconds));
  if (p.win_type) bits.push(WIN_TYPE_LABEL[p.win_type] ?? p.win_type);
  if (p.severity) bits.push(p.severity);
  if (p.kind && ev.type !== "finale_attack") bits.push(p.kind);
  if (p.name) bits.push(esc(p.name));
  if (p.reason) bits.push(esc(p.reason));
  if (Array.isArray(p.top) && p.top.length) bits.push(`top: ${p.top.slice(0, 3).map((id) => esc(riderName(race, id))).join(", ")}`);
  return [who, bits.join(" · ")].filter(Boolean).join(" — ");
}

const SEVERITY_LABEL = { hoej: "alvorlig", middel: "middel", lav: "info" };

function top10Table(race, stage) {
  const a = stage.analysis;
  const fav = a.favorite?.rider_id;
  const v4Ids = new Set(a.v4.top10.map((r) => r.rider_id));
  const v3Ids = new Set(a.v3.top10.map((r) => r.rider_id));
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const r4 = a.v4.top10[i];
    const r3 = a.v3.top10[i];
    const cell = (r, other) => {
      if (!r) return `<td></td><td></td>`;
      const cls = [r.rider_id === fav ? "fav" : "", other.has(r.rider_id) ? "both" : ""].filter(Boolean).join(" ");
      const tag = r.status && r.status !== "finished" ? ` <span class="tag">${esc(r.status)}</span>` : "";
      const bw = r.in_breakaway ? ` <span class="tag">udbrud</span>` : "";
      return `<td class="${cls}"><span class="rn">${esc(riderName(race, r.rider_id))}</span>${tag}${bw}<span class="tn">${esc(teamName(race, r.rider_id))}</span></td><td class="num">${fmtGap(r.gap)}</td>`;
    };
    rows.push(`<tr><td class="num rk">${i + 1}</td>${cell(r4, v3Ids)}${cell(r3, v4Ids)}</tr>`);
  }
  return (
    `<table class="top10"><thead><tr><th class="num">#</th><th>v4</th><th class="num">tid</th><th>v3</th><th class="num">tid</th></tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table>`
  );
}

function stageSection(race, stage, idx) {
  const a = stage.analysis;
  const fam = FAMILY_LABEL[stage.family] ?? stage.family;
  const title = race?.stageCount > 1 ? `${esc(race.name)} · etape ${stage.stage_number}/${race.stageCount}` : esc(race?.name ?? "?");
  const chips = a.anomalies
    .map((x) => `<li class="chip sev-${x.severity}"><b>${SEVERITY_LABEL[x.severity] ?? x.severity}</b> ${esc(x.text)}</li>`)
    .join("");
  const favName = a.favorite ? esc(riderName(race, a.favorite.rider_id)) : "n/a";
  const bw = a.breakaway;
  const bwText = !bw.formed
    ? "intet udbrud"
    : bw.formedDuringRace === false
      ? "kun på mållinjen (intet udbrud undervejs)"
      : [
        `${bw.size} har siddet i udbrud`,
        bw.survived ? "et udbrud nåede sidste segment" : bw.caught ? "hentet" : "opløst undervejs",
        bw.engineSaysBreakawayWin ? "udbrudssejr (motorens dom)" : bw.winnerFromBreakaway ? "vinderen havde siddet i udbruddet" : "",
      ].filter(Boolean).join(", ");
  const evRows = stage.v4.events
    .filter((e) => e.type !== "gap_update")
    .map((e) => `<tr><td class="num">${e.km}</td><td>${esc(eventLabel(e.type))}</td><td>${eventText(race, e)}</td></tr>`)
    .join("");
  const v3Ev = (stage.v3.events ?? [])
    .map((e) => `<tr><td class="num">${e.km ?? ""}</td><td>${esc(e.type)}</td><td>${esc(JSON.stringify(e.params ?? {}).slice(0, 140))}</td></tr>`)
    .join("");
  return `
<section class="stage" id="s${idx}" data-div="${esc(divisionLabel(race))}" data-fam="${esc(stage.family)}" data-flag="${a.anomalies.some((x) => x.severity !== "lav") ? "1" : "0"}">
  <header class="stage-h">
    <div class="kicker">${esc(divisionLabel(race))} · ${esc(copenhagenLabel(stage.scheduled_at))} · <span class="fam fam-${esc(stage.family)}">${esc(fam)}</span>${stage.finale_type ? ` · finale ${esc(stage.finale_type)}` : ""}</div>
    <h3>${title}</h3>
    <div class="meta">${stage.distance_km ?? "?"} km · ${stage.elevation_gain_m ?? "?"} hm · ${a.field} ryttere · ${esc(race?.race_class ?? "")}</div>
  </header>
  <div class="facts">
    <div><span class="k">Sejrstype</span><span class="v">v4 ${esc(WIN_TYPE_LABEL[a.v4.winType] ?? a.v4.winType)} · v3 ${esc(WIN_TYPE_LABEL[a.v3.winType] ?? a.v3.winType)}</span></div>
    <div><span class="k">Udbrud (v4)</span><span class="v">${esc(bwText)}</span></div>
    <div><span class="k">Favorit</span><span class="v">${favName}: v4 ${a.favorite?.v4Rank ?? a.favorite?.v4Status ?? "n/a"} · v3 ${a.favorite?.v3Rank ?? "n/a"}</span></div>
    <div><span class="k">Grupper i mål (v4)</span><span class="v num">${a.v4.finishGroups}</span></div>
    <div><span class="k">Uheld</span><span class="v">v4 ${a.v4.incidents} (${a.v4.abandoned} ude) · v3 ${a.v3.incidents}</span></div>
    <div><span class="k">Tidsgrænse (v4)</span><span class="v">${a.v4.otl} uden for · ${a.v4.rescued} reddet</span></div>
    <div><span class="k">Sidste mand</span><span class="v">v4 ${fmtGap(a.v4.lastGap)} · v3 ${fmtGap(a.v3.lastGap)}</span></div>
  </div>
  ${chips ? `<ul class="chips">${chips}</ul>` : `<p class="ok">Ingen anomalier på denne etape.</p>`}
  <figure>${renderFilmSvg({ snapshots: stage.v4.snapshots ?? [], events: stage.v4.events ?? [], gapTrack: stage.v4.gapTrack ?? [], distanceKm: stage.distance_km })}
    <figcaption>v4's film: hver prik er en gruppe ved en segmentgrænse (størrelse = antal ryttere), lodret = tidsgab bag teten. Mærker: U udbrud går · H hentet · U! udbrud når sidste segment · S felt splittes · M grupper samles · A angreb · Sp spurt afgjort · ! uheld · F favorit knækker · KOM bjergpassage · IS indlagt spurt · TG tidsgrænse · G grupetto reddet · GC ny førende.</figcaption>
  </figure>
  ${top10Table(race, stage)}
  <details><summary>v4's tidslinje (${stage.v4.events.filter((e) => e.type !== "gap_update").length} hændelser)</summary><table class="ev"><tbody>${evRows}</tbody></table></details>
  <details><summary>v3's tidslinje (${(stage.v3.events ?? []).length} hændelser, syntetisk)</summary><table class="ev"><tbody>${v3Ev}</tbody></table></details>
</section>`;
}

function coverageTable(pack) {
  const divs = [];
  for (const s of pack.stages) {
    const race = pack.races.find((r) => r.key === s.raceKey);
    const d = divisionLabel(race);
    if (!divs.includes(d)) divs.push(d);
  }
  const families = [...new Set([...REQUIRED_FAMILIES, ...pack.stages.map((s) => s.family)])];
  const cell = (d, f) => {
    const n = pack.stages.filter((s) => s.family === f && divisionLabel(pack.races.find((r) => r.key === s.raceKey)) === d).length;
    return n ? `<td class="num">${n}</td>` : `<td class="num miss">-</td>`;
  };
  return (
    `<table class="cov"><thead><tr><th>Division</th>${families.map((f) => `<th class="num">${esc(FAMILY_LABEL[f] ?? f)}</th>`).join("")}</tr></thead>` +
    `<tbody>${divs.map((d) => `<tr><td>${esc(d)}</td>${families.map((f) => cell(d, f)).join("")}</tr>`).join("")}</tbody></table>`
  );
}

function indexTable(pack) {
  const rows = pack.stages.map((s, i) => {
    const race = pack.races.find((r) => r.key === s.raceKey);
    const a = s.analysis;
    const sev = a.anomalies.some((x) => x.severity === "hoej") ? "hoej" : a.anomalies.some((x) => x.severity === "middel") ? "middel" : "";
    return `<tr><td>${esc(copenhagenLabel(s.scheduled_at))}</td><td>${esc(divisionLabel(race))}</td><td><a href="#s${i}">${esc(race?.name ?? "?")}${race?.stageCount > 1 ? ` e${s.stage_number}` : ""}</a></td>` +
      `<td>${esc(FAMILY_LABEL[s.family] ?? s.family)}</td>` +
      `<td>${esc(riderName(race, a.v4.winner))} <span class="tn">${esc(WIN_TYPE_LABEL[a.v4.winType] ?? a.v4.winType)}</span></td>` +
      `<td>${esc(riderName(race, a.v3.winner))} <span class="tn">${esc(WIN_TYPE_LABEL[a.v3.winType] ?? a.v3.winType)}</span></td>` +
      `<td class="num">${a.top10Overlap}/10</td><td>${sev ? `<span class="dot sev-${sev}"></span>${a.anomalies.length}` : a.anomalies.length || ""}</td></tr>`;
  });
  return (
    `<table class="idx"><thead><tr><th>Tid</th><th>Div.</th><th>Løb</th><th>Terræn</th><th>Vinder v4</th><th>Vinder v3</th><th class="num">Top 10 fælles</th><th>Fund</th></tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table>`
  );
}

function tiles(summary) {
  const f = summary.favorites;
  const t = [
    ["Etaper kørt", `${summary.stages}`],
    ["Samme vinder", `${summary.sameWinner}/${summary.stages}`],
    ["Favorit vinder v4 / v3", `${f.winV4} / ${f.winV3}`],
    ["Udbrudssejre v4", `${summary.breakaway.won}/${summary.breakaway.roadStages}`],
    ["Uden for tidsgrænsen", `${summary.otl}`],
    ["Uheld v4 / v3", `${summary.incidentsV4} / ${summary.incidentsV3}`],
    ["Anomalier (alvorlig/middel)", `${summary.anomalies.hoej} / ${summary.anomalies.middel}`],
  ];
  return `<div class="tiles">${t.map(([k, v]) => `<div class="tile"><div class="tv num">${esc(v)}</div><div class="tk">${esc(k)}</div></div>`).join("")}</div>`;
}

const CSS = `
:root{--bg:#f7f5f0;--fg:#1c1b19;--muted:#6d6a63;--line:#dcd8cf;--card:#fffdf8;--gold:#b8892b;
--c-break:#c2771b;--c-pel:#2f5d8a;--c-chase:#2d8a7a;--c-grup:#8a8680;--c-solo:#b3312c;--c-bad:#b3312c;--c-ok:#2f7a45;--c-mid:#b8892b}
@media (prefers-color-scheme:dark){:root{--bg:#141412;--fg:#ecE8df;--muted:#9c978d;--line:#34322d;--card:#1b1a17;
--c-break:#e3a14c;--c-pel:#79a7d6;--c-chase:#5cc2ae;--c-grup:#8f8b83;--c-solo:#e56b63;--c-bad:#e56b63;--c-ok:#6cc08a;--c-mid:#d9ae55}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:28px 16px 80px}
h1{font-size:28px;line-height:1.15;margin:0 0 6px;letter-spacing:-.01em}h2{font-size:19px;margin:40px 0 12px;padding-top:12px;border-top:1px solid var(--line)}
h3{font-size:18px;margin:2px 0}
.lede{color:var(--muted);margin:0 0 18px}.num{font-variant-numeric:tabular-nums;text-align:right}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:5px;overflow:hidden;margin:18px 0}
.tile{background:var(--card);padding:12px 14px}.tv{font-size:22px;font-weight:600;text-align:left}.tk{font-size:12px;color:var(--muted)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.col{background:var(--card);border:1px solid var(--line);border-radius:5px;padding:14px 16px}
.col h4{margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.06em}
.col ul{margin:0;padding-left:18px}.col li{margin:0 0 8px}
.col.works h4{color:var(--c-ok)}.col.wrong h4{color:var(--c-bad)}.col.watch h4{color:var(--c-mid)}
table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:12px}
.wrap{overflow-x:auto}.miss{color:var(--c-bad)}
a{color:inherit;text-decoration-color:var(--gold);text-underline-offset:3px}
.stage{background:var(--card);border:1px solid var(--line);border-radius:5px;padding:16px;margin:18px 0}
.kicker{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.meta{color:var(--muted);font-size:13px}
.fam{font-weight:600;color:var(--fg)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px 16px;margin:12px 0}
.facts .k{display:block;font-size:11.5px;color:var(--muted)}.facts .v{font-size:13.5px}
.chips{list-style:none;padding:0;margin:8px 0;display:flex;flex-direction:column;gap:4px}
.chip{border-left:3px solid var(--muted);padding:3px 8px;font-size:13px;background:var(--bg)}
.chip.sev-hoej{border-color:var(--c-bad)}.chip.sev-middel{border-color:var(--c-mid)}.chip.sev-lav{border-color:var(--line)}
.ok{color:var(--c-ok);font-size:13px;margin:8px 0}
figure{margin:10px 0}figcaption{font-size:12px;color:var(--muted)}
.film{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:5px;background:var(--bg)}
.film .grid{stroke:var(--line);stroke-width:1}.film .axis{fill:var(--muted);font-size:10px}.film .mark{font-size:9.5px;font-weight:700}
.top10 td.fav .rn{text-decoration:underline;text-decoration-color:var(--gold);text-underline-offset:3px;text-decoration-thickness:2px}
.top10 td.both .rn{font-weight:600}.rn{display:block}.tn{display:block;font-size:11.5px;color:var(--muted)}
.idx .tn{display:inline}.rk{color:var(--muted)}
.tag{font-size:10.5px;border:1px solid var(--line);border-radius:3px;padding:0 4px;color:var(--muted)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:var(--muted)}
.dot.sev-hoej{background:var(--c-bad)}.dot.sev-middel{background:var(--c-mid)}
details{margin-top:8px}summary{cursor:pointer;color:var(--muted);font-size:13px}.ev td{font-size:12.5px}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.filters select,.filters label{font:inherit;font-size:13px}
.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--muted)}.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.notes{font-size:13px;color:var(--muted)}
@media (max-width:640px){h1{font-size:23px}.stage{padding:12px}}
`;

const JS = `
(function(){var d=document.getElementById('f-div'),f=document.getElementById('f-fam'),a=document.getElementById('f-flag');
function run(){var s=document.querySelectorAll('section.stage');for(var i=0;i<s.length;i++){var e=s[i];
var ok=(!d.value||e.dataset.div===d.value)&&(!f.value||e.dataset.fam===f.value)&&(!a.checked||e.dataset.flag==='1');e.style.display=ok?'':'none';}}
d.onchange=f.onchange=a.onchange=run;})();
`;

/** @param {ReturnType<import('./buildPack.js').buildPack>} pack */
export function renderPackHtml(pack) {
  const { meta, summary, text } = pack;
  const raceOf = (key) => pack.races.find((r) => r.key === key);
  const divs = [...new Set(pack.stages.map((s) => divisionLabel(raceOf(s.raceKey))))];
  const fams = [...new Set(pack.stages.map((s) => s.family))];
  const list = (items) => (items.length ? `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : `<p class="notes">Intet.</p>`);
  const sourceText = meta.source === "prod"
    ? "S4-kalenderen fra prod (skrevet)."
    : "S4-kalenderen er ikke skrevet endnu, så etaperne er tørkørslens plan: præcis den kalender buildSeasonCalendar.js --season 4 --first-day 2026-09-28 --uniform-tilt --target-structure s4 ville skrive nu (dry-run, intet skrevet).";
  return `<!doctype html>
<html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>v4 testpakke S4</title><style>${CSS}</style></head>
<body><main>
<div class="kicker">race_engine_v4 · #5804 · privat</div>
<h1>Løbsmotor v4 på S4's første uge</h1>
<p class="lede">v4 og v3 kørt på de samme etaper, de samme startfelter og de samme seeds. Genereret ${esc(copenhagenLabel(meta.generated_at))} på ${meta.runtime_s ?? "?"} s. ${esc(sourceText)}</p>
${tiles(summary)}
<div class="cols">
  <div class="col works"><h4>Virker</h4>${list(text.works)}</div>
  <div class="col wrong"><h4>Ser forkert ud</h4>${list(text.wrong)}</div>
  <div class="col watch"><h4>Hold øje med</h4>${list(text.watch)}</div>
</div>
<h2>Hvad er kørt</h2>
<p class="notes">Uge ${esc(meta.window?.from)} til ${esc(meta.window?.to)}. Én repræsentativ pulje pr. division (alle puljer i en division kører samme kalender). Startfelterne er de rigtige hold og ryttere fra prod i dag, udtaget af assistentens autopick (ingen har udtaget til S4 endnu), uden holdordrer (AI-holdene får deres egen taktik i v4). Flag i prod: v3 ${esc(meta.flags?.race_engine_v3_scoring)}, tidslinje ${esc(meta.flags?.race_stage_timeline)}, v4 ${esc(meta.flags?.race_engine_v4)} (kun læst).</p>
<div class="wrap">${coverageTable(pack)}</div>
${(meta.notes ?? []).length ? `<p class="notes">${meta.notes.map(esc).join("<br>")}</p>` : ""}
<h2>Alle etaper</h2>
<div class="wrap">${indexTable(pack)}</div>
<h2>Etaperne én for én</h2>
<div class="legend"><span><i style="background:var(--c-break)"></i>udbrud</span><span><i style="background:var(--c-pel)"></i>felt</span><span><i style="background:var(--c-chase)"></i>jagtgruppe</span><span><i style="background:var(--c-grup)"></i>grupetto</span><span><i style="background:var(--c-solo)"></i>solo</span><span>Understreget = favoritten · fed = i top 10 hos begge motorer</span></div>
<div class="filters">
  <select id="f-div"><option value="">Alle divisioner</option>${divs.map((d) => `<option>${esc(d)}</option>`).join("")}</select>
  <select id="f-fam"><option value="">Alt terræn</option>${fams.map((f) => `<option value="${esc(f)}">${esc(FAMILY_LABEL[f] ?? f)}</option>`).join("")}</select>
  <label><input type="checkbox" id="f-flag"> Kun etaper med fund</label>
</div>
${pack.stages.map((s, i) => stageSection(raceOf(s.raceKey), s, i)).join("\n")}
<h2>Metode og forbehold</h2>
<ul class="notes">
<li>Motorerne kører gennem raceRunner.buildRaceResults, den samme funktion prod bruger; v4 via broen (createRaceEngineV4Adapter), præcis den sti flaget åbner. Ingen ny motorlogik.</li>
<li>Et etapeløb køres fra etape 1, så træthed, udgåede og klassement er med; kun etaperne i første uge vises.</li>
<li>Favoritten er den rytter i feltet der passer bedst til etapens krav (samme egnethedsmål som assistentens autopick), ikke et bud fra en af motorerne.</li>
<li>Ikke med: holdordrer fra managerne (ingen er sat for S4), formtoppe (peak-planer), bindinger mellem samtidige løb (samme rytter kan stå i to løb samme dag her) og op-/nedrykning ved sæsonskiftet (hold står i deres S3-pulje).</li>
<li>Én uge er en lille stikprøve: rater (udbrud, uheld, tidsgrænse) svinger meget fra uge til uge. Gaterne i flip-klar-rapporten er målt på langt flere etaper.</li>
</ul>
</main><script>${JS}</script></body></html>`;
}
