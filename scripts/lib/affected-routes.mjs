// #7585 PR 2: udled berørte sider (ruter) fra en liste af ændrede filer.
//
// Ren funktion: ingen netværk, ingen git-kald. Fil-læsning og fil-liste
// injiceres, så kernen kan testes med et lille syntetisk filtræ. Rutekortet
// (komponentnavn -> rute-slug) kommer fra parseRouteMap i verify-affected.mjs.
//
// Idé: byg en omvendt importgraf over frontend/src og gå opad fra hver ændret
// fil til de sider der (indirekte) importerer den. Er udledningen usikker,
// returneres en konservativ fallback-liste og fallback=true, så runneren kan
// skrive et udkast frem for et "ok".

export const SRC_PREFIX = "frontend/src/";
export const MAX_DEPTH = 4;
export const MAX_ROUTES = 6;
// Konservativ liste over de mest centrale sider. Filtreres mod rutekortet.
export const FALLBACK_ROUTES = ["dashboard", "riders", "team", "auctions", "transfers", "training"];

const CODE_EXT = [".js", ".jsx", ".ts", ".tsx", ".mjs"];
const CODE_EXT_RE = /\.(?:[cm]?jsx?|tsx?)$/;
const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function norm(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "");
}

function dirname(p) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function basenameNoExt(p) {
  return p.split("/").pop().split(".")[0];
}

// Pure: normaliser en sti med "." og ".." segmenter. Returnerer null hvis den
// bryder ud af roden.
function joinPath(dir, rel) {
  const out = dir ? dir.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join("/");
}

// Pure: træk relative import-specifiers ud af kildekode (regex, ingen AST).
// Dækker import ... from, import "x", export ... from, og dynamisk import("x").
export function extractImportSpecifiers(source) {
  const text = String(source)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const specs = new Set();
  const patterns = [
    /\bimport\s+(?:[\w*${}\s,]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:[\w*${}\s,]+?\s+)?from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) specs.add(m[1]);
  }
  return [...specs].filter((s) => s.startsWith("./") || s.startsWith("../"));
}

// Pure: løs en relativ specifier til en fil i filmængden (ext + index-filer;
// ".js"-specifier kan pege på .ts/.tsx). Returnerer null hvis ikke fundet.
export function resolveImport(fromFile, specifier, fileSet) {
  const base = joinPath(dirname(fromFile), specifier);
  if (base === null) return null;
  const candidates = [base];
  const stripped = base.replace(CODE_EXT_RE, "");
  if (stripped !== base) for (const e of CODE_EXT) candidates.push(stripped + e);
  for (const e of CODE_EXT) candidates.push(base + e);
  for (const e of CODE_EXT) candidates.push(`${base}/index${e}`);
  return candidates.find((c) => fileSet.has(c)) ?? null;
}

// Pure: afled berørte ruter.
// deps: { listFiles(): string[] (alle filer under frontend/src), readFile(path): string,
//         routeMap: Map<componentName, routeSlug> }
// Returnerer { routes: string[], reasons: string[], fallback: boolean }.
export function deriveAffectedRoutes(changedFiles, deps, opts = {}) {
  const { listFiles, readFile, routeMap } = deps;
  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  const maxRoutes = opts.maxRoutes ?? MAX_ROUTES;
  const reasons = [];
  let uncertain = false;
  const found = new Set();

  const changed = [...new Set((changedFiles || []).map(norm))].sort();
  const relevant = [];
  for (const f of changed) {
    if (f.startsWith(SRC_PREFIX)) {
      if (TEST_FILE_RE.test(f)) reasons.push(`${f}: testfil, påvirker ingen side`);
      else relevant.push(f);
    } else if (f.startsWith("frontend/") && !f.startsWith("frontend/e2e/") && !TEST_FILE_RE.test(f)) {
      uncertain = true;
      reasons.push(`${f}: frontend-konfig/bygning uden for src, usikker udledning`);
    }
  }

  if (!relevant.length && !uncertain) {
    reasons.push("ingen frontend/src-filer ændret, ingen ruter berørt");
    return { routes: [], reasons, fallback: false };
  }

  if (relevant.length) {
    let files;
    try {
      files = listFiles().map(norm);
    } catch (err) {
      files = null;
      uncertain = true;
      reasons.push(`kunne ikke liste frontend/src: ${err.message}`);
    }

    if (files) {
      const fileSet = new Set(files);
      const importers = new Map(); // fil -> Set<importerende filer>
      for (const f of files) {
        if (!CODE_EXT_RE.test(f) || TEST_FILE_RE.test(f)) continue;
        let src;
        try {
          src = readFile(f);
        } catch (err) {
          uncertain = true;
          reasons.push(`${f}: kunne ikke læses (${err.message})`);
          continue;
        }
        for (const spec of extractImportSpecifiers(src)) {
          const target = resolveImport(f, spec, fileSet);
          if (!target) continue;
          if (!importers.has(target)) importers.set(target, new Set());
          importers.get(target).add(f);
        }
      }

      const isPage = (f) => routeMap.has(basenameNoExt(f)) && f.includes("/pages/");

      for (const start of relevant) {
        if (!fileSet.has(start)) {
          uncertain = true;
          reasons.push(`${start}: ikke i filtræet (slettet/omdøbt), usikker udledning`);
          continue;
        }
        const seen = new Set([start]);
        let frontier = [start];
        let hitPage = false;
        let truncated = false;
        let reachedRoot = false;
        for (let depth = 0; frontier.length; depth++) {
          const next = [];
          for (const node of frontier) {
            if (isPage(node)) {
              found.add(routeMap.get(basenameNoExt(node)));
              hitPage = true;
              continue; // sider er endestation
            }
            const ups = [...(importers.get(node) || [])].sort();
            if (!ups.length) {
              reachedRoot = true;
              continue;
            }
            if (depth >= maxDepth) {
              if (ups.some((u) => !seen.has(u))) truncated = true;
              continue;
            }
            for (const u of ups) {
              if (!seen.has(u)) {
                seen.add(u);
                next.push(u);
              }
            }
          }
          frontier = next;
        }
        if (truncated) {
          uncertain = true;
          reasons.push(`${start}: importkæden er dybere end ${maxDepth} niveauer`);
        } else if (!hitPage) {
          uncertain = true;
          reasons.push(`${start}: ingen sti til en side`);
        } else if (reachedRoot) {
          reasons.push(`${start}: nogle importkæder ender uden for en side (ignoreret)`);
        } else {
          reasons.push(`${start}: når side(r) via importgrafen`);
        }
      }
    }
  }

  let routes = [...found].sort();
  if (routes.length > maxRoutes) {
    uncertain = true;
    reasons.push(`${routes.length} ruter berørt, klippet til ${maxRoutes} (delt komponent)`);
    routes = routes.slice(0, maxRoutes);
  }
  if (uncertain) {
    const known = new Set(routeMap.values());
    const pool = FALLBACK_ROUTES.filter((r) => known.size === 0 || known.has(r));
    for (const r of pool) {
      if (routes.length >= maxRoutes) break;
      if (!routes.includes(r)) routes.push(r);
    }
    routes.sort();
    reasons.push("fallback: konservativ rutenøgleliste tilføjet");
  }
  return { routes, reasons, fallback: uncertain };
}
