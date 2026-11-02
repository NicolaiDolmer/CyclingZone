// Class boundaries are syntax, not prose. Shared parser helpers also serve the
// event/history guards; no application source is imported or executed.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { parse } = require('@babel/parser');
export function parseSource(source, filename = 'fixture.tsx') {
  return parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'], sourceFilename: filename });
}
export function walk(node, visit, ancestors = []) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node, ancestors);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'extra', 'comments', 'tokens'].includes(key)) continue;
    if (Array.isArray(value)) for (const item of value) walk(item, visit, [...ancestors, node]);
    else if (value && typeof value.type === 'string') walk(value, visit, [...ancestors, node]);
  }
}
export function memberName(node) {
  return node?.type === 'Identifier' ? node.name : node?.type === 'StringLiteral' ? node.value : '';
}
function bindingFor(name, ancestors) {
  for (const scope of [...ancestors].reverse()) {
    if (/Function|Method/.test(scope.type) && scope.params?.some(param => param.name === name)) return null;
    if (!['Program', 'BlockStatement'].includes(scope.type)) continue;
    for (const statement of scope.body) {
      const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
      if (declaration?.type !== 'VariableDeclaration') continue;
      const binding = declaration.declarations.find(d => d.id.type === 'Identifier' && d.id.name === name);
      if (binding) return declaration.kind === 'const' ? { node: binding.init, ancestors: ancestors.slice(0, ancestors.indexOf(scope) + 1) } : null;
    }
  }
  return null;
}
// Resolve only immutable local bindings, nearest lexical scope first. Unknown
// expressions stay symbolic, preserving prefixes such as bg-opacity-${value}.
export function values(node, ancestors = [], seen = new Set()) {
  if (!node || seen.has(node)) return ['${?}'];
  const next = new Set([...seen, node]);
  const read = child => values(child, [...ancestors, node], next);
  const combine = (left, right) => {
    if (left.length * right.length > 256) throw new Error('Class expression exceeds static expansion budget; use complete class literals');
    return left.flatMap(a => right.map(b => a + b));
  };
  switch (node.type) {
    case 'StringLiteral': return [node.value];
    case 'NumericLiteral': return [String(node.value)];
    case 'NullLiteral': case 'BooleanLiteral': return [''];
    case 'TemplateLiteral': {
      let result = [node.quasis[0].value.cooked ?? node.quasis[0].value.raw];
      node.expressions.forEach((expr, index) => { result = combine(combine(result, read(expr)), [node.quasis[index + 1].value.cooked ?? node.quasis[index + 1].value.raw]); });
      return result;
    }
    case 'BinaryExpression': return node.operator === '+' ? combine(read(node.left), read(node.right)) : ['${?}'];
    case 'ConditionalExpression': return [...read(node.consequent), ...read(node.alternate)];
    case 'LogicalExpression': return [...read(node.left), ...read(node.right)];
    case 'ArrayExpression': return node.elements.flatMap(read);
    case 'ObjectExpression': return node.properties.flatMap(p => p.type === 'ObjectProperty' ? [...(p.computed ? read(p.key) : [memberName(p.key)]), ...read(p.value)] : []);
    case 'TSAsExpression': case 'TSSatisfiesExpression': case 'TSNonNullExpression': case 'ParenthesizedExpression': case 'JSXExpressionContainer': return read(node.expression);
    case 'CallExpression': {
      if (/^(cn|clsx|classnames|classNames|cva|twMerge)$/.test(memberName(node.callee))) return node.arguments.flatMap(read);
      if (node.callee.type === 'MemberExpression' && memberName(node.callee.property) === 'join') return read(node.callee.object);
      return ['${?}'];
    }
    case 'MemberExpression': {
      const binding = node.object.type === 'Identifier' ? bindingFor(node.object.name, ancestors) : { node: node.object, ancestors };
      if (binding?.node?.type === 'ObjectExpression') {
        const property = binding.node.properties.find(p => p.type === 'ObjectProperty' && memberName(p.key) === memberName(node.property));
        if (property) return values(property.value, binding.ancestors, next);
      }
      return ['${?}'];
    }
    case 'Identifier': {
      const binding = bindingFor(node.name, ancestors);
      return binding ? values(binding.node, binding.ancestors, next) : ['${?}'];
    }
    default: return ['${?}'];
  }
}
export function legacyUtility(token) {
  // Split variants outside arbitrary brackets (e.g. supports-[display:grid]).
  let depth = 0, start = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === '[') depth++;
    if (token[i] === ']') depth--;
    if (token[i] === ':' && depth === 0) start = i + 1;
  }
  const utility = token.slice(start).replace(/^!|!$/g, '');
  return /^(?:shadow|rounded|blur|backdrop-blur|drop-shadow|ring|outline-none|overflow-ellipsis|decoration-(?:slice|clone)|flex-(?:shrink|grow)(?:-.+)?|(?:bg|text|border|divide|ring|placeholder)-opacity-.+)$/.test(utility);
}
export function lintClasses(source, filename) {
  const findings = [];
  const tree = parseSource(source, filename);
  const inspect = (node, ancestors) => {
    for (const value of values(node, ancestors)) {
      for (const token of value.split(/\s+/)) {
        if (legacyUtility(token)) findings.push({ line: node.loc.start.line, token });
      }
    }
  };
  walk(tree, (node, ancestors) => {
    if (node.type === 'JSXAttribute' && /^(className|class)$/.test(node.name.name)) inspect(node.value, ancestors);
    if (node.type === 'VariableDeclarator' && /(?:className|classes|classNames|.*Classes|.*ClassName)$/.test(node.id.name ?? '')) inspect(node.init, ancestors);
    if (node.type === 'ObjectProperty' && /^(className|class)$/.test(memberName(node.key))) inspect(node.value, ancestors);
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && memberName(node.left.property) === 'className') inspect(node.right, ancestors);
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      if (callee.type === 'MemberExpression' && memberName(callee.property) === 'setAttribute' && values(node.arguments[0], ancestors).includes('class')) inspect(node.arguments[1], ancestors);
      if (/^(cn|clsx|classnames|classNames|cva|twMerge)$/.test(memberName(callee)) ||
          (callee.type === 'MemberExpression' && memberName(callee.object?.property) === 'classList' && /^(add|remove|toggle|replace)$/.test(memberName(callee.property)))) {
        node.arguments.forEach(arg => inspect(arg, ancestors));
      }
    }
  });
  return [...new Map(findings.map(f => [`${f.line}:${f.token}`, f])).values()];
}
export function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}
export function runSourceGuard(lint, root = 'frontend/src') {
  let count = 0;
  for (const path of sourceFiles(resolve(root))) {
    for (const finding of lint(readFileSync(path, 'utf8'), path)) {
      console.error(`${relative(process.cwd(), path)}:${finding.line}: ${finding.token}`);
      count++;
    }
  }
  console.log(`Source guard: ${count} finding(s).`);
  return count ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runSourceGuard(lintClasses, process.argv[2]);
