// Genbrugelig maaler: findes der tekst paa fladen der er klippet, stikker ud af
// sin boks, ikke kan laeses, eller er en raa i18n-noegle? — Refs #5383.
//
// ── Hvorfor denne maaler findes ─────────────────────────────────────────────
//
// Ejer-direktiv 18/9, ordret: "Det er meningen at du helt af dig selv skal
// opdage ting som, at teksten gaar ud over boksene. Det skal ikke kunne opstaa."
// Der skal altsaa ikke sendes skaermbilleder ind; vagten skal selv finde
// stederne. `i18n-layout-overflow.spec.js` (#4733) daekker EN akse af det samme
// problem — om hele SIDEN kan scrolles vandret paa 30 % laengere strenge — men
// den er blind for alt der sker inde i siden: en label der klippes i et kort,
// et tal der stikker ud over sin badge, en daempet tekst der er for lys til at
// laese. Denne maaler er det manglende led: den doemmer ELEMENT for element.
//
// ── De fire regler ─────────────────────────────────────────────────────────
//
//   clipped            Elementet har sin egen tekst, dets overflow er skjult, og
//                      indholdet er stoerre end kassen (scrollWidth/-Height).
//                      Tilsigtet afkortning (ellipsis eller line-clamp MED
//                      `title`/`aria-label`, eller `data-allow-clip`) er ikke et
//                      fund: dér kan spilleren stadig faa hele teksten.
//   outside-container  Tekstens synlige kasse stikker ud over den naermeste
//                      kort-/knap-/badge-beholder (den naermeste forfader med
//                      egen ramme eller baggrund), og beholderen klipper ikke.
//   unreadable         Nul-bredde tekst, tekst daekket af et ugennemsigtigt
//                      soesken-element, eller farvekontrast under 3:1 mod dens
//                      EGEN effektive baggrund.
//   raw-i18n-key       En oversaettelsesnoegle er sluppet ud paa fladen
//                      ("board:cards.title" / "cards.board.title").
//
// ── Hvad maaleren bevidst IKKE doemmer ─────────────────────────────────────
//
//   · Elementer inde i deres EGEN vandrette scroll-container. En bred datatabel
//     maa scrolle i sig selv (T2 i docs/design/PAGE_TEMPLATES.md).
//   · Absolut/fast placerede elementer i regel `outside-container`: en prik paa
//     et ikon eller en flydende etiket ligger uden for sin forael der MED VILJE.
//   · Tekst over et baggrundsBILLEDE eller en gradient i kontrast-reglen —
//     baggrunden kan ikke laeses som een farve, og et gaet ville vaere stoej.
//   · Daekket-af-soesken naar det daekkende element er `sticky`/`fixed` eller
//     halvgennemsigtigt: en klaebende topbar der glider hen over indhold under
//     scroll er ikke en fejl, og den ville ellers fejle paa hver eneste side.
//
// Alt der doemmes kan undtages SMALT og synligt i `text-overflow-allowlist.js`,
// med begrundelse og udloebsdato pr. post. Ingen brede wildcards.

export const RULES = {
  CLIPPED: "clipped",
  OUTSIDE_CONTAINER: "outside-container",
  UNREADABLE: "unreadable",
  RAW_KEY: "raw-i18n-key",
};

// Kontrast-gulvet. 3:1 er WCAG's krav til STOR tekst; almindelig tekst skal
// egentlig op paa 4.5:1. Vagten doemmer paa 3:1 med vilje: den skal fange det
// ULAESELIGE uden at goere hele den daempede `--text-3`-palet til et fund i
// samme PR. Skal barren haeves senere, er det een konstant.
export const CONTRAST_MIN = 3;

/**
 * Kernen. Koeres i browseren via `page.evaluate`, saa den maa vaere helt
 * selvstaendig: ingen imports, ingen closure over Node-scope.
 *
 * @param {{ contrastMin: number, rules: Record<string, string> }} options
 * @returns {Array<{rule: string, selector: string, text: string, detail: string, px: number}>}
 */
export function scanDocumentForTextDefects({ contrastMin, rules }) {
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "META", "LINK",
    "SVG", "PATH", "G", "CIRCLE", "RECT", "LINE", "POLYLINE", "POLYGON", "TEXT",
    "DEFS", "CLIPPATH", "USE", "TSPAN", "IFRAME", "OPTION", "BR", "HR", "IMG",
  ]);

  const findings = [];
  const add = (rule, el, text, detail, px) => {
    findings.push({ rule, selector: describe(el), text: clip(text), detail, px: Math.round(px) });
  };

  const clip = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);

  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const testid = el.getAttribute("data-testid") ? `[data-testid="${el.getAttribute("data-testid")}"]` : "";
    const classes = (el.getAttribute("class") || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .map((c) => `.${c}`)
      .join("");
    return `${tag}${id}${testid}${classes}`;
  }

  // ── Farve-hjaelpere ──────────────────────────────────────────────────────
  function parseColor(value) {
    const match = String(value || "").match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(",").map((p) => parseFloat(p.trim()));
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  function luminance({ r, g, b }) {
    const channel = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  /** Effektiv baggrund bag `el`, eller null hvis den ikke kan laeses som EEN farve. */
  function effectiveBackground(el) {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== "none") return null;
      const color = parseColor(style.backgroundColor);
      if (color && color.a > 0) {
        acc = acc ? over(acc, color) : color;
        if (acc.a >= 1 || color.a >= 1) return { ...acc, a: 1 };
      }
      node = node.parentElement;
    }
    // Ingen ugennemsigtig baggrund fundet: antag sidens egen.
    const bodyColor = parseColor(getComputedStyle(document.body).backgroundColor);
    if (!bodyColor || bodyColor.a === 0) return { r: 255, g: 255, b: 255, a: 1 };
    return acc ? over(acc, bodyColor) : bodyColor;
  }

  // ── Struktur-hjaelpere ───────────────────────────────────────────────────
  function ownText(el) {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue;
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function hasScrollableAncestor(el, stopAt) {
    let node = el.parentElement;
    while (node && node !== stopAt && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (["auto", "scroll"].includes(style.overflowX) || ["auto", "scroll"].includes(style.overflowY)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function isHiddenBranch(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return true;
      if (node.hasAttribute && node.hasAttribute("inert")) return true;
      node = node.parentElement;
    }
    return false;
  }

  /** Naermeste forfader der TEGNER en kasse: knap, fane, eller ramme/baggrund. */
  function nearestBox(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      const role = node.getAttribute("role");
      const isControl = node.tagName === "BUTTON" || role === "button" || role === "tab";
      const bg = parseColor(style.backgroundColor);
      const hasBorder = ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"]
        .some((side) => parseFloat(style[side]) > 0);
      if (isControl || hasBorder || (bg && bg.a > 0.02)) return { node, style };
      node = node.parentElement;
    }
    return null;
  }

  const isIntentionalTruncation = (el, style) => {
    if (el.hasAttribute("data-allow-clip")) return true;
    const hasLabel = Boolean(el.getAttribute("title") || el.getAttribute("aria-label"));
    if (!hasLabel) return false;
    const clamped = style.webkitLineClamp && style.webkitLineClamp !== "none";
    return style.textOverflow === "ellipsis" || Boolean(clamped);
  };

  // Raa i18n-noegler. Tre former, alle uden mellemrum:
  //   ns:key.path   ·   a.b.c (3+ led)   ·   a.camelCase (2 led, camelCase)
  // Domaener (cyclingzone.org), filnavne og versionsnumre falder udenfor.
  const NOT_A_KEY = /\.(com|org|net|dk|io|app|dev|json|js|jsx|png|svg|md)$/i;
  function rawKeyIn(text) {
    if (!text || text.length > 120) return null;
    const tokens = text.split(/\s+/);
    for (const token of tokens) {
      if (NOT_A_KEY.test(token)) continue;
      if (/^[a-z][a-zA-Z0-9]*:[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+)*$/.test(token)) return token;
      if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_]+){2,}$/.test(token)) return token;
      if (/^[a-z]+\.[a-z0-9]*[A-Z][a-zA-Z0-9]*$/.test(token)) return token;
    }
    return null;
  }

  // ── Pas 1: geometri, farve og noegler ────────────────────────────────────
  const textLeaves = [];
  for (const el of document.querySelectorAll("body *")) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    if (el.closest("svg")) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (parseFloat(style.opacity) === 0) continue;
    if (isHiddenBranch(el)) continue;

    const text = ownText(el);
    if (!text) continue;

    const rect = el.getBoundingClientRect();
    if (rect.height === 0) continue;

    textLeaves.push({ el, style, text, rect });

    // (d) raa i18n-noegle
    const key = rawKeyIn(text);
    if (key) add(rules.RAW_KEY, el, text, `noeglen "${key}" staar paa fladen i stedet for en oversaettelse`, 0);

    // (c) nul-bredde
    if (rect.width < 1) {
      add(rules.UNREADABLE, el, text, "elementet har tekst men nul bredde, saa intet kan laeses", 0);
      continue;
    }

    // (c) kontrast mod egen effektiv baggrund
    const fg = parseColor(style.color);
    const bg = effectiveBackground(el);
    if (fg && bg) {
      const ratio = contrast(over(fg, bg), bg);
      if (ratio < contrastMin) {
        add(
          rules.UNREADABLE,
          el,
          text,
          `kontrast ${ratio.toFixed(2)}:1 mod egen baggrund (gulv ${contrastMin}:1)`,
          0,
        );
      }
    }

    // (a) klippet tekst
    const clippedX = ["hidden", "clip"].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
    const clippedY = ["hidden", "clip"].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if ((clippedX || clippedY) && !isIntentionalTruncation(el, style)) {
      const px = clippedX ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      add(
        rules.CLIPPED,
        el,
        text,
        clippedX
          ? `teksten er ${px} px bredere end sin kasse og overflow er skjult uden title/aria-label`
          : `teksten er ${px} px hoejere end sin kasse og overflow er skjult uden title/aria-label`,
        px,
      );
    }

    // (b) uden for naermeste kort-/knap-/badge-beholder
    if (["absolute", "fixed"].includes(style.position)) continue;
    const box = nearestBox(el);
    if (!box) continue;
    if (["hidden", "clip", "auto", "scroll"].includes(box.style.overflowX)) continue;
    if (["hidden", "clip", "auto", "scroll"].includes(box.style.overflowY)) continue;
    if (hasScrollableAncestor(el, box.node)) continue;
    const boxRect = box.node.getBoundingClientRect();
    const inner = {
      left: boxRect.left + parseFloat(box.style.borderLeftWidth),
      right: boxRect.right - parseFloat(box.style.borderRightWidth),
      top: boxRect.top + parseFloat(box.style.borderTopWidth),
      bottom: boxRect.bottom - parseFloat(box.style.borderBottomWidth),
    };
    const out = Math.max(
      inner.left - rect.left,
      rect.right - inner.right,
      inner.top - rect.top,
      rect.bottom - inner.bottom,
    );
    if (out > 2) {
      add(
        rules.OUTSIDE_CONTAINER,
        el,
        text,
        `teksten stikker ${Math.round(out)} px ud over ${describe(box.node)}`,
        out,
      );
    }
  }

  // ── Pas 2: daekket af et ugennemsigtigt soesken-element ──────────────────
  // Hit-testen kraever at elementet er i viewporten, saa siden koeres igennem i
  // baand. Elementer taet paa kanten springes over: dér ligger de klaebende
  // top-/bundbjaelker, og de daekker indhold under scroll uden at det er en fejl.
  const scrollBefore = window.scrollY;
  const SAFE_MARGIN = 96;
  const tested = new Set();
  const bandHeight = Math.max(window.innerHeight - SAFE_MARGIN * 2, 120);
  const bands = Math.min(Math.ceil(document.documentElement.scrollHeight / bandHeight) + 1, 24);
  for (let band = 0; band < bands; band += 1) {
    window.scrollTo(0, band * bandHeight);
    for (let index = 0; index < textLeaves.length; index += 1) {
      if (tested.has(index)) continue;
      const { el, text } = textLeaves[index];
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.top < SAFE_MARGIN || rect.bottom > window.innerHeight - SAFE_MARGIN) continue;
      tested.add(index);
      const hit = document.elementFromPoint(
        Math.min(rect.left + Math.min(rect.width / 2, 40), window.innerWidth - 1),
        rect.top + rect.height / 2,
      );
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
      const hitStyle = getComputedStyle(hit);
      if (["sticky", "fixed"].includes(hitStyle.position)) continue;
      const hitBg = parseColor(hitStyle.backgroundColor);
      if (!hitBg || hitBg.a < 0.9) continue;
      add(
        rules.UNREADABLE,
        el,
        text,
        `teksten er daekket af ${describe(hit)}, som ligger ovenpaa med en ugennemsigtig baggrund`,
        0,
      );
    }
  }
  window.scrollTo(0, scrollBefore);

  return findings;
}

/**
 * Koer maaleren paa den aabne side.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<Array<{rule: string, selector: string, text: string, detail: string, px: number}>>}
 */
export async function scanPageForTextDefects(page) {
  return page.evaluate(scanDocumentForTextDefects, { contrastMin: CONTRAST_MIN, rules: RULES });
}

/** Een linje pr. fund, laesbar uden at aabne browseren. */
export function formatFinding(finding) {
  return (
    `  · [${finding.rule}] ${finding.where}\n` +
    `      ${finding.selector}\n` +
    `      tekst: "${finding.text}"\n` +
    `      ${finding.detail}`
  );
}
