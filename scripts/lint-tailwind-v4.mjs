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
// Only immutable local syntax is resolved. No source is imported or evaluated.
const UNKNOWN = '${?}';
const LIMIT = 256;
const bounded = result => {
  if (result.length > LIMIT) throw new Error('Class expression exceeds static expansion budget; use complete class literals');
  return result;
};
const combine = (left, right) => {
  if (left.length * right.length > LIMIT) throw new Error('Class expression exceeds static expansion budget; use complete class literals');
  return left.flatMap(a => right.map(b => a + b));
};
function dereference(node, ancestors, seen = new Set()) {
  if (!node || seen.has(node)) return { node: null, ancestors };
  if (node.type === 'Identifier') {
    const binding = bindingFor(node.name, ancestors);
    return binding ? dereference(binding.node, binding.ancestors, new Set([...seen, node])) : {node, ancestors};
  }
  return {node, ancestors};
}
function arrayItems(node, ancestors, seen = new Set()) {
  const target = dereference(node, ancestors, seen);
  if (target.node?.type !== 'ArrayExpression' || seen.has(target.node)) return null;
  const next = new Set([...seen, target.node]);
  const result = [];
  for (const item of target.node.elements) {
    if (item?.type === 'SpreadElement') {
      const spread = arrayItems(item.argument, target.ancestors, next);
      if (!spread) return null;
      result.push(...spread);
    } else result.push({node: item, ancestors: target.ancestors});
    bounded(result);
  }
  return result;
}
// Resolve own literal properties in JavaScript override order; retain original binding scopes.
function objectMembers(node, ancestors = [], seen = new Set(), requestedKeys = null) {
  const target = dereference(node, ancestors, seen);
  const unknown = () => new Map((requestedKeys ?? [UNKNOWN]).map(key => [key, {
    candidates: [{node: null, ancestors: target.ancestors}], definite: false,
  }]));
  if (!target.node || seen.has(target.node)) return unknown();
  const next = new Set([...seen, target.node]);
  if (['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(target.node.type)) {
    return objectMembers(target.node.expression, target.ancestors, next, requestedKeys);
  }
  if (target.node.type !== 'ObjectExpression') return unknown();
  const result = new Map();
  const merge = (key, entry) => {
    const previous = result.get(key);
    const candidates = entry.definite || !previous ? entry.candidates : [...previous.candidates, ...entry.candidates];
    result.set(key, {
      candidates: bounded([...new Map(candidates.map(candidate => [candidate.node, candidate])).values()]),
      definite: entry.definite || Boolean(previous?.definite),
    });
  };
  for (const property of target.node.properties) {
    if (property.type === 'SpreadElement') {
      for (const [key, entry] of objectMembers(property.argument, target.ancestors, next, requestedKeys)) merge(key, entry);
      continue;
    }
    if (!['ObjectProperty', 'ObjectMethod'].includes(property.type)) continue;
    const keys = property.computed ? values(property.key, target.ancestors, next)
      : [property.key.type === 'NumericLiteral' ? String(property.key.value) : memberName(property.key)];
    const unknownKey = keys.some(key => key.includes(UNKNOWN));
    const selected = requestedKeys ? (unknownKey ? requestedKeys : keys.filter(key => requestedKeys.includes(key))) : keys;
    for (const key of selected) merge(key, {
      candidates: [{node: property.type === 'ObjectProperty' ? property.value : null, ancestors: target.ancestors}],
      definite: !unknownKey && keys.length === 1,
    });
  }
  return result;
}
export function values(node, ancestors = [], seen = new Set()) {
  if (!node || seen.has(node)) return [UNKNOWN];
  const next = new Set([...seen, node]);
  const read = child => values(child, [...ancestors, node], next);
  switch (node.type) {
    case 'StringLiteral': return [node.value];
    case 'NumericLiteral': return [String(node.value)];
    case 'NullLiteral': case 'BooleanLiteral': return [''];
    case 'TemplateLiteral': {
      let result = [node.quasis[0].value.cooked ?? node.quasis[0].value.raw];
      node.expressions.forEach((expr, index) => { result = combine(combine(result, read(expr)), [node.quasis[index + 1].value.cooked ?? node.quasis[index + 1].value.raw]); });
      return result;
    }
    case 'BinaryExpression': return node.operator === '+' ? combine(read(node.left), read(node.right)) : [UNKNOWN];
    case 'ConditionalExpression': return bounded([...read(node.consequent), ...read(node.alternate)]);
    case 'LogicalExpression': return bounded([...read(node.left), ...read(node.right)]);
    case 'ArrayExpression': return bounded(node.elements.flatMap(read));
    case 'SpreadElement': return read(node.argument);
    case 'ObjectExpression': return bounded(node.properties.flatMap(p => p.type === 'ObjectProperty' ? read(p.value) : []));
    case 'TSAsExpression': case 'TSSatisfiesExpression': case 'TSNonNullExpression': case 'ParenthesizedExpression': case 'JSXExpressionContainer': return read(node.expression);
    case 'CallExpression': case 'OptionalCallExpression': {
      if (/^(cn|clsx|classnames|classNames|cva|twMerge)$/.test(memberName(node.callee))) return classValues(node, ancestors, seen);
      if (['MemberExpression', 'OptionalMemberExpression'].includes(node.callee.type) && memberName(node.callee.property) === 'join') {
        const items = arrayItems(node.callee.object, ancestors);
        if (!items) return [UNKNOWN];
        const separators = node.arguments.length ? read(node.arguments[0]) : [','];
        return bounded(separators.flatMap(separator => items.reduce((result, item, index) => combine(combine(result, [index ? separator : '']), item.node ? values(item.node, item.ancestors, next) : ['']), [''])));
      }
      return [UNKNOWN];
    }
    case 'MemberExpression': case 'OptionalMemberExpression': {
      const keys = node.computed ? read(node.property) : [memberName(node.property)];
      // An unknown computed key may select any own property. Resolve the
      // complete finite map instead of projecting the UNKNOWN placeholder.
      const unknownKey = keys.some(key => key.includes(UNKNOWN));
      const members = objectMembers(node.object, ancestors, next, unknownKey ? null : keys);
      const result = [];
      for (const key of unknownKey ? members.keys() : keys) {
        const candidates = members.get(key)?.candidates ?? [{node: null, ancestors}];
        for (const candidate of candidates) {
          result.push(...values(candidate.node, candidate.ancestors, next));
          bounded(result);
        }
      }
      return result;
    }
    case 'Identifier': {
      const binding = bindingFor(node.name, ancestors);
      return binding ? values(binding.node, binding.ancestors, next) : [UNKNOWN];
    }
    default: return [UNKNOWN];
  }
}
function canBeTruthy(node, ancestors) {
  const target = dereference(node, ancestors);
  if (!target.node) return true;
  if (target.node.type === 'NullLiteral') return false;
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(target.node.type)) return Boolean(target.node.value);
  return true;
}
// clsx/cn emit truthy object KEYS; cva emits base, variant classes and
// compound class/className fields, never variant selectors/default selections.
function classValues(node, ancestors = [], seen = new Set()) {
  if (!node || seen.has(node)) return [UNKNOWN];
  const next = new Set([...seen, node]);
  const read = child => classValues(child, [...ancestors, node], next);
  if (node.type === 'Identifier') {
    const binding = bindingFor(node.name, ancestors);
    return binding ? classValues(binding.node, binding.ancestors, next) : [UNKNOWN];
  }
  if (node.type === 'ObjectExpression') {
    return bounded([...objectMembers(node, ancestors, seen)].filter(([, entry]) =>
      entry.candidates.some(candidate => canBeTruthy(candidate.node, candidate.ancestors))).map(([key]) => key));
  }
  if (node.type === 'ArrayExpression') return bounded(node.elements.flatMap(read));
  if (node.type === 'SpreadElement') return read(node.argument);
  if (['JSXExpressionContainer', 'TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(node.type)) return read(node.expression);
  if (node.type === 'ConditionalExpression') return bounded([...read(node.consequent), ...read(node.alternate)]);
  if (node.type === 'LogicalExpression') return bounded([...read(node.left), ...read(node.right)]);
  if (['CallExpression', 'OptionalCallExpression'].includes(node.type)) {
    const helper = memberName(node.callee);
    if (/^(cn|clsx|classnames|classNames|twMerge)$/.test(helper)) return bounded(node.arguments.flatMap(read));
    if (helper === 'cva') {
      const result = read(node.arguments[0]);
      const config = dereference(node.arguments[1], ancestors);
      const properties = value => value?.type === 'ObjectExpression' ? value.properties.filter(p => p.type === 'ObjectProperty') : [];
      for (const field of properties(config.node)) {
        const target = dereference(field.value, config.ancestors);
        if (memberName(field.key) === 'variants') {
          for (const variant of properties(target.node)) {
            const choices = dereference(variant.value, target.ancestors);
            for (const choice of properties(choices.node)) result.push(...classValues(choice.value, choices.ancestors, next));
          }
        }
        if (memberName(field.key) === 'compoundVariants') {
          for (const item of arrayItems(target.node, target.ancestors) ?? []) {
            const compound = dereference(item.node, item.ancestors);
            for (const property of properties(compound.node)) if (/^(class|className)$/.test(memberName(property.key))) result.push(...classValues(property.value, compound.ancestors, next));
          }
        }
      }
      return bounded(result);
    }
  }
  return values(node, ancestors, seen);
}
const projectCss = readFileSync(new URL('../frontend/src/index.css', import.meta.url), 'utf8');
function compatibleRadius(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Only the explicit inline v3 compatibility theme preserves bare rounded.
  // Root variables cannot substitute for this: they may have different values.
  return [...clean.matchAll(/@theme\s+inline\s*\{([^}]*)\}/g)].some(match => /--radius\s*:\s*0?\.25rem\s*;/.test(match[1]));
}
export function legacyUtility(token, radiusCompatible = compatibleRadius(projectCss)) {
  // Split variants outside arbitrary brackets (e.g. supports-[display:grid]).
  let depth = 0, start = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === '[') depth++;
    if (token[i] === ']') depth--;
    if (token[i] === ':' && depth === 0) start = i + 1;
  }
  const utility = token.slice(start).replace(/^!|!$/g, '');
  if (utility === 'rounded') return !radiusCompatible;
  return /^(?:shadow|blur|backdrop-blur|drop-shadow|ring|outline-none|overflow-ellipsis|decoration-(?:slice|clone)|flex-(?:shrink|grow)(?:-.+)?|(?:bg|text|border|divide|ring|placeholder)-opacity-.+)$/.test(utility);
}
export function lintClasses(source, filename, {css = projectCss} = {}) {
  const findings = [];
  const radiusCompatible = compatibleRadius(css);
  const tree = parseSource(source, filename);
  const inspect = (node, ancestors) => {
    for (const value of classValues(node, ancestors)) {
      for (const token of value.split(/\s+/)) {
        if (legacyUtility(token, radiusCompatible)) findings.push({ line: node.loc.start.line, token });
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
        if (/^(cn|clsx|classnames|classNames|cva|twMerge)$/.test(memberName(callee))) inspect(node, ancestors);
        else node.arguments.forEach(arg => inspect(arg, ancestors));
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
