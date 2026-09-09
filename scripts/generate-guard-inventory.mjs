// Rebuild the source inventory; measured evidence stays in the hand-written header.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';
const target = 'docs/GUARD_INVENTORY.md';
const marker = '<!-- GENERATED GUARD SOURCES -->';
const header = readFileSync(target, 'utf8').split(marker)[0].trimEnd();
const files = execFileSync('git', ['ls-files', '-z'], {encoding:'utf8'}).split('\0').filter(Boolean);
const escape = value => String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const link = path => `[${path}](../${path})`;
const rows = [];
const row = (layer, path, coverage) => rows.push(`| ${layer} | ${link(path)} | ${escape(coverage)} | aldrig bevist |`);
for (const path of files.filter(p => /^\.github\/workflows\/.*\.ya?ml$/.test(p))) {
  const workflow = YAML.parse(readFileSync(path,'utf8'));
  for (const [id,job] of Object.entries(workflow.jobs ?? {})) {
    row('CI', path, `${id}: ${job.name ?? id}${job['continue-on-error'] ? ' (continue-on-error; ikke ubetinget blokering)' : ''}`);
  }
}
for (const path of files.filter(p => /(?:^|\/)eslint\.config\.[cm]?js$/.test(p))) {
  const source = readFileSync(path, 'utf8');
  row('eslint', path, 'Samlet config inkl. importerede recommended-regelsæt; filglobs/overrides står i kilden');
  for (const match of source.matchAll(/"([^"\n]+)"\s*:\s*(?:\[\s*)?"(warn|error|off)"/g)) {
    row('eslint', path, `${match[1]}: ${match[2]}${match[2] === 'off' ? ' (deaktiveret)' : match[2] === 'warn' ? ' (warning; kun blokerende via warning-budget)' : ''}`);
  }
}
for (const path of files.filter(p => /^(?:scripts\/hooks\/|\.claude\/hooks\/)[^/]+\.(sh|ps1|mjs)$/.test(p))) {
  const purpose = readFileSync(path,'utf8').split(/\r?\n/).find(line => /^#\s+\S/.test(line) && !/^# (Refs|Run|Test|Usage)/.test(line));
  row('agent-hook', path, purpose?.replace(/^#\s*/, '') ?? 'Se scriptets header; aktivering afhænger af runner/config/trust');
}
for (const path of files.filter(p => /^scripts\/[^/]*(?:check|lint|guard|verify|preflight|ratchet)[^/]*\.(?:sh|ps1|mjs|js)$/.test(p) && !/\.(?:test|spec)\./.test(p))) {
  row('script / CI eller manuel', path, 'Kontrolscript; kaldesteder og præcis kontrakt står i kilden. At filen findes beviser ikke aktivering');
}
for (const path of ['.claude/settings.json', '.codex/hooks.json']) {
  const config = JSON.parse(readFileSync(path,'utf8'));
  for (const [event,groups] of Object.entries(config.hooks ?? {})) for (const [groupIndex,group] of groups.entries()) {
    for (const [hookIndex,hook] of (group.hooks ?? []).entries()) row('agent-binding', path, `${event}:${groupIndex}:${hookIndex}; matcher=${group.matcher ?? ''}; ${hook.command ?? hook.type}`);
  }
  for (const deny of config.permissions?.deny ?? []) row('agent-deny', path, deny);
}
writeFileSync(target, `${header}\n\n${marker}\n\n## Kildeinventar\n\nÉn række per CI-job, hook-script/binding, eksplicit ESLint-regel og kontrolscript.\nImporterede ESLint-regelsæt dækkes samlet af config-rækken. CI-job medtages også\nhvor formålet er drift frem for blokering. Tabellen registrerer kilder, ikke\npåstået runtime-dækning. Kun bevisregistret ovenfor tildeler en bevisdato;\n\"aldrig bevist\" betyder ingen registreret positiv blokering i denne audit.\nRegenerér efter staging med \`node scripts/generate-guard-inventory.mjs\`.\n\n| Lag | Kilde | Dækning / binding | Senest set blokere i denne audit |\n|---|---|---|---|\n${rows.join('\n')}\n`);
console.log(`Inventory: ${rows.length} source rows; measured evidence preserved.`);
