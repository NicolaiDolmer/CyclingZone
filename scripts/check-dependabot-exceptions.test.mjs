// scripts/check-dependabot-exceptions.test.mjs
// Tests for dependabot-exceptions-vagten (#4551).
//
// Den vigtigste test i filen er "ville have fanget maj-september-hullet":
// den koerer vagten mod den PRAECISE GHSA-allowlist-form dependency-review.yml
// havde foer #4547 fjernede den (allow-ghsas UDEN review-dato), og bekraefter
// at den flages. Se ogsaa integrationstesten mod repoets FAKTISKE filer
// nederst — den er den obligatoriske "bider FOR merge"-bevis fra PR-body'en.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  scanDependabotIgnores,
  scanDependencyReviewAllowlist,
  defaultTargets,
} from './check-dependabot-exceptions.mjs';

const NOW = new Date('2026-09-01T00:00:00Z');

// ------------------------------------------------------------ selve fejlklassen

test('ville have fanget maj-september-hullet: allow-ghsas uden review-dato', () => {
  const yml = [
    '      - name: Block vulnerable dependency changes',
    '        uses: actions/dependency-review-action@v5',
    '        with:',
    '          fail-on-severity: high',
    '          # MIDLERTIDIG, ÉN advisory — se #2960 for planen om at fjerne den igen.',
    '          allow-ghsas: GHSA-qwww-vcr4-c8h2',
  ].join('\n');
  const found = scanDependencyReviewAllowlist(yml, 'fixture.yml', NOW);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /review-dato/);
});

test('stale dependabot-ignore uden issue-reference OG uden review-dato', () => {
  const yml = [
    'ignore:',
    '  # Vite 5 → 8 er 3 major-bumps på én gang — kræver dedikeret session',
    '  - dependency-name: "vite"',
    '    update-types: ["version-update:semver-major"]',
  ].join('\n');
  const found = scanDependabotIgnores(yml, 'fixture.yml', NOW);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /issue-reference.*OG.*review-dato|mangler både/);
});

// ------------------------------------------------------------------- positive

test('dependabot-ignore MED issue + review-dato er intet fund', () => {
  const yml = [
    'ignore:',
    '  # Express 5 har breaking middleware-API — #4565 - review 2026-12-01',
    '  - dependency-name: "express"',
    '    update-types: ["version-update:semver-major"]',
  ].join('\n');
  assert.deepEqual(scanDependabotIgnores(yml, 'fixture.yml', NOW), []);
});

test('flerlinjet kommentarblok med reference i FØRSTE linje er gyldig', () => {
  const yml = [
    'ignore:',
    '  # Tailwind 4 kræver postcss-plugin migration — #134 - review 2026-12-01',
    '  # (uddybende linje der ikke selv indeholder hverken # eller dato)',
    '  - dependency-name: "tailwindcss"',
    '    update-types: ["version-update:semver-major"]',
  ].join('\n');
  assert.deepEqual(scanDependabotIgnores(yml, 'fixture.yml', NOW), []);
});

test('allow-ghsas MED issue + review-dato er intet fund', () => {
  const yml = [
    '          # Se #4551 - review 2026-12-01 for begrundelsen.',
    '          allow-ghsas: GHSA-aaaa-bbbb-cccc',
  ].join('\n');
  assert.deepEqual(scanDependencyReviewAllowlist(yml, 'fixture.yml', NOW), []);
});

test('tom allow-ghsas-skabelonlinje (ingen værdi) er intet fund', () => {
  const yml = ['          allow-ghsas:'].join('\n');
  assert.deepEqual(scanDependencyReviewAllowlist(yml, 'fixture.yml', NOW), []);
});

// -------------------------------------------------------------- udløbs-logik

test('review-dato i FORTIDEN fejler, selv med issue-reference', () => {
  const yml = [
    'ignore:',
    '  # #999 - review 2020-01-01',
    '  - dependency-name: "expired-example"',
    '    update-types: ["version-update:semver-major"]',
  ].join('\n');
  const found = scanDependabotIgnores(yml, 'fixture.yml', NOW);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /OVERSKREDET/);
});

test('review-dato PRÆCIS i dag er stadig gyldig (ikke overskredet)', () => {
  const yml = [
    'ignore:',
    '  # #1 - review 2026-09-01',
    '  - dependency-name: "today-example"',
    '    update-types: ["version-update:semver-major"]',
  ].join('\n');
  assert.deepEqual(scanDependabotIgnores(yml, 'fixture.yml', NOW), []);
});

test('review-dato i FREMTIDEN er gyldig', () => {
  const yml = [
    'ignore:',
    '  # #1 - review 2030-01-01',
    '  - dependency-name: "future-example"',
    '    update-types: ["version-update:semver-major"]',
  ].join('\n');
  assert.deepEqual(scanDependabotIgnores(yml, 'fixture.yml', NOW), []);
});

// -------------------------------------------------------------- afgraensninger

test('en blank linje afbryder kommentarblokken — reference over den tæller ikke', () => {
  const yml = [
    'ignore:',
    '  # #1 - review 2030-01-01',
    '',
    '  - dependency-name: "separated-example"',
    '    update-types: ["version-update:semver-major"]',
  ].join('\n');
  const found = scanDependabotIgnores(yml, 'fixture.yml', NOW);
  assert.equal(found.length, 1);
});

test('ingen kommentar overhovedet giver "ingen kommentarblok"-besked', () => {
  const yml = [
    'ignore:',
    '  - dependency-name: "no-comment-example"',
    '    update-types: ["version-update:semver-major"]',
  ].join('\n');
  const found = scanDependabotIgnores(yml, 'fixture.yml', NOW);
  assert.equal(found.length, 1);
  assert.match(found[0].message, /ingen kommentarblok/);
});

// -------------------------------------------------------------- repoet selv

test('repoets NUVÆRENDE .github/dependabot.yml + dependency-review.yml er fri for fejlklassen', () => {
  const { dependabotYml, dependencyReviewYml } = defaultTargets();
  const findings = [
    ...scanDependabotIgnores(readFileSync(dependabotYml, 'utf8'), 'dependabot.yml'),
    ...scanDependencyReviewAllowlist(readFileSync(dependencyReviewYml, 'utf8'), 'dependency-review.yml'),
  ];
  assert.deepEqual(
    findings.map((f) => `${f.file}:${f.line} ${f.name}`), [],
    'en ignore/allowlist-entry mangler issue-reference eller ikke-udløbet review-dato - se #4551'
  );
});
