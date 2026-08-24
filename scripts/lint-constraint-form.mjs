#!/usr/bin/env node
// scripts/lint-constraint-form.mjs
// ============================================================
// Forward-guard mod SKEMA-FORM-DRIFT i migrationer (#4163).
//
// WHY (prod-incident 24/8-2026, #4163):
//   #3934 gjorde `no_rider_double_booking` DEFERRABLE INITIALLY IMMEDIATE. Det
//   er ikke pynt: batch-RPC'en apply_race_entry_unit_batch starter med
//   `set constraints no_rider_double_booking deferred`, og uden deferrability
//   afviser Postgres med 42809. Så falder entry-generator-sweepen tilbage til
//   per-enheds-skrivning med insert-før-delete, og hver rytter-swap mellem to
//   overlappende løb bliver et deterministisk dødvande.
//
//   #4155-reparationen (23/8) droppede constrainten før den skrev en ny
//   game_day-akse — helt korrekt — og genskabte den til sidst UDEN `deferrable`.
//   Constrainten var tilbage; formen var ikke. Reparationens post-verify
//   spurgte kun `select conname from pg_constraint ...` og så præcis dét den
//   spurgte om. Resultatet: sweepen fejlede 116-140 enheder pr. tick i timerne
//   op til S3's første løbsdag, og fejlteksten pegede på "ægte dobbeltbooking"
//   — den stik modsatte diagnose.
//
// RULE:
//   For hver constraint i CRITICAL_CONSTRAINTS gælder to ting i enhver
//   `database/*.sql`:
//     1. FORM: et `ADD CONSTRAINT <navn>` skal bære alle påkrævede klausuler.
//        Genskaber du den, genskaber du dens FULDE definition.
//     2. RETUR: dropper en fil constrainten, skal SAMME fil give den tilbage.
//        En migration må aldrig efterlade et kritisk DB-værn nedtaget.
//
//   Begge dele gælder også inde i DO $$ ... $$-blokke (den idiomatiske
//   idempotens-indpakning, jf. lint-migration-idempotency.mjs).
//
// Hvorfor statisk lint og ikke kun en runtime-tælling: fejlen blev FØDT i en
// SQL-fil i dette repo og kunne have været stoppet i preflight, timer før den
// ramte prod. Runtime-vagten findes også nu (sweepen navngiver 42809-driften i
// stedet for at rapportere den som 140 dobbeltbookinger), men den råber først
// EFTER skaden. Se .claude/learnings/2026-08-24-drop-recreate-constraint-
// mistede-deferrable.md.
//
// Usage:
//   node scripts/lint-constraint-form.mjs                  # alle database/*.sql
//   node scripts/lint-constraint-form.mjs database/foo.sql # bestemte filer
//   npm run lint:constraint-form                           # samme som default
//
// Exit codes:
//   0 — ingen fund
//   1 — mindst én constraint genskabt i forkert form, eller droppet uden retur
//
// Refs #4163 #4155 #3934 #3420 #4159.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitStatements } from './lint-migration-idempotency.mjs';

// ---------------------------------------------------------------------------
// Registret. Kun constraints hvor FORMEN bærer en driftsgaranti hører hjemme
// her — ikke enhver constraint i skemaet. Hver post skal forklare HVAD der går
// i stykker hvis klausulen forsvinder, så den næste der læser fejlen kan tage
// en informeret beslutning i stedet for at føje en lint tilfredsstillende.
// ---------------------------------------------------------------------------
export const CRITICAL_CONSTRAINTS = {
  no_rider_double_booking: {
    table: 'race_entries',
    require: [
      {
        name: 'DEFERRABLE',
        // SQL er case-insensitivt; repoets migrationer skriver konsekvent småt.
        test: (s) => /\bDEFERRABLE\b/i.test(s),
        fix: 'deferrable initially immediate',
      },
    ],
    // #4173: invarianten FLYTTEDE til race_entry_days. Et drop uden retur er
    // lovligt hvis SAMME fil tilføjer afløseren (som selv står i dette register
    // og dermed form-tjekkes). Alle andre drops uden retur er stadig fund.
    supersededBy: 'no_rider_double_booking_day',
    why:
      'apply_race_entry_unit_batch (#3934) kører `set constraints no_rider_double_booking deferred` ' +
      'for at gøre en rytter-swap mellem to overlappende løb lovlig som helhed. Uden DEFERRABLE ' +
      'svarer Postgres 42809, hele batchen afvises, og entry-generator-sweepen ryger i det ' +
      'insert-før-delete-dødvande #3934 fjernede (prod-incident #4163, 24/8-2026).',
  },
  no_rider_double_booking_day: {
    table: 'race_entry_days',
    require: [
      {
        name: 'DEFERRABLE',
        test: (s) => /\bDEFERRABLE\b/i.test(s),
        fix: 'deferrable initially immediate',
      },
    ],
    why:
      '#4173-afløseren for no_rider_double_booking (dag-mængde i stedet for spænd). ' +
      'apply_race_entry_unit_batch udskyder nu DENNE constraint (`set constraints ' +
      'no_rider_double_booking_day deferred`) — uden DEFERRABLE svarer Postgres 42809 ' +
      'og sweepen rammer præcis samme dødvande som #4163.',
  },
};

// ---------------------------------------------------------------------------
// Historik der IKKE rewrites. Samme idiom som WHITELIST i
// lint-migration-idempotency.mjs: en allerede-applied migration rettes ikke
// bagud — den får en efterfølger. Posten skal navngive den fil der reparerer
// den, så listen dokumenterer hændelsen frem for at skjule den.
//
// NYE migrationer må ALDRIG tilføjes her. Ret formen i stedet.
// ---------------------------------------------------------------------------
export const REMEDIATED = {
  '2026-08-18-3420-race-entries-rider-day-invariant.sql':
    'Oprettede constrainten FØR #3934 gjorde den deferrable — korrekt for sin dato, ikke drift. ' +
    'Formen blev sat af database/2026-08-18-3934-sweep-batch-rpc-deferrable.sql samme dag.',
  '2026-08-23-4155-s3-gameday-repair.sql':
    'Genskabte no_rider_double_booking uden DEFERRABLE og udløste prod-incident #4163 ' +
    '(sweepen i deterministisk dødvande, 116-140 fejlende enheder pr. tick, dagen før S3-start). ' +
    'Repareret af database/2026-08-24-4163-restore-deferrable-double-booking.sql. ' +
    'Filen er applied historik og rewrites ikke — denne post ER hændelsens spor i koden.',
};

const CONSTRAINT_NAMES = Object.keys(CRITICAL_CONSTRAINTS);

// `add constraint <navn>` / `drop constraint [if exists] <navn>`, uanset
// indrykning, linjeskift og om det står inde i en DO-blok.
const addRe = (name) => new RegExp(`\\bADD\\s+CONSTRAINT\\s+${name}\\b`, 'gi');
const dropRe = (name) => new RegExp(`\\bDROP\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?${name}\\b`, 'gi');

/**
 * Definitionen der hører til et `ADD CONSTRAINT`-match: teksten fra matchet og
 * frem til statementets næste `;` (eller statementets slutning). Det holder
 * klausul-tjekket lokalt, så en `deferrable` længere nede i samme DO-blok — på
 * en HELT anden constraint — aldrig kan få en manglende klausul til at bestå.
 *
 * @param {string} stmtText
 * @param {number} from index i stmtText hvor `ADD CONSTRAINT` starter
 * @returns {string}
 */
export function definitionAfter(stmtText, from) {
  const end = stmtText.indexOf(';', from);
  return end === -1 ? stmtText.slice(from) : stmtText.slice(from, end);
}

/** 1-baseret linjenummer for `index` inde i et statement der starter på `startLine`. */
function lineOf(stmtText, index, startLine) {
  let n = 0;
  for (let i = 0; i < index && i < stmtText.length; i++) if (stmtText[i] === '\n') n++;
  return startLine + n;
}

/**
 * Scan én SQL-kilde for form-drift + droppet-uden-retur.
 *
 * @param {string} source
 * @param {string} file rapporteret sti
 * @returns {Array<{file: string, line: number, constraint: string, kind: string, message: string}>}
 */
export function scanSource(source, file = '<inline>') {
  const findings = [];
  const statements = splitStatements(source);

  // Første pas: tæl adds/drops pr. bevogtet constraint, så supersededBy-reglen
  // nedenfor kan slå afløserens tilstedeværelse op på tværs af navnene.
  const tally = {};
  for (const name of CONSTRAINT_NAMES) {
    const spec = CRITICAL_CONSTRAINTS[name];
    let added = 0;
    let dropped = 0;
    let firstDropLine = 0;

    for (const stmt of statements) {
      for (const m of stmt.text.matchAll(dropRe(name))) {
        dropped++;
        if (!firstDropLine) firstDropLine = lineOf(stmt.text, m.index, stmt.line);
      }

      for (const m of stmt.text.matchAll(addRe(name))) {
        added++;
        const def = definitionAfter(stmt.text, m.index);
        const line = lineOf(stmt.text, m.index, stmt.line);
        for (const clause of spec.require) {
          if (clause.test(def)) continue;
          findings.push({
            file,
            line,
            constraint: name,
            kind: 'form-drift',
            message:
              `ADD CONSTRAINT ${name} mangler ${clause.name}. Tilføj: ${clause.fix}\n` +
              `      Hvorfor: ${spec.why}`,
          });
        }
      }
    }

    tally[name] = { added, dropped, firstDropLine };
  }

  for (const name of CONSTRAINT_NAMES) {
    const spec = CRITICAL_CONSTRAINTS[name];
    const { added, dropped, firstDropLine } = tally[name];
    if (dropped === 0 || added > 0) continue;

    // #4173: et drop uden retur er lovligt når SAMME fil etablerer den
    // registrerede afløser — invarianten er flyttet, ikke nedtaget. Afløserens
    // egen form tjekkes af dens eget registry-entry ovenfor.
    if (spec.supersededBy && (tally[spec.supersededBy]?.added ?? 0) > 0) continue;

    findings.push({
      file,
      line: firstDropLine,
      constraint: name,
      kind: 'dropped-not-restored',
      message:
        `${name} droppes i denne fil, men gives aldrig tilbage. Et kritisk DB-værn må ` +
        `aldrig efterlades nedtaget af en migration.` +
        (spec.supersededBy
          ? ` (Lovlig undtagelse: samme fil tilføjer afløseren ${spec.supersededBy}.)`
          : '') +
        `\n      Hvorfor: ${spec.why}`,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function repoRoot() {
  return resolve(fileURLToPath(new URL('..', import.meta.url)));
}

export function defaultFiles() {
  const dir = resolve(repoRoot(), 'database');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => resolve(dir, f))
    .filter((f) => statSync(f).isFile());
}

function main(argv) {
  const files = argv.length ? argv.map((f) => resolve(f)) : defaultFiles();
  const findings = [];
  const skipped = [];

  for (const file of files) {
    const name = basename(file);
    if (REMEDIATED[name]) {
      skipped.push(name);
      continue;
    }
    findings.push(...scanSource(readFileSync(file, 'utf8'), name));
  }

  if (findings.length === 0) {
    console.log(
      `\n✅ Constraint-form guard: ${files.length - skipped.length} SQL-fil(er) scannet, ` +
      `${CONSTRAINT_NAMES.length} kritisk(e) constraint(s) bevogtet, ingen form-drift.` +
      (skipped.length ? `\n   Sprunget over (repareret historik): ${skipped.join(', ')}` : '')
    );
    return 0;
  }

  console.error(`\n❌ Constraint-form guard: ${findings.length} fund\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} [${f.kind}]`);
    console.error(`      ${f.message}\n`);
  }
  console.error(
    'Genskaber du en constraint, genskab dens FULDE definition — og verificér FORMEN\n' +
    '(pg_constraint.condeferrable), ikke bare at navnet findes. Se #4163.\n'
  );
  return 1;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
