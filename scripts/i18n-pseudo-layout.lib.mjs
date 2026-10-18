// #6800 — rene dele af pseudo-locale layout-sweepet (scripts/i18n-pseudo-layout.mjs).
//
// To ting bor her:
//   1. `measureLayout` — koerer INDE i browseren (page.evaluate). Den maa derfor
//      vaere helt selvstaendig: ingen closures, ingen imports, intet der peger
//      uden for funktionens eget scope.
//   2. Rene hjaelpere (nøgle-normalisering, diff mod baseline, markdown) som
//      testes med `node --test scripts/i18n-pseudo-layout.test.mjs`.

export const SEVERITY_ORDER = { high: 0, medium: 1, low: 2, info: 3 };

export const KIND_LABELS = {
  "page-overflow": "Siden kan scrolles vandret",
  "beyond-viewport": "Element uden for viewporten",
  "clipped-hard": "Tekst klippet haardt af (overflow skjult)",
  "clipped-by-ancestor": "Element skaaret af en beholder",
  ellipsis: "Tekst afkortet med ellipse",
  "line-clamp": "Tekst afkortet af line-clamp",
  "clipped-vertical": "Tekst skaaret lodret",
  "wrap-control": "Knap/fane/badge ombrydes",
  "overlap-siblings": "Soeskende overlapper",
  "h-scroll": "Vandret scroll-beholder (fane-raekke/tabel)",
};

/**
 * Selvstaendig browser-funktion. Returnerer { viewport, findings, bottomNav }.
 * Hver finding: { kind, severity, path, text, detail, lines?, rect }.
 * `path` er en struktur-sti (tag:nth-of-type op til 7 led + klasser paa bladet),
 * stabil mellem baseline og pseudo fordi DOM'et er det samme.
 *
 * @param {{ maxFindings?: number }} [opts]
 */
export function measureLayout(opts = {}) {
  const MAX = opts.maxFindings ?? 400;
  const docEl = document.documentElement;
  const vw = docEl.clientWidth;
  const vh = docEl.clientHeight;
  const findings = [];
  const seen = new Set();

  const INTERACTIVE_SEL = "button, a, [role=tab], [role=button], [role=menuitem], summary, label";
  const PILL_RE = /(badge|chip|pill|tag)\b/i;

  const cs = (el) => getComputedStyle(el);
  const isVisible = (el, style) => {
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isSrOnly = (el, r) => r.width <= 1 || r.height <= 1;
  const ownText = (el) => {
    let t = "";
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.replace(/\s+/g, " ").trim();
  };
  const fullText = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();
  const hasText = (el) => fullText(el).length > 0;

  const pathOf = (el) => {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node !== document.body && depth < 7) {
      const tag = node.tagName.toLowerCase();
      let idx = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) idx += 1;
        sib = sib.previousElementSibling;
      }
      const tid = node.getAttribute("data-testid");
      parts.unshift(tid ? `${tag}[${tid}]` : `${tag}:${idx}`);
      node = node.parentElement;
      depth += 1;
    }
    const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
    return `${parts.join(">")}${cls ? ` .${cls}` : ""}`;
  };

  const scrollsX = (style) => style.overflowX === "auto" || style.overflowX === "scroll";
  const clipsX = (style) => style.overflowX === "hidden" || style.overflowX === "clip";

  // Naermeste forfader der enten klipper eller scroller (i x- eller y-aksen).
  const clippingAncestor = (el) => {
    let node = el.parentElement;
    while (node && node !== docEl) {
      const s = cs(node);
      if (clipsX(s) || scrollsX(s) || s.overflowY === "hidden" || s.overflowY === "clip") return { node, style: s };
      node = node.parentElement;
    }
    return null;
  };

  const add = (kind, severity, el, detail, extra = {}) => {
    if (findings.length >= MAX) return;
    const path = pathOf(el);
    const key = `${kind}|${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    const r = el.getBoundingClientRect();
    findings.push({
      kind,
      severity,
      path,
      text: fullText(el).slice(0, 80),
      detail,
      rect: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
      ...extra,
    });
  };

  const isControl = (el) =>
    el.matches(INTERACTIVE_SEL) || PILL_RE.test(el.getAttribute("class") || "") || el.getAttribute("data-slot") === "badge";

  const linesOf = (el, style) => {
    const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.25;
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const inner = el.getBoundingClientRect().height - padY;
    return Math.max(1, Math.round(inner / lh));
  };

  // 1) Hele siden
  if (docEl.scrollWidth > vw + 1) {
    findings.push({
      kind: "page-overflow",
      severity: "high",
      path: "html",
      text: "",
      detail: `scrollWidth ${docEl.scrollWidth}px mod viewport ${vw}px`,
      rect: { x: 0, y: 0, w: docEl.scrollWidth, h: vh },
    });
  }

  const all = document.querySelectorAll("body *");
  for (const el of all) {
    if (findings.length >= MAX) break;
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    const style = cs(el);
    if (!isVisible(el, style)) continue;
    const r = el.getBoundingClientRect();
    if (isSrOnly(el, r)) continue;
    if (!hasText(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (["script", "style", "option", "noscript"].includes(tag)) continue;

    const ownT = ownText(el);
    const control = isControl(el);

    // 2) Klippet/afkortet i elementet selv
    if ((clipsX(style) || style.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      if (style.textOverflow === "ellipsis") {
        add("ellipsis", control ? "medium" : "low", el, `tekst ${el.scrollWidth}px i ${el.clientWidth}px`, { control });
      } else if (ownT || el.children.length === 0) {
        add("clipped-hard", "high", el, `indhold ${el.scrollWidth}px i ${el.clientWidth}px`, { control });
      }
    }
    const clamp = parseInt(style.webkitLineClamp, 10);
    if (Number.isFinite(clamp) && clamp > 0 && el.scrollHeight > el.clientHeight + 1) {
      add("line-clamp", control ? "medium" : "low", el, `clamp ${clamp} linjer, ${el.scrollHeight}px i ${el.clientHeight}px`, { control });
    } else if ((style.overflowY === "hidden" || style.overflowY === "clip") && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 2 && ownT) {
      add("clipped-vertical", "high", el, `indhold ${el.scrollHeight}px i ${el.clientHeight}px`, { control });
    }

    // 3) Vandret scroll-beholder
    if (scrollsX(style) && el.scrollWidth > el.clientWidth + 1) {
      add("h-scroll", "low", el, `scroll ${el.scrollWidth}px i ${el.clientWidth}px`);
    }

    // 4) Element uden for viewporten / skaaret af beholder
    if (ownT || control) {
      const anc = clippingAncestor(el);
      if (!anc && style.position !== "fixed" && (r.right > vw + 1 || r.left < -1)) {
        add("beyond-viewport", "high", el, `left ${Math.round(r.left)}px, right ${Math.round(r.right)}px, viewport ${vw}px`, { control });
      } else if (anc && clipsX(anc.style) && !scrollsX(anc.style) && style.position !== "absolute" && style.position !== "fixed") {
        const ar = anc.node.getBoundingClientRect();
        if (r.right > ar.right + 1.5 || r.left < ar.left - 1.5) {
          add("clipped-by-ancestor", "high", el, `element ${Math.round(r.left)}-${Math.round(r.right)}px, beholder ${Math.round(ar.left)}-${Math.round(ar.right)}px`, { control });
        }
      }
    }

    // 5) Knap/fane/badge der ombrydes
    if (control && (ownT || el.children.length <= 3) && style.display !== "inline" && style.whiteSpace !== "nowrap") {
      const lines = linesOf(el, style);
      if (lines >= 2) {
        add("wrap-control", lines >= 3 ? "high" : "medium", el, `${lines} linjer`, { lines, control });
      }
    }
  }

  // 6) Soeskende der overlapper i flex/grid-raekker
  for (const parent of document.querySelectorAll("body *")) {
    if (findings.length >= MAX) break;
    const style = cs(parent);
    if (!(style.display.includes("flex") || style.display.includes("grid"))) continue;
    if (!isVisible(parent, style)) continue;
    const kids = [...parent.children].filter((k) => {
      const ks = cs(k);
      return isVisible(k, ks) && ks.position !== "absolute" && ks.position !== "fixed" && hasText(k);
    });
    if (kids.length < 2 || kids.length > 24) continue;
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = kids[i].getBoundingClientRect();
        const b = kids[j].getBoundingClientRect();
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 2 && iy > 2) {
          add("overlap-siblings", "high", kids[j], `overlapper "${fullText(kids[i]).slice(0, 24)}" med ${Math.round(ix)}x${Math.round(iy)}px`);
        }
      }
    }
  }

  // 7) Bundnavigation: maal hver fane (kun synlig fast bjaelke i bunden)
  const bottomNav = [];
  for (const nav of document.querySelectorAll("nav")) {
    const s = cs(nav);
    const r = nav.getBoundingClientRect();
    if (s.position !== "fixed" || r.bottom < vh - 4 || !isVisible(nav, s)) continue;
    for (const link of nav.querySelectorAll("a, button")) {
      const lr = link.getBoundingClientRect();
      if (lr.width === 0) continue;
      // Labelen er det bladelement med mest tekst.
      let label = link;
      let best = 0;
      for (const node of link.querySelectorAll("*")) {
        const t = ownText(node);
        if (t.length > best) { best = t.length; label = node; }
      }
      const ls = cs(label);
      const range = document.createRange();
      range.selectNodeContents(label);
      const textW = range.getBoundingClientRect().width;
      const lcs = cs(link);
      const avail = link.clientWidth - parseFloat(lcs.paddingLeft) - parseFloat(lcs.paddingRight);
      bottomNav.push({
        label: fullText(label),
        tabWidth: Math.round(lr.width),
        labelBox: Math.round(avail),
        textWidth: Math.round(textW),
        scrollWidth: label.scrollWidth,
        lines: linesOf(label, ls),
        ellipsis: ls.textOverflow === "ellipsis" && label.scrollWidth > label.clientWidth + 1,
        clipped: label.scrollWidth > label.clientWidth + 1,
      });
    }
  }

  return { viewport: { w: vw, h: vh, docW: docEl.scrollWidth, docH: docEl.scrollHeight }, findings, bottomNav };
}

/** Fjern pseudo-pynt, saa en tekst kan sammenlignes paa tvaers af baseline og pseudo. */
export function normalizeText(text) {
  return String(text ?? "")
    .replace(/[\[\]]/g, "")
    .replace(/·••/g, "")
    .replace(/\s+x{1,6}(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function findingKey(f) {
  return `${f.kind}|${f.path}`;
}

/**
 * Del pseudo-fund i NYE (kun i pseudo) og EKSISTERENDE (ogsaa i baseline), og
 * find baseline-fund der forsvinder i pseudo (ikke et fund, men vaerd at se).
 */
export function diffFindings(baseline, pseudo) {
  const baseKeys = new Set(baseline.map(findingKey));
  const isNew = [];
  const existing = [];
  for (const f of pseudo) (baseKeys.has(findingKey(f)) ? existing : isNew).push(f);
  return { isNew, existing };
}

export function sortFindings(list) {
  return [...list].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      a.kind.localeCompare(b.kind) ||
      a.path.localeCompare(b.path),
  );
}

/** Bundnavigation: hvor taet er hver fane paa at klippe? headroom = ledig plads i px. */
export function navHeadroom(row) {
  return row.labelBox - row.textWidth;
}

function esc(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/** Markdown-tabel over nye fund for en side. */
export function renderFindingsTable(findings, limit = 12) {
  if (findings.length === 0) return "_Ingen nye fund._\n";
  const rows = sortFindings(findings).slice(0, limit);
  const lines = ["| Sværhed | Type | Tekst | Måling |", "|---|---|---|---|"];
  for (const f of rows) {
    lines.push(`| ${f.severity} | ${KIND_LABELS[f.kind] ?? f.kind} | ${esc(f.text || "-")} | ${esc(f.detail)} |`);
  }
  if (findings.length > limit) lines.push(`| | | | ... og ${findings.length - limit} flere (se findings.json) |`);
  return `${lines.join("\n")}\n`;
}

/** Sammentael pr. alvor og type. */
export function summarize(findings) {
  const bySeverity = {};
  const byKind = {};
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  }
  return { total: findings.length, bySeverity, byKind };
}
