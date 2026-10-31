#!/usr/bin/env node
// Byggestop-check i PR-CI (#7336 trin 1.3, spec 2026-10-29 §3.1).
//
// Naar scripts/build-stop.json har active:true, skal en PR hoere til tilladt
// arbejde: mindst et af de issues PR'en refererer (Refs/Closes #N i body, eller
// issue-nummer i branch-navnet) skal staa paa finishList, cleanupList eller
// brandList. Klassifikationen er IKKE gen-implementeret her: den genbruger
// classifyWork() fra scripts/lib/build-stop.mjs, som ogsaa wave-policy.mjs'
// admission bruger, saa CI og boelge-optag aldrig kan blive uenige.
//
// Undtagelser (en tydelig regel, ingen skjulte):
//   1. Dependabot (forfatter dependabot[bot] eller branch dependabot/...).
//   2. Rene docs/ops-PR'er: HVER aendret fil ligger under docs/,
//      .claude/learnings/ eller er en .md-fil i repo-roden (fx docs/NOW.md,
//      docs/STATUS_BOARD.md). Een kode- eller config-fil i diffen ophaever
//      undtagelsen.
//
// Tillid: checket koerer paa pull_request mod PR'ens egen build-stop.json, saa en
// PR der tilfoejer sit issue til brandList (den dokumenterede vej, spec §3.3)
// kan bestaa. Den aendring staar i diffen og er ejerens veto-punkt.
//
// Brug (workflow): PR_BODY, PR_BRANCH, PR_AUTHOR og CHANGED_FILES (linjeskift-
// adskilt) i env. Exit 0 = ok, 1 = afvist.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadBuildStop, classifyWork } from './lib/build-stop.mjs';

export const REPO = 'NicolaiDolmer/CyclingZone';

const KEYWORD = /\b(?:refs?|closes?|closed|fix(?:es|ed)?|resolves?|resolved)\b\s*:?\s*((?:[\w.-]+\/[\w.-]+)?#\d+(?:\s*(?:,|&|\band\b|\bog\b)\s*(?:[\w.-]+\/[\w.-]+)?#\d+)*)/gi;
const TOKEN = /(?:([\w.-]+\/[\w.-]+))?#(\d+)/g;

// HTML-kommentarer fjernes indtil teksten er stabil (CodeQL #384: ét gennemløb
// kan efterlade "<!--" ved indlejring, fx "<!<!-- -->-- x -->"), og en
// uafsluttet kommentar fjernes til slutningen.
function stripComments(text) {
  let prev;
  let out = text;
  do {
    prev = out;
    out = out.replace(/<!--[\s\S]*?-->/g, '');
  } while (out !== prev);
  return out.replace(/<!--[\s\S]*$/, '');
}

// Issue-numre fra "Refs #N" / "Closes #N, #M" i PR-body. Referencer til andre
// repoer ignoreres. Kodeblokke og HTML-kommentarer (PR-skabelonens hjaelpetekst)
// fjernes foerst, saa et eksempel i skabelonen ikke tæller som reference.
export function issuesFromBody(body) {
  const text = stripComments(String(body || '')).replace(/```[\s\S]*?```/g, '');
  const found = new Set();
  for (const m of text.matchAll(KEYWORD)) {
    for (const t of m[1].matchAll(TOKEN)) {
      if (t[1] && t[1].toLowerCase() !== REPO.toLowerCase()) continue;
      found.add(Number(t[2]));
    }
  }
  return [...found];
}

// Issue-numre i branch-navn: tal paa 3-6 cifre afgraenset af / _ - eller kanten
// (chore/7336-byggestop-... -> 7336). Et falsk positivt tal skader intet: det
// tæller kun hvis det staar paa en af listerne.
export function issuesFromBranch(branch) {
  const found = new Set();
  for (const m of String(branch || '').matchAll(/(?:^|[/_-])(\d{3,6})(?=$|[/_-])/g)) found.add(Number(m[1]));
  return [...found];
}

const norm = f => String(f).trim().replaceAll('\\', '/').replace(/^\.\//, '');

export function isDocsOrOpsFile(file) {
  const f = norm(file);
  return f.startsWith('docs/') || f.startsWith('.claude/learnings/') || /^[^/]+\.md$/i.test(f);
}

export function isDependabot({ author, branch }) {
  return /^dependabot(\[bot\])?$/i.test(String(author || '')) || String(branch || '').startsWith('dependabot/');
}

// -> { ok, rule, issues, message }
export function evaluatePr({ body, branch, author, files = [], cfg }) {
  if (!cfg.active) return { ok: true, rule: 'inactive', issues: [], message: 'Byggestop er ikke aktivt.' };
  if (isDependabot({ author, branch })) return { ok: true, rule: 'dependabot', issues: [], message: 'Dependabot er undtaget.' };

  const changed = files.map(norm).filter(Boolean);
  if (changed.length && changed.every(isDocsOrOpsFile)) {
    return { ok: true, rule: 'docs-ops', issues: [], message: `Ren docs/ops-PR (${changed.length} fil(er)) er undtaget.` };
  }

  const issues = [...new Set([...issuesFromBody(body), ...issuesFromBranch(branch)])];
  const classified = issues.map(n => ({ issue: n, ...classifyWork({ issue: n }, cfg) }));
  const allowed = classified.filter(c => c.cls !== 'new');
  if (allowed.length) {
    return { ok: true, rule: 'listed', issues, message: `Tilladt via ${allowed.map(c => `#${c.issue} (${c.cls})`).join(', ')}.` };
  }

  const seen = issues.length ? `PR'en refererer ${issues.map(n => `#${n}`).join(', ')}, men ingen af dem` : "PR'en refererer intet issue (Refs/Closes #N i body eller nummer i branch-navn), og ingen";
  return {
    ok: false,
    rule: 'blocked',
    issues,
    message: `Byggestop aktivt siden ${cfg.since}: ${seen} staar paa finishList, cleanupList eller brandList i scripts/build-stop.json. ` +
      'Er det fase 1-arbejde, sa referer det rigtige issue. Er det brand (live hos spillerne og forkert), sa tilfoej issuet til brandList med en begrundelse. Ellers hoerer det i triage:new.',
  };
}

function main() {
  const cfg = loadBuildStop();
  const res = evaluatePr({
    body: process.env.PR_BODY,
    branch: process.env.PR_BRANCH,
    author: process.env.PR_AUTHOR,
    files: String(process.env.CHANGED_FILES || '').split('\n'),
    cfg,
  });
  console.log(`[build-stop-pr] ${res.ok ? 'OK' : 'AFVIST'} (${res.rule}): ${res.message}`);
  if (!res.ok) {
    console.log(`::error title=Byggestop::${res.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main();
