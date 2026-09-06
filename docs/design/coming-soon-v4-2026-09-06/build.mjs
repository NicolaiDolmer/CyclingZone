/* Builds the 8 coming-soon posters (4 visuals x EN/DA) as standalone HTML,
   then renders each to a 1600x900 PNG with Playwright.
   Content is grounded in docs/RACE_ENGINE_RULES.md 2 / 2c-2g / 9 only:
   no percentages, no thresholds, no caps, no dates. */
import { chromium } from "file:///C:/Dev/CyclingZone/frontend/node_modules/playwright/index.mjs";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

/* ── shared chrome ─────────────────────────────────────────────────────── */
const TAG = {
  en: 'Race engine v4 <b>&middot;</b> on the way for season 4',
  da: 'L&oslash;bsmotor v4 <b>&middot;</b> p&aring; vej til s&aelig;son 4',
};
const EYEBROW = { en: "Coming soon", da: "P&aring; vej" };

const page = (title, lang, inner) => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8">
<link rel="stylesheet" href="fonts.css"><link rel="stylesheet" href="poster.css">
<title>${title}</title></head>
<body><div class="sheet">
  <div class="top">
    <img src="wordmark-ondark.svg" alt="Cycling Zone">
    <div class="eyebrow">${EYEBROW[lang]}</div>
  </div>
  <div class="main">
${inner}
  </div>
  <div class="bottom">
    <div class="tag">${TAG[lang]}</div>
    <div class="site">cyclingzone.org</div>
  </div>
</div></body></html>
`;

/* ── stroke icons (lucide geometry) ────────────────────────────────────── */
const ico = (d, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const IC = {
  ok: ico('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.4 2.4 2.4 4.6-5"/>', 18),
  warn: ico('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 18),
  users: ico('<path d="M16 20v-1.8a3.2 3.2 0 0 0-3.2-3.2H6.2A3.2 3.2 0 0 0 3 18.2V20"/><circle cx="9.5" cy="7.5" r="3.5"/><path d="M21 20v-1.8a3.2 3.2 0 0 0-2.4-3.1"/><path d="M15.5 4.2a3.5 3.5 0 0 1 0 6.6"/>', 20),
  rain: ico('<path d="M17.5 17.5a4.5 4.5 0 0 0-.9-8.9 6 6 0 0 0-11.4 1.9A3.6 3.6 0 0 0 6 17.5"/><path d="M9 19.5 8 22"/><path d="M13 19.5 12 22"/><path d="M17 19.5 16 22"/>', 20),
  road: ico('<path d="M4 21 7 3"/><path d="M20 21 17 3"/><path d="M12 4v3"/><path d="M12 10.5v3"/><path d="M12 17v3"/>', 20),
};

/* ── stage profile (poster 1) ──────────────────────────────────────────── */
const PTS = [
  [0, .10], [14, .14], [28, .11], [40, .16], [48, .42], [56, .60], [64, .44], [72, .22],
  [80, .26], [88, .62], [96, .88], [104, .60], [112, .30], [120, .14], [134, .12],
  [146, .15], [158, .11], [168, .13], [178, .10],
];
const KMAX = 178, W = 900, BASE = 196, TOP = 30;
const px = (km) => (km / KMAX) * W;
const py = (e) => BASE - e * (BASE - TOP);
const elevAt = (km) => {
  for (let i = 1; i < PTS.length; i++) {
    if (km <= PTS[i][0]) {
      const [k0, e0] = PTS[i - 1], [k1, e1] = PTS[i];
      return e0 + ((km - k0) / (k1 - k0)) * (e1 - e0);
    }
  }
  return PTS.at(-1)[1];
};

function profileSvg(labels) {
  const poly = PTS.map(([k, e]) => `${px(k).toFixed(1)},${py(e).toFixed(1)}`).join(" ");
  const dots = [[24, ""], [88, ""], [104, "hit"], [131, ""], [176, "win"]]
    .map(([km, cls]) => `<circle class="pf-dot ${cls}" cx="${px(km).toFixed(1)}" cy="${py(elevAt(km)).toFixed(1)}" r="5.5"/>`)
    .join("");
  const ticks = [0, 50, 100, 150]
    .map((km) => `<line class="pf-axis" x1="${px(km).toFixed(1)}" y1="${BASE}" x2="${px(km).toFixed(1)}" y2="${BASE + 6}"/>` +
      `<text class="pf-tick" x="${px(km).toFixed(1)}" y="${BASE + 21}" text-anchor="${km === 0 ? "start" : "middle"}">${km} km</text>`)
    .join("");
  return `<svg class="profile" viewBox="0 0 ${W + 4} ${BASE + 34}" style="width:100%;height:auto">
  <polygon class="pf-fill" points="${poly} ${W},${BASE} 0,${BASE}"/>
  <polyline class="pf-line" points="${poly}"/>
  <line class="pf-axis" x1="0" y1="${BASE}" x2="${W}" y2="${BASE}"/>
  ${ticks}
  <line class="pf-fin" x1="${W}" y1="16" x2="${W}" y2="${BASE}"/>
  <text class="pf-fin-t" x="${W - 7}" y="11" text-anchor="end">${labels.finish}</text>
  <text class="pf-cl" x="${px(56).toFixed(1)}" y="${(py(.60) - 13).toFixed(1)}" text-anchor="middle">${labels.climb1}</text>
  <text class="pf-cl" x="${px(96).toFixed(1)}" y="${(py(.88) - 13).toFixed(1)}" text-anchor="middle">${labels.climb2}</text>
  ${dots}
</svg>`;
}

/* ── panel strips (poster 4) ───────────────────────────────────────────── */
const SW = 420;
function groupStrip(label) {
  const y = 56, n = 9, x0 = 14, step = (SW - 28) / (n - 1);
  const dots = Array.from({ length: n }, (_, i) => {
    const cx = x0 + i * step;
    if (i === 3) return `<circle cx="${cx.toFixed(1)}" cy="${y}" r="6" fill="#ededf2"/>`;
    if (i === 4) return `<circle cx="${cx.toFixed(1)}" cy="${y}" r="6" fill="none" stroke="#ededf2" stroke-width="2"/>`;
    return `<circle cx="${cx.toFixed(1)}" cy="${y}" r="4.5" fill="#3a3e4d"/>`;
  }).join("");
  const bx1 = x0 + 3 * step - 13, bx2 = x0 + 4 * step + 13;
  return `<svg class="strip" viewBox="0 0 ${SW} 78" style="width:100%;height:auto">
  <line x1="0" y1="${y}" x2="${SW}" y2="${y}" stroke="#2a2d3a" stroke-width="1"/>
  ${dots}
  <path d="M${bx1} 36 L${bx1} 28 L${bx2} 28 L${bx2} 36" fill="none" stroke="#888ba0" stroke-width="1.2"/>
  <text x="${((bx1 + bx2) / 2).toFixed(1)}" y="20" text-anchor="middle" font-family="Inter Tight" font-size="11.5" font-weight="600" fill="#888ba0" letter-spacing="1.5">${label}</text>
</svg>`;
}
const ROUTE = "0,58 52,52 104,56 156,48 208,54 260,46 312,52 364,49 420,53";
function weatherStrip(label) {
  const x = SW * 0.24;
  return `<svg class="strip" viewBox="0 0 ${SW} 78" style="width:100%;height:auto">
  <rect x="${x.toFixed(1)}" y="22" width="${(SW - x).toFixed(1)}" height="42" fill="rgba(157,160,179,.10)"/>
  <line x1="${x.toFixed(1)}" y1="22" x2="${x.toFixed(1)}" y2="64" stroke="#888ba0" stroke-width="1.2" stroke-dasharray="3 3"/>
  <polyline points="${ROUTE}" fill="none" stroke="#ededf2" stroke-width="1.8" stroke-linejoin="round"/>
  <line x1="0" y1="64" x2="${SW}" y2="64" stroke="#2a2d3a" stroke-width="1"/>
  <text x="${(x + 8).toFixed(1)}" y="17" font-family="Inter Tight" font-size="11.5" font-weight="600" fill="#888ba0" letter-spacing="1.5">${label}</text>
</svg>`;
}
function cobbleStrip(labelSectors, labelFinish) {
  const secs = [[248, 30], [296, 24], [340, 32]];
  const hatch = secs.map(([x, w]) =>
    `<rect x="${x}" y="24" width="${w}" height="40" fill="rgba(237,237,242,.14)" stroke="#4a4e5e" stroke-width="1"/>`).join("");
  return `<svg class="strip" viewBox="0 0 ${SW} 86" style="width:100%;height:auto">
  ${hatch}
  <polyline points="${ROUTE}" fill="none" stroke="#ededf2" stroke-width="1.8" stroke-linejoin="round"/>
  <line x1="0" y1="64" x2="${SW}" y2="64" stroke="#2a2d3a" stroke-width="1"/>
  <line x1="${SW - 8}" y1="18" x2="${SW - 8}" y2="64" stroke="#888ba0" stroke-width="1.4"/>
  <text x="248" y="17" font-family="Inter Tight" font-size="11.5" font-weight="600" fill="#888ba0" letter-spacing="1.5">${labelSectors}</text>
  <text x="${SW - 8}" y="81" text-anchor="end" font-family="Inter Tight" font-size="11" fill="#888ba0" letter-spacing="1.3">${labelFinish}</text>
</svg>`;
}

/* ── 01 · the race, stage by stage ─────────────────────────────────────── */
const P1 = {
  en: {
    h1: "The race,<br>stage by stage",
    body: "The race unfolds as a timeline you can follow. The break goes, the climb splits it, the descent, the crash, the sprint.",
    slabel: "In the stage timeline",
    prof: { finish: "Finish", climb1: "First climb", climb2: "Second climb" },
    rows: [
      ["24 km", "", "The break goes. Six riders up the road."],
      ["88 km", "", "Brenner attacks on the second climb."],
      ["104 km", "hit", "Okonkwo goes down on the descent."],
      ["131 km", "", "Puncture for Vasquez, a teammate hands him a wheel."],
      ["176 km", "win", "The sprint. Duarte comes over the line first."],
    ],
  },
  da: {
    h1: "L&oslash;bet,<br>etape for etape",
    body: "L&oslash;bet folder sig ud som en tidslinje du kan f&oslash;lge. Udbruddet g&aring;r, stigningen splitter feltet, nedk&oslash;rslen, styrtet, spurten.",
    slabel: "I etapens tidslinje",
    prof: { finish: "M&aring;l", climb1: "F&oslash;rste stigning", climb2: "Anden stigning" },
    rows: [
      ["24 km", "", "Udbruddet g&aring;r. Seks ryttere af sted."],
      ["88 km", "", "Brenner angriber p&aring; den anden stigning."],
      ["104 km", "hit", "Okonkwo g&aring;r ned i nedk&oslash;rslen."],
      ["131 km", "", "Punktering til Vasquez, en holdkammerat giver ham et hjul."],
      ["176 km", "win", "Spurten. Duarte kommer f&oslash;rst over stregen."],
    ],
  },
};
const build1 = (l) => {
  const c = P1[l];
  return page("The race, stage by stage", l, `
    <div style="display:grid;grid-template-columns:560px 1fr;gap:56px;align-items:center">
      <div>
        <h1>${c.h1}</h1>
        <p class="body">${c.body}</p>
      </div>
      <div class="card">
        ${profileSvg(c.prof)}
        <div class="slabel" style="margin-top:24px">${c.slabel}</div>
        <ul class="tl">
          ${c.rows.map(([km, cls, t]) => `<li class="${cls}"><span class="km">${km}</span><span class="rail"></span><span class="txt">${t}</span></li>`).join("\n          ")}
        </ul>
      </div>
    </div>`);
};

/* ── 02 · your call, every stage ───────────────────────────────────────── */
const P2 = {
  en: {
    h1: "Your call,<br>every stage",
    body: "The role holds for the whole race. The intention is today's call: how hard he goes after it. You pick it stage by stage.",
    slabel: "Race-day intention",
    chips: [
      ["Grupetto", "Rides in the last group."],
      ["Ride easy", "Sits in, saves himself."],
      ["Normal", "His normal race."],
      ["Work or attack", "Spends himself for the captain."],
      ["All out", "Everything on today."],
    ],
    on: 4,
    scale: "Saves him &middot; empties him",
    slabel2: "In your team selection",
    riders: [
      ["Duarte, M.", "Captain all race. Today: normal.", "Normal"],
      ["Okonkwo, T.", "Default hunter. Today: all out.", "All out"],
      ["Vasquez, R.", "Helper all race. Today: ride easy.", "Ride easy"],
    ],
  },
  da: {
    h1: "Dit valg,<br>hver etape",
    body: "Rollen g&aelig;lder hele l&oslash;bet. Intentionen er dagens valg: hvor h&aring;rdt han g&aring;r efter den. Du v&aelig;lger den etape for etape.",
    slabel: "L&oslash;bsdagens intention",
    chips: [
      ["Grupetto", "K&oslash;rer i bagerste gruppe."],
      ["K&oslash;r roligt", "Ligger med og sparer sig."],
      ["Normal", "Hans normale l&oslash;b."],
      ["Arbejd eller angrib", "Bruger sig selv p&aring; kaptajnen."],
      ["Alt ud", "Alt p&aring; i dag."],
    ],
    on: 4,
    scale: "Sparer ham &middot; t&oslash;mmer ham",
    slabel2: "I holdudtagelsen",
    riders: [
      ["Duarte, M.", "Kaptajn hele l&oslash;bet. I dag: normal.", "Normal"],
      ["Okonkwo, T.", "Er j&aelig;ger som standard. I dag: alt ud.", "Alt ud"],
      ["Vasquez, R.", "Hj&aelig;lper hele l&oslash;bet. I dag: k&oslash;r roligt.", "K&oslash;r roligt"],
    ],
  },
};
const build2 = (l) => {
  const c = P2[l];
  return page("Your call, every stage", l, `
    <div style="display:grid;grid-template-columns:560px 1fr;gap:56px;align-items:center">
      <div>
        <h1>${c.h1}</h1>
        <p class="body">${c.body}</p>
      </div>
      <div class="card">
        <div class="slabel">${c.slabel}</div>
        <div class="chips">
          ${c.chips.map(([k], i) => `<div class="chip${i === c.on ? " on" : ""}">${k}</div>`).join("\n          ")}
        </div>
        <div class="chips">
          ${c.chips.map(([, d]) => `<div class="chip-d">${d}</div>`).join("\n          ")}
        </div>
        <div class="scale"><span class="ln"></span><span class="lb">${c.scale}</span><span class="ln"></span></div>
        <div class="slabel" style="margin-top:26px">${c.slabel2}</div>
        ${c.riders.map(([n, s, p]) => `<div class="rider"><div><div class="nm">${n}</div><div class="st">${s}</div></div><div class="rt"><span class="pill">${p}</span></div></div>`).join("\n        ")}
      </div>
    </div>`);
};

/* ── 03 · crashes + the time limit ─────────────────────────────────────── */
const P3 = {
  en: {
    h1: "Crashes are no longer<br>all or nothing",
    body: "A light crash costs time. A hard one costs days. Only the serious ones end your race, and a mechanical never does.",
    lad: "The four outcomes",
    ladder: [
      ["Light crash", "He gets up and rides on. It costs him time."],
      ["Hard crash", "He finishes, but marked. It costs him days."],
      ["Serious crash", "His race is over. Rare."],
      ["Mechanical", "Only ever time. Never your race, never your body."],
    ],
    res: "In the stage result", th: ["#", "Rider", "What happened"],
    rows: [
      ["1", "Duarte, M.", "Won the stage."],
      ["88", "Brenner, K.", "Light crash. Lost time."],
      ["131", "Okonkwo, T.", "Hard crash. Out injured for days."],
      ["142", "Vasquez, R.", "Puncture. A teammate handed him a wheel."],
    ],
    cut: "Outside the time limit",
    grupetto: "The grupetto came in together.", saved: "Saved",
    dnf: ["DNF", "Lindqvist, A.", "Serious crash. His race is over."],
    cards: "On the rider card afterwards",
    riders: [
      ["ok", "Brenner, K.", "Ready to race. He lost time, not skin."],
      ["warn", "Okonkwo, T.", "Out injured after a hard crash."],
      ["ok", "Vasquez, R.", "Ready to race. A mechanical never costs days."],
    ],
  },
  da: {
    h1: "Et styrt er ikke l&aelig;ngere<br>alt eller intet",
    body: "Et let styrt koster tid. Et h&aring;rdt koster dage. Kun de alvorlige ender l&oslash;bet, og et mekanisk uheld g&oslash;r det aldrig.",
    lad: "De fire udfald",
    ladder: [
      ["Let styrt", "Han rejser sig og k&oslash;rer videre. Det koster tid."],
      ["H&aring;rdt styrt", "Han kommer i m&aring;l, men m&aelig;rket. Det koster dage."],
      ["Alvorligt styrt", "L&oslash;bet er slut for ham. Sj&aelig;ldent."],
      ["Mekanisk uheld", "Altid kun tid. Aldrig l&oslash;bet, aldrig kroppen."],
    ],
    res: "I etapens resultat", th: ["#", "Rytter", "Hvad der skete"],
    rows: [
      ["1", "Duarte, M.", "Vandt etapen."],
      ["88", "Brenner, K.", "Let styrt. Tabte tid."],
      ["131", "Okonkwo, T.", "H&aring;rdt styrt. Ude med skade i dagevis."],
      ["142", "Vasquez, R.", "Punktering. En holdkammerat gav ham et hjul."],
    ],
    cut: "Uden for tidsgr&aelig;nsen",
    grupetto: "Grupettoen kom samlet i m&aring;l.", saved: "Reddet",
    dnf: ["DNF", "Lindqvist, A.", "Alvorligt styrt. Hans l&oslash;b er slut."],
    cards: "P&aring; rytterkortet bagefter",
    riders: [
      ["ok", "Brenner, K.", "Klar til start. Han tabte tid, ikke hud."],
      ["warn", "Okonkwo, T.", "Ude med skade efter et h&aring;rdt styrt."],
      ["ok", "Vasquez, R.", "Klar til start. Et mekanisk uheld koster aldrig dage."],
    ],
  },
};
const build3 = (l) => {
  const c = P3[l];
  const icoFor = { ok: IC.ok, warn: IC.warn };
  return page("Crashes and the time limit", l, `
    <div style="display:grid;grid-template-columns:1fr 560px;gap:48px;align-items:start">
      <div style="padding-top:6px">
        <h1 class="sm">${c.h1}</h1>
        <p class="body" style="max-width:44ch">${c.body}</p>
      </div>
      <div class="card">
        <div class="slabel">${c.lad}</div>
        <ul class="outc">
          ${c.ladder.map(([k, v]) => `<li><span class="k">${k}</span><span class="v">${v}</span></li>`).join("\n          ")}
        </ul>
      </div>
    </div>
    <div style="margin-top:20px;display:grid;grid-template-columns:1fr 560px;gap:48px;align-items:start">
      <div class="card">
        <div class="slabel">${c.res}</div>
        <table class="res">
          <tr><th style="width:60px">${c.th[0]}</th><th style="width:186px">${c.th[1]}</th><th>${c.th[2]}</th></tr>
          ${c.rows.map(([r, n, s]) => `<tr><td class="rank">${r}</td><td class="nm">${n}</td><td class="stt">${s}</td></tr>`).join("\n          ")}
          <tr class="cut"><td colspan="3">${c.cut}</td></tr>
          <tr><td class="rank"></td><td class="nm" colspan="2">${c.grupetto}<span class="pill saved">${c.saved}</span></td></tr>
          <tr><td class="rank dnf">${c.dnf[0]}</td><td class="nm">${c.dnf[1]}</td><td class="stt">${c.dnf[2]}</td></tr>
        </table>
      </div>
      <div class="card">
        <div class="slabel">${c.cards}</div>
        ${c.riders.map(([i, n, s]) => `<div class="rider"><span class="ic-${i}">${icoFor[i]}</span><div><div class="nm">${n}</div><div class="st">${s}</div></div></div>`).join("\n        ")}
      </div>
    </div>`);
};

/* ── 04 · teamwork, weather, cobbles ───────────────────────────────────── */
const P4 = {
  en: {
    h1: "Teamwork, weather, cobbles",
    body: "A teammate in the same group protects your captain, and pays for it. Rain and wind wear riders down. Cobbles bite near the finish.",
    panels: [
      {
        ic: IC.users, t: "Teamwork",
        l: "The captain gets the day. The teammate carries the cost, and he can never give away more than he has.",
        strip: () => groupStrip("Same group"),
        mini: [["Captain", "<b>Duarte, M.</b> is protected while a teammate rides with him."],
               ["Helper", "<b>Vasquez, R.</b> pays for it out of his own legs."]],
      },
      {
        ic: IC.rain, t: "Weather",
        l: "Rain and wind take the legs. The rider who is bad in it loses more than the field around him.",
        strip: () => weatherStrip("Rain"),
        mini: [["40 km", "Rain from here to the finish."],
               ["118 km", "Wind on the exposed road."]],
      },
      {
        ic: IC.road, t: "Cobbles",
        l: "The sectors sit close to the line, where they still decide the race instead of being ridden off early.",
        strip: () => cobbleStrip("Sectors", "Finish"),
        mini: [["Sectors", "Three of them inside the closing kilometres."],
               ["In the rain", "They cost more, and they break more riders."]],
      },
    ],
  },
  da: {
    h1: "Holdspil, vejr, brosten",
    body: "En holdkammerat i samme gruppe beskytter din kaptajn, og han betaler selv for det. Regn og vind slider. Brostenene bider t&aelig;t p&aring; m&aring;l.",
    panels: [
      {
        ic: IC.users, t: "Holdspil",
        l: "Kaptajnen f&aring;r dagen. Holdkammeraten betaler prisen, og han kan aldrig give mere v&aelig;k end han har.",
        strip: () => groupStrip("Samme gruppe"),
        mini: [["Kaptajn", "<b>Duarte, M.</b> beskyttes, s&aring; l&aelig;nge en holdkammerat k&oslash;rer med ham."],
               ["Hj&aelig;lper", "<b>Vasquez, R.</b> betaler for det med sine egne ben."]],
      },
      {
        ic: IC.rain, t: "Vejret",
        l: "Regn og vind tager benene. Den rytter der er d&aring;rlig i det, taber mere end feltet omkring ham.",
        strip: () => weatherStrip("Regn"),
        mini: [["40 km", "Regn herfra og ind til m&aring;l."],
               ["118 km", "Vind p&aring; den &aring;bne str&aelig;kning."]],
      },
      {
        ic: IC.road, t: "Brosten",
        l: "Sektorerne ligger t&aelig;t p&aring; stregen, hvor de stadig afg&oslash;r l&oslash;bet i stedet for at blive k&oslash;rt v&aelig;k tidligt.",
        strip: () => cobbleStrip("Sektorer", "M&aring;l"),
        mini: [["Sektorer", "Tre af dem inde p&aring; de sidste kilometer."],
               ["I regnvejr", "De koster mere, og de kn&aelig;kker flere ryttere."]],
      },
    ],
  },
};
const build4 = (l) => {
  const c = P4[l];
  return page("Teamwork, weather, cobbles", l, `
    <div style="padding-bottom:34px">
      <h1 class="md">${c.h1}</h1>
      <p class="body" style="max-width:86ch">${c.body}</p>
    </div>
    <div class="trio">
      ${c.panels.map((p) => `<div class="card">
        <div class="ph">${p.ic}<div class="t">${p.t}</div></div>
        <p class="pl">${p.l}</p>
        ${p.strip()}
        <div class="mini">
          ${p.mini.map(([k, v]) => `<div class="mrow"><span class="mk">${k}</span><span class="mv">${v}</span></div>`).join("\n          ")}
        </div>
      </div>`).join("\n      ")}
    </div>`);
};

/* ── write + render ────────────────────────────────────────────────────── */
const files = [
  ["01-stage-by-stage-en", build1("en")], ["01-stage-by-stage-da", build1("da")],
  ["02-your-call-en", build2("en")], ["02-your-call-da", build2("da")],
  ["03-crashes-time-limit-en", build3("en")], ["03-crashes-time-limit-da", build3("da")],
  ["04-teamwork-weather-cobbles-en", build4("en")], ["04-teamwork-weather-cobbles-da", build4("da")],
];
for (const [name, html] of files) fs.writeFileSync(path.join(dir, `${name}.html`), html, "utf8");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
for (const [name] of files) {
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(path.join(dir, `${name}.html`)).href, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  const o = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth }));
  await p.screenshot({ path: path.join(dir, `${name}.png`), clip: { x: 0, y: 0, width: 1600, height: 900 } });
  console.log(`${name}.png  ${o.w}x${o.h}${o.h > 900 || o.w > 1600 ? "  <-- OVERFLOW" : ""}`);
  await p.close();
}
await browser.close();
