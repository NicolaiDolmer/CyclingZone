#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

const budgets = [
  { name: "backend", cwd: "backend", maxWarnings: 0 },
  { name: "frontend", cwd: "frontend", maxWarnings: 26 },
];

let failed = false;

for (const budget of budgets) {
  const result = spawnSync("npm exec -- eslint . --format json", {
    cwd: budget.cwd,
    encoding: "utf8",
    shell: true,
  });

  const output = result.stdout?.trim();
  if (!output) {
    console.error(`[${budget.name}] eslint produced no JSON output`);
    if (result.error) console.error(result.error.message);
    if (result.stderr) console.error(result.stderr.trim());
    failed = true;
    continue;
  }

  let report;
  try {
    report = JSON.parse(output);
  } catch (error) {
    console.error(`[${budget.name}] could not parse eslint JSON: ${error.message}`);
    failed = true;
    continue;
  }

  const errors = report.reduce((sum, file) => sum + file.errorCount, 0);
  const warnings = report.reduce((sum, file) => sum + file.warningCount, 0);
  console.log(`[${budget.name}] eslint errors=${errors}, warnings=${warnings}/${budget.maxWarnings}`);

  if (errors > 0) {
    console.error(`[${budget.name}] eslint errors must be fixed before merge.`);
    failed = true;
  }
  if (warnings > budget.maxWarnings) {
    console.error(`[${budget.name}] warning budget exceeded. Reduce warnings or intentionally lower the baseline in this script.`);
    failed = true;
  }
}

if (failed) process.exit(1);
