// Lane cap per machine (#6615). One shared config, read by both runtimes'
// admission (wave-policy.mjs for Claude, codex-wave.mjs for Codex), so the two
// can never disagree. Key = host name uppercased; unknown hosts get "default".
// The verify semaphore (2) is separate and unchanged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WAVE_CAPACITY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wave-capacity.json');

const isLaneCount = value => Number.isInteger(value) && value >= 1;

export function currentHost(hostname = os.hostname, env = process.env) {
  return String(hostname() || env.COMPUTERNAME || '').trim().toUpperCase();
}

// Fails closed: a missing or malformed config blocks admission instead of
// silently falling back to some other cap.
export function readWaveCapacity(file = WAVE_CAPACITY_FILE) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`Invalid wave capacity config: ${file}`);
  const capacity = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isLaneCount(value)) throw Error(`Invalid lane cap for ${key} in ${file}`);
    capacity[key === 'default' ? 'default' : key.toUpperCase()] = value;
  }
  if (!isLaneCount(capacity.default)) throw Error(`Wave capacity config needs an integer "default": ${file}`);
  return capacity;
}

export function hostLaneCap(host = currentHost(), capacity = readWaveCapacity()) {
  const name = String(host || '').trim().toUpperCase();
  const cap = Object.hasOwn(capacity, name) && name !== 'DEFAULT' ? capacity[name] : capacity.default;
  return { host: name || 'unknown', cap };
}

export function assertLaneCount(lanes, limit, label = 'lanes') {
  if (!Number.isInteger(lanes) || lanes < 1 || lanes > limit.cap) {
    throw Error(`${label} must be an integer from 1 to ${limit.cap} (lane cap on ${limit.host}, scripts/wave-capacity.json)`);
  }
  return lanes;
}
