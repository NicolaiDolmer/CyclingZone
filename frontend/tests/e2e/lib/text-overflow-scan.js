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
//   spilling-text      Samme maaling, men hvor kassen IKKE klipper: teksten
//                      males uden for sin egen boks, hen over naboen.
//                      Tilfoejet 20/9 efter #4851, som slap forbi alle tre
//                      oevrige regler — se kommentaren ved selve reglen.
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
  SPILLING: "spilling-text",
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
 * `root` afgraenser hvad der maales. Sidernes egen flade er `main`; app-skallen
 * (sidebar, topbar, bundnavigation) maales for sig med `root: "body"` og
 * `excludeRoot: "main"`, saa de samme skal-fund ikke gentages paa 16 sider.
 *
 * @param {{ contrastMin: number, rules: Record<string, string>, root: string, excludeRoot: string|null }} options
 * @returns {Array<{rule: string, selector: string, text: string, detail: string, px: number}>}
 */
export function scanDocumentForTextDefects({ contrastMin, rules, root, excludeRoot }) {
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

  // Undtagelsen foelger AKSEN (CodeRabbit 19/9). En beholder der scroller
  // lodret siger intet om tekst der stikker ud til hoejre, og omvendt.
  function hasScrollableAncestor(el, stopAt, axis) {
    const prop = axis === "x" ? "overflowX" : "overflowY";
    let node = el.parentElement;
    while (node && node !== stopAt && node !== document.documentElement) {
      if (["auto", "scroll"].includes(getComputedStyle(node)[prop])) return true;
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

  /**
   * `.sr-only` og slaegtninge: tekst der KUN er til skaermlaesere. Den er
   * klippet til 1x1 px med vilje, og at doemme den ville vaere at doemme
   * tilgaengelighed som en fejl.
   */
  function isScreenReaderOnly(el, style) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 && rect.height <= 2 && style.position === "absolute") return true;
    if (style.clipPath && style.clipPath !== "none" && style.clipPath.includes("inset(50%)")) return true;
    if (style.clip && style.clip !== "auto") return true;
    return el.closest(".sr-only, [class*='screen-reader'], [class*='visually-hidden']") !== null;
  }

  /**
   * Er afkortningen tilsigtet OG stadig laesbar et andet sted?
   *
   * Kravet er ikke bare "der er en title" — den skal indeholde den tekst der
   * blev klippet. Kalender-chippen er mønstret: navnet truncates haardt i den
   * smalle celle, men hele navnet staar i linkets `title`/`aria-label`, saa
   * spilleren kan faa det. En `title` der siger noget ANDET end den klippede
   * tekst hjaelper ingen og taeller ikke.
   *
   * Etiketten maa sidde paa elementet selv eller paa en naer forfader (typisk
   * det <a>/<button> cellen ligger i) — derfor de fire niveauer.
   *
   * GRAENSEN, sagt hoejt (CodeRabbit-fund 19/9, bevidst afvist her): en `title`
   * er et tooltip man skal hovere for at se, og et `aria-label` ser en seende
   * bruger aldrig. Paa en telefon er hverken det ene eller det andet en rigtig
   * udvej. Vagten accepterer dem alligevel, fordi alternativet — at kraeve
   * synlig ombrydning eller en udfoldning FOER en afkortning er lovlig — ville
   * goere hver eneste afkortede etikette i appen til et fund, og fordi D-047
   * (ejer 10/9) udtrykkeligt bygger paa at resten er "et tryk vaek": raekken
   * linker selv derhen hvor hele teksten staar. Skal barren haeves, er det et
   * ejer-valg, og det staar i docs/audits/2026-09-19-5383-tekst-overflow-fund.md.
   */
  function isIntentionalTruncation(el, style, text) {
    if (el.closest("[data-allow-clip]")) return true;
    const clamped = style.webkitLineClamp && style.webkitLineClamp !== "none";
    if (style.textOverflow !== "ellipsis" && !clamped) return false;
    const needle = text.toLowerCase();
    let node = el;
    for (let level = 0; node && level < 4; level += 1) {
      const label = `${node.getAttribute?.("title") || ""} ${node.getAttribute?.("aria-label") || ""}`
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (label && label.includes(needle)) return true;
      node = node.parentElement;
    }
    return false;
  }

  /**
   * Er elementet i praksis klippet HELT vaek af en forfader med skjult overflow?
   *
   * En lukket harmonika ("Flere filtre") holder sine felter i DOM'en med en
   * hoejde paa 0 og `overflow: hidden`. De har stadig en kasse og en farve, saa
   * uden dette ville hvert eneste skjult felt blive maalt — og hit-testen ville
   * melde dem "daekket", fordi det der faktisk males dér er noget helt andet.
   */
  function isClippedAway(el, rect) {
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const clipsX = ["hidden", "clip", "auto", "scroll"].includes(style.overflowX);
      const clipsY = ["hidden", "clip", "auto", "scroll"].includes(style.overflowY);
      if (clipsX || clipsY) {
        const box = node.getBoundingClientRect();
        if (clipsY && (rect.bottom <= box.top + 1 || rect.top >= box.bottom - 1)) return true;
        if (clipsX && (rect.right <= box.left + 1 || rect.left >= box.right - 1)) return true;
      }
      node = node.parentElement;
    }
    return false;
  }

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
  const rootNode = document.querySelector(root);
  if (!rootNode) return [{ rule: rules.UNREADABLE, selector: root, text: "", detail: `maaleren fandt ikke "${root}" paa siden`, px: 0 }];
  for (const el of rootNode.querySelectorAll("*")) {
    if (SKIP_TAGS.has(el.tagName)) continue;
    if (el.closest("svg")) continue;
    if (excludeRoot && el.closest(excludeRoot)) continue;
    // `checkVisibility` er browserens EGEN dom over om elementet males. Den
    // daekker det haandrullede `display/visibility/opacity`-tjek OG de tilfaelde
    // et haandrullet tjek ikke kan se: indholdet i en lukket <details> (som
    // FilterBar's "More filters" bruger) springes over via `content-visibility`,
    // men beholder baade computed styles og en kasse. Uden den blev hvert eneste
    // skjulte filterfelt maalt — 30 falske "daekket af"-fund 19/9, nul aegte.
    if (
      typeof el.checkVisibility === "function" &&
      !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })
    ) {
      continue;
    }
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (parseFloat(style.opacity) === 0) continue;
    if (isHiddenBranch(el)) continue;
    if (isScreenReaderOnly(el, style)) continue;

    const text = ownText(el);
    if (!text) continue;

    const rect = el.getBoundingClientRect();
    if (rect.height === 0) continue;
    if (isClippedAway(el, rect)) continue;

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
      const blended = over(fg, bg);
      const ratio = contrast(blended, bg);
      if (ratio < contrastMin) {
        const hex = ({ r, g, b }) =>
          `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
        add(
          rules.UNREADABLE,
          el,
          text,
          `kontrast ${ratio.toFixed(2)}:1 mod egen baggrund (gulv ${contrastMin}:1) — ` +
            `tekst ${hex(blended)} paa ${hex(bg)}, ${Math.round(parseFloat(style.fontSize))} px`,
          0,
        );
      }
    }

    // (a) klippet tekst
    const clippedX = ["hidden", "clip"].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
    const clippedY = ["hidden", "clip"].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if ((clippedX || clippedY) && !isIntentionalTruncation(el, style, text)) {
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

    // (a2) teksten er bredere end sin egen kasse, og kassen klipper IKKE.
    //
    // #4851 (20/9) er hvorfor reglen findes. Mobil-traeningstabellens
    // meta-linje "PUNCHEUR/BAROUDEUR" har hverken mellemrum eller bindestreg
    // at bryde paa, saa den blev MALET 93 px uden for sin celle, hen over
    // nabokolonnen. Ingen af de tre andre regler saa den:
    //
    //   clipped            kraever skjult overflow — her var det `visible`
    //   outside-container  sammenligner RECTS, og et blocks rect vokser ikke
    //                      af tekst der flyder over; kun malingen gjorde
    //   unreadable         teksten var baade synlig og laesbar, bare det
    //                      forkerte sted
    //
    // `scrollWidth` er det eneste led der maaler det, fordi det taeller
    // indholdets udstraekning ogsaa naar overflow er synligt.
    //
    // Kun den VANDRETTE akse: en boks der vokser i hoejden af mere tekst er
    // normal ombrydning, ikke et overloeb. `clientWidth > 0` sorterer inline-
    // bokse fra (de rapporterer 0 paa begge maal, saa maalingen ville vaere
    // tom), og en vandret scroller over elementet er den samme T2-undtagelse
    // som resten af filen bruger: dér maa indholdet vaere bredere.
    const boxClipsX = ["hidden", "clip", "auto", "scroll"].includes(style.overflowX);
    if (
      !boxClipsX &&
      el.clientWidth > 0 &&
      el.scrollWidth > el.clientWidth + 1 &&
      !hasScrollableAncestor(el, rootNode, "x")
    ) {
      const px = el.scrollWidth - el.clientWidth;
      add(
        rules.SPILLING,
        el,
        text,
        `teksten er ${px} px bredere end sin egen kasse og males uden for den ` +
          `(scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}) — ` +
          `den mangler en bryde-mulighed: brug break-words/hyphens eller giv kassen plads`,
        px,
      );
    }

    // (b) uden for naermeste kort-/knap-/badge-beholder
    if (["absolute", "fixed"].includes(style.position)) continue;
    const box = nearestBox(el);
    if (!box) continue;
    // Hver akse doemmes for sig (CodeRabbit 19/9): en beholder der klipper eller
    // scroller LODRET fortaeller intet om tekst der stikker ud til hoejre. Slog
    // man begge akser fra under eet, kunne et vandret overloeb slippe forbi paa
    // et kort der bare har en lodret scroller.
    const boxClips = (prop) => ["hidden", "clip", "auto", "scroll"].includes(box.style[prop]);
    const checkX = !boxClips("overflowX") && !hasScrollableAncestor(el, box.node, "x");
    const checkY = !boxClips("overflowY") && !hasScrollableAncestor(el, box.node, "y");
    if (!checkX && !checkY) continue;
    const boxRect = box.node.getBoundingClientRect();
    const inner = {
      left: boxRect.left + parseFloat(box.style.borderLeftWidth),
      right: boxRect.right - parseFloat(box.style.borderRightWidth),
      top: boxRect.top + parseFloat(box.style.borderTopWidth),
      bottom: boxRect.bottom - parseFloat(box.style.borderBottomWidth),
    };
    const out = Math.max(
      ...(checkX ? [inner.left - rect.left, rect.right - inner.right] : []),
      ...(checkY ? [inner.top - rect.top, rect.bottom - inner.bottom] : []),
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
  //
  // `elementFromPoint` er en POINTER-test. Et element der er sat uden for
  // pointer-testen (`pointer-events: none` paa sig selv eller en forfader —
  // dekorative lag, deaktiverede paneler) kan aldrig vinde den, og hit-testen
  // ville melde HVER eneste af dem "daekket". Maalt 19/9 paa /transfers og
  // /riders: 30 saadanne falske fund, nul aegte. De springes derfor over, og det
  // staar i audit-dokumentet at reglen ikke daekker dem.
  /**
   * Elementets SYNLIGE kasse: dets egen, beskaaret af hver forfader der klipper.
   *
   * Hit-testen skal ramme et punkt der faktisk males. En kolonne der raekker ud
   * over sin vandrette scroller er klippet ved scrollerens kant — spoerger man
   * uden for den, svarer browseren med nabo-kortet, og reglen ville melde
   * "daekket" om noget der bare er scrollet ud af syne.
   */
  function visibleRectOf(el) {
    const r = el.getBoundingClientRect();
    let box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const clipsX = ["hidden", "clip", "auto", "scroll"].includes(style.overflowX);
      const clipsY = ["hidden", "clip", "auto", "scroll"].includes(style.overflowY);
      if (clipsX || clipsY) {
        const b = node.getBoundingClientRect();
        if (clipsX) {
          box.left = Math.max(box.left, b.left);
          box.right = Math.min(box.right, b.right);
        }
        if (clipsY) {
          box.top = Math.max(box.top, b.top);
          box.bottom = Math.min(box.bottom, b.bottom);
        }
      }
      node = node.parentElement;
    }
    return { ...box, width: box.right - box.left, height: box.bottom - box.top };
  }

  const hasStickyAncestor = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      if (["sticky", "fixed"].includes(getComputedStyle(node).position)) return true;
      node = node.parentElement;
    }
    return false;
  };

  const participatesInHitTest = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      if (getComputedStyle(node).pointerEvents === "none") return false;
      node = node.parentElement;
    }
    return true;
  };

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
      const rect = visibleRectOf(el);
      if (rect.width < 4 || rect.height < 4) continue;
      if (rect.top < SAFE_MARGIN || rect.bottom > window.innerHeight - SAFE_MARGIN) continue;
      if (rect.left < 0 || rect.right > window.innerWidth) continue;
      tested.add(index);
      if (!participatesInHitTest(el)) continue;
      const hit = document.elementFromPoint(
        rect.left + Math.min(rect.width / 2, 20),
        rect.top + rect.height / 2,
      );
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
      // Klaebende og fastgjorte lag daekker indhold med vilje: en sticky topbar
      // under scroll, auktionstabellens sticky bud-kolonne over de kolonner man
      // scroller forbi. Hele kaeden tjekkes, ikke kun elementet selv — det der
      // rammes er typisk et felt INDE i det klaebende lag, ikke laget.
      if (hasStickyAncestor(hit)) continue;
      const hitStyle = getComputedStyle(hit);
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
 * @param {{ root?: string, excludeRoot?: string|null }} [scope]
 * @returns {Promise<Array<{rule: string, selector: string, text: string, detail: string, px: number}>>}
 */
export async function scanPageForTextDefects(page, { root = "main", excludeRoot = null } = {}) {
  return page.evaluate(scanDocumentForTextDefects, {
    contrastMin: CONTRAST_MIN,
    rules: RULES,
    root,
    excludeRoot,
  });
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
