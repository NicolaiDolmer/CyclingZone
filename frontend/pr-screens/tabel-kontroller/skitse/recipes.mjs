// #8280: de tre retninger, pr. side. Hver opskrift koerer INDE i siden (via
// page.evaluate) paa den aegte side i preview-mocken og bygger kun kontrol-
// omraadet om; tabellen, raekkerne, flag og maerker er spillets egne.
//
// Kontrakt: (dir, opts) => void. `dir` er "A" | "B" | "C"; opts.open = "scope" |
// "columns" | "picker" tegner et aabent ark oven paa retningen (kun B/C, 390).
// Funktionerne serialiseres af Playwright, saa de maa kun bruge window.__sk.

export function rankings(dir, opts = {}) {
  const sk = window.__sk;
  const m = sk.mobile();
  const root = [...document.querySelectorAll("main [translate=no]")].find((e) => e.querySelector(":scope > p") && e.querySelector("table"));
  const season = root.querySelector(":scope > p");
  const filterRow = season.nextElementSibling;
  const movement = sk.byText(":scope > div", /^Movement/, root);
  const chipGroup = root.querySelector("[role=group][aria-label='Choose columns']");
  const chipRow = chipGroup ? chipGroup.parentElement : null;
  const frame = root.querySelector("table").closest("div.rounded-cz");
  const block = frame.parentElement;
  const count = frame.nextElementSibling;
  const divisionLabel = sk.esc(filterRow.querySelector("select[aria-label=Division]").selectedOptions[0].textContent.replace(/\s*\(\d+\)$/, ""));
  const divisions = [...filterRow.querySelector("select[aria-label=Division]").options].map((o) => sk.esc(o.textContent.replace(/\s*\(\d+\)$/, "")));
  const poolSel = filterRow.querySelector("select[aria-label=Pool]");
  const pools = poolSel ? [...poolSel.options].map((o) => sk.esc(o.textContent.replace(/\s*\(\d+\)$/, ""))) : [];
  const poolLabel = poolSel ? sk.esc(poolSel.selectedOptions[0].textContent.replace(/\s*\(\d+\)$/, "")) : null;
  const seasonText = season.childNodes[0] ? sk.esc(season.childNodes[0].textContent.trim()) : "Season 1";
  sk.hide(season, filterRow, movement, chipRow);

  // Saeson + bevaegelses-reglen flytter ned i tabellens taellelinje (zone-forklaringen findes der allerede).
  const countRow = count.querySelector("div") || count;
  const ruleTxt = sk.el(`<span class="text-cz-3">${seasonText} · Top 2 up, bottom 4 down per pool</span>`);
  countRow.appendChild(ruleTxt);

  if (dir === "A") {
    const half = m ? "flex:1 1 calc(50% - 6px)" : "min-width:144px";
    const bar = sk.el(`<div class="flex flex-wrap items-center gap-3" style="margin-bottom:16px">${sk.search("Search team...", m ? "width:100%" : "width:240px")}${sk.select(divisionLabel, half)}${poolSel ? sk.select(poolLabel, half) : ""}</div>`);
    block.insertBefore(bar, block.firstChild);
    const tb = sk.el(sk.toolbar(`${sk.seg(["Standings", "Squad strength"], "Standings")}${sk.button("Compare", "margin-inline-start:auto")}`));
    frame.insertBefore(tb, frame.firstChild);
    let chips = null;
    if (m) { chips = sk.el(sk.squareChips(["Points", "Stage wins", "Prize", "Team class.", "Podiums"], ["Points", "Stage wins", "Prize"])); frame.insertBefore(chips, tb.nextSibling); }
    sk.mark(bar, "1");
    sk.mark(tb.firstElementChild, "2");
    sk.mark(tb.lastElementChild, "3");
    if (chips) sk.mark(chips, "4");
    sk.mark(ruleTxt, m ? "5" : "4");
  }

  if (dir === "B") {
    const scopeText = [divisionLabel, poolLabel, "Standings"].filter(Boolean).join(" · ");
    const row = sk.el(`<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">${sk.scopeBtn(scopeText, m ? "flex:1;min-width:0" : "")}${m ? sk.iconBtn("search", "Search team") + sk.iconBtn("table", "Columns", "3/5") : sk.search("Search team...", "width:240px") + sk.button("Compare", "margin-inline-start:auto")}</div>`);
    block.insertBefore(row, block.firstChild);
    sk.mark(row.children[0], "1");
    sk.mark(row.children[1], "2");
    if (m) sk.mark(row.children[2], "3");
    sk.mark(ruleTxt, m ? "4" : "3");
    if (opts.open === "scope") {
      sk.sheet("Show standings for", `${sk.sheetLabel("Division")}${sk.seg(divisions, divisionLabel, "width:100%;display:flex")}${pools.length ? sk.sheetLabel("Pool") + sk.seg(pools, poolLabel, "width:100%;display:flex") : ""}${sk.sheetLabel("View")}${sk.seg(["Standings", "Squad strength"], "Standings", "width:100%;display:flex")}${sk.sheetLabel("Compare")}<div style="font-size:13px;color:var(--text-2)">Tap a team's rank to pick it. Compare appears when two are picked.</div>`);
      document.querySelectorAll("body > div [role=group]").forEach((g) => g.querySelectorAll("button").forEach((b) => (b.style.flex = "1")));
    }
    if (opts.open === "columns") {
      sk.sheet("Columns (3 of 5)", `${sk.sheetLabel("Shown on your phone")}${sk.radioList(["Points", "Stage wins", "Prize money", "Team classification", "Podiums"], ["Points", "Stage wins", "Prize money"])}<div style="display:flex;align-items:center;gap:8px;min-height:44px;margin-top:12px;color:var(--text-1);font-size:13px;font-weight:600">${sk.icon("table", 16)}Full table</div>`);
    }
  }

  if (dir === "C") {
    const left = [sk.textSelect(divisionLabel), poolSel ? sk.textSelect(poolLabel) : "", sk.textSelect("Standings")].join('<span style="color:var(--text-3)">·</span>');
    const right = m ? `<span data-sk-ctrl style="margin-inline-start:auto;display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;color:var(--text-2)">${sk.icon("search", 18)}</span>` : `${sk.search("Search team...", "width:240px;margin-inline-start:auto")}${sk.button("Compare")}`;
    const cap = sk.el(`<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;padding:0 12px;border-bottom:1px solid var(--border)">${left}${right}</div>`);
    frame.insertBefore(cap, frame.firstChild);
    let n = 1;
    sk.mark(cap, String(n++));
    if (m) {
      const ths = [...frame.querySelectorAll("thead th")].slice(1);
      ths.forEach((th) => { th.setAttribute("data-sk-ctrl", ""); th.insertAdjacentHTML("beforeend", sk.icon("chevron", 12, "display:inline-block;vertical-align:-2px;margin-inline-start:2px;color:var(--text-3)")); });
      sk.mark(frame.querySelector("thead tr"), String(n++));
    }
    sk.mark(ruleTxt, String(n));
    if (opts.open === "picker") {
      sk.sheet("Column 3 · Prize money", `<div style="display:flex;align-items:center;gap:8px;min-height:44px;color:var(--text-1);font-size:13px;font-weight:600">Sort by prize money</div>${sk.sheetLabel("Swap this column for")}${sk.radioList(["Points", "Stage wins", "Prize money", "Team classification", "Podiums"], ["Prize money"])}${sk.sheetLabel("Or")}<div style="display:flex;align-items:center;gap:8px;min-height:44px;color:var(--text-1);font-size:13px;font-weight:600">${sk.icon("table", 16)}Show the full table</div>`);
    }
  }
}

export function riders(dir) {
  const sk = window.__sk;
  const m = sk.mobile();
  const filterRow = document.querySelector("main input[aria-label=Name]").closest("div.flex.flex-wrap");
  const pro = sk.byText("main div", /^Use this search again/);
  const proBox = pro ? pro.closest("div.rounded-cz") || pro : null;
  const sortRow = sk.byText("main div.sm\\:hidden", /^Sort by/);
  const chipGroup = document.querySelector("main [role=group][aria-label='Choose columns']");
  const chipRow = chipGroup ? chipGroup.parentElement : null;
  const frame = document.querySelector("main table").closest("div.rounded-cz");
  sk.hide(proBox, sortRow, chipRow);

  if (dir === "A") {
    const selects = [...filterRow.querySelectorAll(":scope > div.relative")].filter((d) => d.querySelector("select"));
    const cb = filterRow.querySelector(":scope > label");
    const reset = sk.byText(":scope > button", /^Reset all/, filterRow);
    if (m) {
      selects.slice(0, 2).forEach((s) => (s.style.flex = "1 1 calc(50% - 6px)"));
      sk.hide(selects[2], cb, reset);
      const more = filterRow.querySelector("summary");
      if (more) more.insertAdjacentHTML("beforeend", '<span class="font-data" style="margin-inline-start:4px;color:var(--text-3)">(3)</span>');
    }
    let chips = null;
    if (m) { chips = sk.el(sk.squareChips(["Rating", "Value", "Potential", "Salary", "Team", "Age"], ["Rating", "Value", "Potential"])); frame.insertBefore(chips, frame.firstChild); }
    sk.mark(filterRow, "1");
    if (chips) sk.mark(chips, "2");
  }

  if (dir === "B") {
    sk.hide(filterRow);
    const row = sk.el(`<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">${sk.scopeBtn("All riders · Filters (0)", m ? "flex:1;min-width:0" : "")}${m ? sk.iconBtn("search", "Search rider") + sk.iconBtn("table", "Columns", "3/26") : sk.search("Search rider...", "width:240px")}</div>`);
    filterRow.parentElement.insertBefore(row, filterRow);
    sk.mark(row.children[0], "1");
    sk.mark(row.children[1], "2");
    if (m) sk.mark(row.children[2], "3");
  }

  if (dir === "C") {
    sk.hide(filterRow);
    const left = [sk.textSelect("All nations"), sk.textSelect("Any role")].join('<span style="color:var(--text-3)">·</span>');
    const more = `<span data-sk-ctrl class="font-data" style="display:inline-flex;align-items:center;gap:4px;min-height:44px;color:var(--text-2);font-size:12px;font-weight:500">${sk.icon("filter", 14)}${m ? "" : "More filters"}</span>`;
    const right = m ? `<span style="margin-inline-start:auto;display:inline-flex;align-items:center;gap:4px">${more}<span data-sk-ctrl style="display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;color:var(--text-2)">${sk.icon("search", 18)}</span></span>` : `<span style="margin-inline-start:auto;display:inline-flex;align-items:center;gap:12px">${more}${sk.search("Search rider...", "width:240px")}</span>`;
    const cap = sk.el(`<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;padding:0 12px;border-bottom:1px solid var(--border)">${left}${right}</div>`);
    frame.insertBefore(cap, frame.firstChild);
    sk.mark(cap, "1");
    if (m) {
      [...frame.querySelectorAll("thead th")].slice(1).forEach((th) => { th.setAttribute("data-sk-ctrl", ""); th.insertAdjacentHTML("beforeend", sk.icon("chevron", 12, "display:inline-block;vertical-align:-2px;margin-inline-start:2px;color:var(--text-3)")); });
      sk.mark(frame.querySelector("thead tr"), "2");
    }
  }
}

export function team(dir) {
  const sk = window.__sk;
  const m = sk.mobile();
  const chipGroup = document.querySelector("main [role=group][aria-label='Choose columns']");
  const chipRow = chipGroup ? chipGroup.parentElement : null;
  const frame = document.querySelector("main table").closest("div.rounded-cz");
  const segGroup = frame.querySelector("[role=group][aria-label='Table columns']");
  const tb = segGroup ? segGroup.parentElement : null;
  sk.hide(chipRow);

  if (dir === "A") {
    if (m) {
      const chips = sk.el(sk.squareChips(["Rating", "Value", "Salary", "Role", "Potential", "Contract", "Action"], ["Rating", "Value", "Salary"]));
      frame.insertBefore(chips, tb ? tb.nextSibling : frame.firstChild);
      sk.mark(chips, "1");
    } else if (tb) sk.mark(tb, "1");
  }

  if (dir === "B") {
    if (m && tb) {
      sk.hide(segGroup);
      tb.insertAdjacentHTML("afterbegin", `${sk.scopeBtn("Overview · Rating, Value, Salary", "flex:1;min-width:0")}`);
      sk.mark(tb, "1");
    } else if (tb) sk.mark(tb, "1");
  }

  if (dir === "C") {
    if (tb) {
      sk.hide(segGroup);
      tb.insertAdjacentHTML("afterbegin", sk.textSelect("Overview"));
      tb.style.paddingTop = "0";
      tb.style.paddingBottom = "0";
    }
    sk.mark(tb, "1");
    if (m) {
      [...frame.querySelectorAll("thead th")].slice(1).forEach((th) => { th.setAttribute("data-sk-ctrl", ""); th.insertAdjacentHTML("beforeend", sk.icon("chevron", 12, "display:inline-block;vertical-align:-2px;margin-inline-start:2px;color:var(--text-3)")); });
      sk.mark(frame.querySelector("thead tr"), "2");
    }
  }
}
