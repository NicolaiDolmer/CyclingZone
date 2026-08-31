// scripts/check-rls-classification-coverage.test.mjs
// Regressionstest for RLS-klassificerings-vagten (#4440).
// Run: node --test scripts/check-rls-classification-coverage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkDocument } from './check-rls-classification-coverage.mjs';

/** Minimalt dokument i samme form som den rigtige ADR. */
function doc({ grantRows, sections, ledger }) {
  return [
    '# ADR: test',
    '',
    '| Grant-mønster (anon + authenticated identisk) | Antal | Tabeller |',
    '|---|---|---|',
    ...grantRows,
    '',
    '### De nævnte',
    '',
    ...sections,
    '',
    '### Samlet regnskab',
    '',
    '| Bucket | Antal | Hvor |',
    '|---|---|---|',
    ...ledger,
    '',
  ].join('\n');
}

const OK_SECTION = [
  '#### `alpha` - Bevidst default-deny',
  '- **Grants:** kun `SELECT`.',
  '- **Skriv/læs:** `backend/lib/alphaSweep.js:42`.',
  '- **Frontend:** ingen forekomst.',
];

test('godkender et dokument hvor hver nævnt tabel har en begrundet sektion', () => {
  const text = doc({
    grantRows: ['| Kun `SELECT` | 1 | `alpha` |'],
    sections: OK_SECTION,
    ledger: ['| Drift | 1 | denne sektion |', '| **Sum** | **1** | målt |'],
  });
  assert.deepEqual(checkDocument(text).findings, []);
});

test('flager en tabel der er nævnt i grant-tabellen men mangler sin egen sektion (#4440-fejlklassen)', () => {
  const text = doc({
    grantRows: ['| Kun `SELECT` | 2 | `alpha`, `beta` |'],
    sections: OK_SECTION,
    ledger: ['| Drift | 2 | denne sektion |', '| **Sum** | **2** | målt |'],
  });
  const { findings } = checkDocument(text);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /`beta`.*ingen "#### `beta`"-sektion/);
});

test('flager en sektion uden fil:linje-begrundelse - overskrift alene er ikke en klassificering', () => {
  const text = doc({
    grantRows: ['| Kun `SELECT` | 1 | `alpha` |'],
    sections: [
      '#### `alpha` - Bevidst default-deny',
      '- **Grants:** kun `SELECT`.',
      '- **Skriv/læs:** backenden rører den vist nok et sted.',
    ],
    ledger: ['| Drift | 1 | denne sektion |', '| **Sum** | **1** | målt |'],
  });
  const { findings } = checkDocument(text);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /uden begrundelse/);
});

test('accepterer "ingen kodesti rører den" som begrundelse i stedet for fil:linje', () => {
  const text = doc({
    grantRows: ['| Kun `SELECT` | 1 | `alpha` |'],
    sections: [
      '#### `alpha` - Bevidst default-deny',
      '- **Skriv/læs:** tabellen læses ikke af nogen kodesti.',
    ],
    ledger: ['| Drift | 1 | denne sektion |', '| **Sum** | **1** | målt |'],
  });
  assert.deepEqual(checkDocument(text).findings, []);
});

test('flager når en grant-buckets antal ikke matcher navnene i cellen', () => {
  const text = doc({
    grantRows: ['| Kun `SELECT` | 3 | `alpha` |'],
    sections: OK_SECTION,
    ledger: ['| Drift | 1 | denne sektion |', '| **Sum** | **1** | målt |'],
  });
  const { findings } = checkDocument(text);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /siger 3 tabeller, men cellen nævner 1/);
});

test('flager en tabel der står i to grant-buckets', () => {
  const text = doc({
    grantRows: ['| Kun `SELECT` | 1 | `alpha` |', '| Ingen grant | 1 | `alpha` |'],
    sections: OK_SECTION,
    ledger: ['| Drift | 1 | denne sektion |', '| **Sum** | **1** | målt |'],
  });
  const { findings } = checkDocument(text);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /mere end én grant-bucket/);
});

test('flager når "Samlet regnskab" ikke summer', () => {
  const text = doc({
    grantRows: ['| Kun `SELECT` | 1 | `alpha` |'],
    sections: OK_SECTION,
    ledger: ['| Navngivne | 9 | #4439 |', '| Drift | 1 | denne sektion |', '| **Sum** | **101** | målt |'],
  });
  const { findings } = checkDocument(text);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /summer ikke: 9 \+ 1 = 10, men sum-rækken siger 101/);
});

test('kaster hvis grant-tabellen er væk - dokumentets struktur er ændret under vagten', () => {
  assert.throws(
    () => checkDocument('# ADR\n\nIngen tabeller her.\n'),
    /grant-mønster-tabellen blev ikke fundet/,
  );
});

test('det rigtige dokument er konsistent: 26 klassificerede tabeller, regnskab = 101', () => {
  const text = readFileSync('docs/decisions/rls-no-policy-classification.md', 'utf8');
  const { findings, tablesChecked, total } = checkDocument(text);
  assert.deepEqual(findings, []);
  assert.equal(tablesChecked, 26);
  assert.equal(total, 101);
});
