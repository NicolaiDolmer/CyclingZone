// #8280: hjaelpere der koerer INDE i siden (injiceres med addInitScript).
//
// Alt nyt markup bruger kittets egne klasser (Select/Input sm fra fieldStyles,
// Segmented, DataTable-rammens toolbar) eller tokens via var(--...), saa skitsen
// ser ud som spillet og foelger lys/moerk automatisk. Annoteringer (groenne/roede
// stiplede rammer) er ikke en del af designet og ligger i et eget lag.
export function installSketchLib() {
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
    filter: '<path d="M4 5h16l-6 7v6l-4-2v-4z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
  };
  const icon = (name, size = 16, style = "") =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none;${style}">${ICONS[name]}</svg>`;

  // Kittets Select/Input sm (fieldStyles.controlClass({ size: "sm" })).
  const CONTROL = "w-full rounded-cz border bg-cz-card text-cz-1 placeholder:text-cz-3 cz-field-target transition-colors duration-150 ease-out px-2.5 py-1.5 text-xs border-cz-border";
  const select = (value, style = "") =>
    `<div class="relative" style="${style}"><select class="${CONTROL} appearance-none pr-9"><option>${value}</option></select>${icon("chevron", 16, "position:absolute;right:12px;top:50%;transform:translateY(-50%);color:var(--text-3);pointer-events:none")}</div>`;
  const search = (placeholder, style = "") =>
    `<div class="relative" style="${style}">${icon("search", 15, "position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-3);pointer-events:none")}<input type="search" class="${CONTROL} pl-8" placeholder="${placeholder}"></div>`;
  // Kittets Segmented (aktiv = guld-TEKST paa 10 % guld, TASTE fork 3).
  const seg = (options, active, style = "") =>
    `<div role="group" class="inline-flex overflow-hidden rounded-cz border border-cz-border" style="${style}">${options
      .map((o) => `<button type="button" class="px-3 py-1.5 text-xs font-medium [@media(max-width:640px),(pointer:coarse)]:min-h-11 [@media(max-width:640px),(pointer:coarse)]:min-w-11 ${o === active ? "bg-cz-accent/10 text-cz-accent-t" : "bg-cz-card text-cz-2"}">${o}</button>`)
      .join("")}</div>`;
  // Sekundaer sm-knap (samme klasser som Button variant="secondary" size="sm").
  const secondaryClass = () => {
    const ref = [...document.querySelectorAll("main button")].find((b) => /border-cz-border/.test(b.className) && /font-semibold/.test(b.className) && /rounded-cz/.test(b.className));
    return ref ? ref.className : "inline-flex items-center justify-center gap-2 font-semibold rounded-cz border border-cz-border bg-cz-card text-cz-1 text-xs px-3 py-1.5";
  };
  const button = (label, style = "") => `<button type="button" class="${secondaryClass()}" style="${style}">${label}</button>`;
  // Ikon-knap: synlig 32-36 px, trykflade 44 (P16).
  const iconBtn = (name, label, badge = "") =>
    `<button type="button" aria-label="${label}" style="flex:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:44px;min-height:44px;padding:0 10px;border:1px solid var(--border);border-radius:5px;background:var(--bg-card);color:var(--text-2)">${icon(name, 16)}${badge ? `<span class="font-data" style="font-size:11px;font-weight:600;color:var(--text-2);font-variant-numeric:tabular-nums">${badge}</span>` : ""}</button>`;
  // B: det ene samlede scope-valg (knap med resume af alle valg).
  const scopeBtn = (text, style = "") =>
    `<button type="button" style="display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;padding:0 12px;border:1px solid var(--border);border-radius:5px;background:var(--bg-card);color:var(--text-1);font-size:12px;font-weight:500;text-align:left;${style}"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${text}</span>${icon("chevron", 16, "color:var(--text-3)")}</button>`;
  // C: tekst-dropdown i tabellens egen titellinje (ingen boks, chevron = vaelg).
  const textSelect = (label) =>
    `<button type="button" class="font-data" style="display:inline-flex;align-items:center;gap:3px;min-height:44px;padding:0 2px;background:none;border:0;color:var(--text-1);font-size:13px;font-weight:600;white-space:nowrap">${label}${icon("chevron", 14, "color:var(--text-3)")}</button>`;
  // A: D-047's kolonnevalg strammet: firkantede segmenter (5 px, hairline) inde i
  // rammen i stedet for 999 px-piller over den. Aktiv = --text-1 paa subtil flade.
  const squareChips = (labels, active) =>
    `<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--border)"><div role="group" style="display:flex;min-width:0;flex:1;overflow-x:auto;border:1px solid var(--border);border-radius:5px">${labels
      .map((l, i) => `<button type="button" class="font-data" style="flex:none;min-height:44px;padding:0 10px;${i ? "border-left:1px solid var(--border);" : ""}background:${active.includes(l) ? "var(--bg-subtle)" : "var(--bg-card)"};color:${active.includes(l) ? "var(--text-1)" : "var(--text-3)"};font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap">${l}</button>`)
      .join("")}</div>${iconBtn("table", "Full table")}</div>`;
  const toolbar = (html, style = "") =>
    `<div class="flex flex-wrap items-center gap-2 border-b border-cz-border" style="padding:6px 12px;${style}">${html}</div>`;

  // Bundark (P18: overlays er ark nederst paa telefonen) med scrim.
  const sheet = (title, body) => {
    const scrim = document.createElement("div");
    scrim.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(14,15,21,.45)";
    const s = document.createElement("div");
    s.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483001;max-height:85vh;overflow:auto;background:var(--bg-card);border-top:1px solid var(--border);border-radius:5px 5px 0 0;box-shadow:var(--shadow-overlay);padding:12px 16px 20px";
    s.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;min-height:44px"><span class="font-data" style="font-size:16px;font-weight:700;color:var(--text-1)">${title}</span><span style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid var(--border);border-radius:5px;color:var(--text-2)">${icon("x", 16)}</span></div>${body}`;
    document.body.appendChild(scrim);
    document.body.appendChild(s);
    return s;
  };
  const sheetLabel = (t) => `<div class="font-data" style="margin:14px 0 6px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)">${t}</div>`;
  const radioList = (items, active) =>
    `<div style="border:1px solid var(--border);border-radius:5px">${items
      .map((it, i) => `<div style="display:flex;align-items:center;justify-content:space-between;min-height:44px;padding:0 12px;${i ? "border-top:1px solid var(--border);" : ""}font-size:13px;color:${active.includes(it) ? "var(--text-1)" : "var(--text-2)"};font-weight:${active.includes(it) ? 600 : 400}"><span>${it}</span>${active.includes(it) ? `<span style="color:rgb(var(--accent-t))">${icon("check", 16)}</span>` : ""}</div>`)
      .join("")}</div>`;

  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const hide = (...els) => els.forEach((e) => { if (e) e.style.display = "none"; });
  const byText = (sel, re, root = document) => [...root.querySelectorAll(sel)].find((e) => re.test((e.textContent || "").trim()));
  const mobile = () => window.innerWidth <= 640;

  // ---------- annoteringer ----------
  const layer = () => {
    let l = document.getElementById("__ann");
    if (!l) { l = document.createElement("div"); l.id = "__ann"; l.style.cssText = "position:absolute;left:0;top:0;width:100%;height:0;z-index:2147482000;pointer-events:none;font:700 12px/1.2 system-ui,sans-serif"; document.body.appendChild(l); }
    return l;
  };
  const mark = (target, n, color = "#2e7d32") => {
    if (!target) return;
    const b = target.getBoundingClientRect();
    if (!b.width) return;
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:${b.left - 3}px;top:${b.top + scrollY - 3}px;width:${b.width + 6}px;height:${b.height + 6}px;border:2px dashed ${color};border-radius:4px`;
    const t = document.createElement("span");
    t.textContent = n;
    t.style.cssText = `position:absolute;right:-2px;top:-11px;min-width:18px;height:18px;line-height:18px;text-align:center;background:${color};color:#fff;border-radius:9px;padding:0 4px;font-size:11px`;
    d.appendChild(t);
    layer().appendChild(d);
  };
  // Maaling: kontrolomraadet = fra sidehovedets bund til foerste dataraekke.
  const measure = () => {
    const header = document.querySelector("main header");
    const top = header ? header.getBoundingClientRect().bottom : 0;
    const row = [...document.querySelectorAll("main table tbody tr")].find((r) => r.getBoundingClientRect().height > 0);
    const rowTop = row ? row.getBoundingClientRect().top : 0;
    const visible = (e) => { const b = e.getBoundingClientRect(); if (!b.width || !b.height) return false; let p = e; while (p) { if (getComputedStyle(p).display === "none") return false; p = p.parentElement; } return true; };
    const ctrls = [...document.querySelectorAll("main button, main select, main input:not([type=checkbox]), main label:has(input[type=checkbox]), main summary, main a[role=tab], main [data-sk-ctrl]")]
      .filter((e) => !e.closest("table tbody") && !e.closest("header") && visible(e))
      .filter((e) => { const b = e.getBoundingClientRect(); return b.top >= top - 1 && b.bottom <= rowTop + 1; });
    return { top: Math.round(top), rowTop: Math.round(rowTop), chrome: Math.round(rowTop - top), controls: ctrls.length };
  };
  const ruler = (m, color) => {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:2px;top:${m.top + scrollY}px;height:${m.chrome}px;width:6px;border:2px solid ${color};border-right:0`;
    const line = document.createElement("div");
    line.style.cssText = `position:absolute;left:0;right:0;top:${m.rowTop + scrollY}px;border-top:2px dashed ${color}`;
    const t = document.createElement("span");
    t.textContent = `${m.chrome} px · ${m.controls} kontroller`;
    t.style.cssText = `position:absolute;right:4px;top:-19px;background:${color};color:#fff;padding:1px 5px;border-radius:3px;white-space:nowrap;font-size:11px;opacity:.92`;
    line.appendChild(t);
    layer().appendChild(d);
    layer().appendChild(line);
  };

  window.__sk = { icon, select, search, seg, button, iconBtn, scopeBtn, textSelect, squareChips, toolbar, sheet, sheetLabel, radioList, el, hide, byText, mobile, mark, measure, ruler };
}
