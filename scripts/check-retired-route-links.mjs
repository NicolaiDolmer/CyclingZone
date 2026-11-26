import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://cyclingzone.org";
export const RETIRED_ROUTE_PATHS = new Set([
  "/activity-feed",
  "/calendar",
  "/global-rank",
  "/planner",
  "/race-archive",
  "/race-points",
  "/races",
  "/races/strategy",
  "/rider-rankings",
]);

// Literal destinations in JSX, route configuration and common navigation calls.
const DESTINATION = /(?<![\w.-])(?:(?:to|href|(?:window\.)?location\.href)\s*=\s*\{?\s*|(?:"(?:to|href|path|pathname)"|\x27(?:to|href|path|pathname)\x27|(?:to|href|path|pathname))\s*:\s*|(?:navigate|(?:window\.)?location\.(?:assign|replace))\s*\(\s*)(["\x27\x60])([^\r\n]*?)\1/g;
const CONDITIONAL_DESTINATION = /(?<![\w.-])(?:(?:to|href)\s*=\s*\{\s*|navigate\s*\(\s*)[^"\x27\x60;\r\n}]*?\?\s*(["\x27\x60])([^\r\n]*?)\1\s*:\s*(["\x27\x60])([^\r\n]*?)\3/g;
const COMMENTS_OR_STRINGS = /(["\x27\x60])(?:\\[^\r\n]|(?!\1)[^\\\r\n])*\1|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/i;
const NON_RUNTIME_FILE = /\.(?:test|spec|stories)\.[cm]?[jt]sx?$/i;

function retiredPath(target) {
  if (!target.startsWith("/") && !/^https?:\/\//i.test(target)) return false;
  const url = URL.parse(target, SITE);
  return Boolean(url && url.hostname === "cyclingzone.org" && RETIRED_ROUTE_PATHS.has(url.pathname.replace(/\/+$/, "").toLowerCase()));
}

export function findRetiredRouteLinks(source) {
  const code = source.replace(COMMENTS_OR_STRINGS, (token, quote) => quote ? token : token.replace(/[^\r\n]/g, " "));
  const direct = [...code.matchAll(DESTINATION)].map(match => [match.index, match[2]]);
  const conditional = [...code.matchAll(CONDITIONAL_DESTINATION)].flatMap(match => [
    [match.index, match[2]],
    [match.index, match[4]],
  ]);
  return [...direct, ...conditional]
    .filter(([, target]) => retiredPath(target))
    .sort(([a], [b]) => a - b)
    .map(([offset, target]) => ({ line: code.slice(0, offset).split("\n").length, target }));
}

function checkSourceTree() {
  const root = fileURLToPath(new URL("../frontend/src/", import.meta.url));
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry =>
    entry.isFile() && SOURCE_FILE.test(entry.name) && !NON_RUNTIME_FILE.test(entry.name) &&
    entry.name !== "PatchNotesPage.jsx",
  );
  const findings = [];
  for (const entry of files) {
    const file = join(entry.parentPath, entry.name);
    for (const { line, target } of findRetiredRouteLinks(readFileSync(file, "utf8"))) {
      findings.push(`${relative(root, file)}:${line}: ${target}`);
    }
  }
  if (findings.length) {
    console.error("Use the canonical route instead of linking to a compatibility redirect:");
    for (const finding of findings.sort()) console.error(`  ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Retired route links: ${files.length} source files checked.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkSourceTree();
