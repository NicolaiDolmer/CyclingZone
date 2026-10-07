// Both CI artifacts render one audit snapshot; this module performs no DB reads.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function formatFeatureLivenessReport(summary) {
  const lines = [];
  const print = (value = '') => lines.push(String(value));
  const allFindings = summary.findings;
  const [findingsA, findingsB, findingsC, findingsD, findingsE] = ['A', 'B', 'C', 'D', 'E']
  .map(detector => allFindings.filter(f => f.detector === detector));
  print(`Feature-liveness audit — ${summary.generated_at}`);
  print(`Detectors: ${summary.detectors_run.join(", ")}`);
  print(`Total findings: ${summary.total_findings} (A=${summary.by_detector.A} B=${summary.by_detector.B} C=${summary.by_detector.C} D=${summary.by_detector.D} E=${summary.by_detector.E})\n`);

  if (findingsA.length > 0) {
    print(`Detector A — write-but-no-data (${findingsA.length}):`);
    for (const f of findingsA) {
      print(`  ${f.table}`);
      print(`    reason: ${f.reason}`);
      if (f.backend_files) print(`    backend: ${f.backend_files.join(", ")}`);
    }
    print();
  }
  if (findingsB.length > 0) {
    print(`Detector B — orphaned-endpoints (${findingsB.length}):`);
    for (const f of findingsB) {
      print(`  ${f.method} ${f.path}`);
    }
    print();
  }
  if (findingsC.length > 0) {
    print(`Detector C — migration-drift (${findingsC.length}):`);
    for (const f of findingsC) {
      print(`  ${f.filename}`);
      print(`    ${f.reason}`);
    }
    print();
  }
  if (findingsD.length > 0) {
    print(`Detector D — schema-drift (${findingsD.length}):`);
    for (const f of findingsD) {
      print(`  ${f.table}`);
      print(`    ${f.reason}`);
    }
    print();
  }
  if (findingsE.length > 0) {
    print(`Detector E — zero-impression-features (${findingsE.length}):`);
    for (const f of findingsE) {
      print(`  ${f.event_name}`);
      print(`    ${f.reason}`);
    }
    print();
  }
  if (allFindings.length === 0) {
    print("OK — no liveness findings.\n");
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.length !== 3) throw new Error('Usage: feature-liveness-report.js <audit.json>');
  const summary = JSON.parse(await readFile(process.argv[2], 'utf8'));
  process.stdout.write(formatFeatureLivenessReport(summary));
}