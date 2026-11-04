import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource, walk, values, memberName, runSourceGuard } from './lint-tailwind-v4.mjs';

// Deliberately scoped to utilities that a class migration can substitute for a
// DOM event. Native blur remains legal; arbitrary application events do too.
const renamedUtility = /^(?:(?:backdrop-)?blur|(?:drop-)?shadow|rounded|ring|outline)-(?:xs|sm|md|lg|xl|2xl|3xl|none|hidden|\d+)$/;
export function lintEvents(source, filename) {
  const findings = [];
  walk(parseSource(source, filename), (node, ancestors) => {
    let argument;
    if (['CallExpression', 'OptionalCallExpression'].includes(node.type) && ['MemberExpression', 'OptionalMemberExpression'].includes(node.callee.type) && /^(addEventListener|removeEventListener|dispatchEvent)$/.test(memberName(node.callee.property))) argument = node.arguments[0];
    if ((node.type === 'NewExpression' || ['CallExpression', 'OptionalCallExpression'].includes(node.type)) && /^(Event|CustomEvent)$/.test(memberName(['MemberExpression', 'OptionalMemberExpression'].includes(node.callee.type) ? node.callee.property : node.callee))) argument = node.arguments[0];
    if (!argument) return;
    // dispatchEvent(new Event(...)) is checked at the constructor itself.
    if (argument.type === 'NewExpression') return;
    for (const token of values(argument, ancestors)) if (renamedUtility.test(token)) findings.push({ line: node.loc.start.line, token });
  });
  return findings;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runSourceGuard(lintEvents, process.argv[2]);
