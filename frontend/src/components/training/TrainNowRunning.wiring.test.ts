import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #6839 (owner choice A 19/10): while the evening run trains the team, "Run now"
// shows "Running…" with a spinner and the page updates by itself. No error line.
const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(here, "TrainNowClient.ts"), "utf8");
const page = readFileSync(join(here, "..", "..", "pages", "TrainingPage.jsx"), "utf8");
const locales = ["en", "da", "es", "fr", "nl"].map((lang) => ({
  lang,
  json: JSON.parse(readFileSync(join(here, "..", "..", "..", "public", "locales", lang, "training.json"), "utf8")),
}));

test("#6839: training_in_progress sets running, not an error", () => {
  const branch = client.slice(client.indexOf('data.error === "training_in_progress"'));
  assert.ok(branch.length > 0, "the client handles the server's 409 training_in_progress");
  const body = branch.slice(0, branch.indexOf("}"));
  assert.match(body, /setRunning\(true\)/);
  assert.doesNotMatch(body, /setError\(/, "running is not shown as an error");
});

test("#6839: polling stops when the date is settled, refreshes once, and has a ceiling", () => {
  assert.match(client, /TRAIN_NOW_RUNNING_POLL_MS = 10_000/);
  assert.match(client, /TRAIN_NOW_RUNNING_MAX_MS = 15 \* 60_000/);
  assert.match(client, /TRAIN_NOW_STATUS_TIMEOUT_MS = 8_000/);
  assert.match(client, /next\?\.settled === true && stop\(\)/, "only the call that stops refreshes");
  assert.match(client, /return \{ status, result, error, pressing, running, press, reload: load \}/);
});

test("#6839 (Codex P2): the ceiling is its own timer and calls never overlap", () => {
  assert.match(client, /const ceiling = setTimeout\(stop, TRAIN_NOW_RUNNING_MAX_MS\)/,
    "the ceiling does not wait for a status call");
  assert.match(client, /if \(stopped \|\| polling\) return;/, "one status call at a time");
  assert.match(client, /await load\(request.signal\)/, "each status call is time-bounded");
  assert.match(client, /clearTimeout\(ceiling\)/);
});

test("#6839: the page shows Running… on the buttons and the status line", () => {
  assert.match(page, /trainNow\.running \? t\("trainNow\.running"\)/);
  assert.match(page, /trainNow\.running\s*\? t\("overview\.statusRunning"\)/);
  const loadingProps = page.match(/loading=\{trainNow\.running/g) ?? [];
  assert.equal(loadingProps.length, 3, "primary + both Run now buttons show the spinner");
});

test("#6839: every language has the two new strings", () => {
  for (const { lang, json } of locales) {
    assert.ok(json.trainNow?.running, `${lang}: trainNow.running`);
    assert.ok(json.overview?.statusRunning, `${lang}: overview.statusRunning`);
  }
});
