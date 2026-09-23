// One host boot identity for every wave comparison (#5533).
//
// Windows reports LastBootUpTime as "now minus uptime", so every clock sync
// moves the raw value a little within the SAME boot (observed 23/9: +0.772 ms,
// which made an owned release fail and would have let recovery treat a live
// wave as "host-restarted"). Raw ticks are therefore not an identity.
//
// The kernel records the boot start at exactly half a second (Kernel-General
// event 12 StartTime ended in .5000000 for all three boots measured 23/9), so
// rounding to the NEAREST second would sit on the boundary and flip on the
// first negative drift.
// Truncating to whole seconds keeps a +-0.5 s margin; comparisons additionally
// accept a small tolerance. A real restart moves the boot time by at least the
// previous boot's uptime (minutes or more), far outside both.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TICKS_PER_SECOND = 10_000_000n;
// Comparisons only; the lock key uses the normalized value itself.
export const SAME_BOOT_TOLERANCE_SECONDS = 2;
const TOLERANCE_TICKS = BigInt(SAME_BOOT_TOLERANCE_SECONDS) * TICKS_PER_SECOND;
// .NET DateTime ticks for any realistic boot date (16-19 digits). Other ids
// (Linux boot_id UUIDs, test fixtures) are opaque and compared exactly.
const WINDOWS_TICKS = /^[1-9]\d{15,18}$/;

// PowerShell expression shared by hostBootId() and processSnapshot(), so both
// measure the same source. Callers must pass its output through normalizeBootId.
export const WINDOWS_BOOT_TICKS_EXPRESSION = '(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks.ToString()';

export function normalizeBootId(raw) {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  if (!WINDOWS_TICKS.test(value)) return value;
  const ticks = BigInt(value);
  return (ticks - (ticks % TICKS_PER_SECOND)).toString();
}

// Backwards compatible: markers written before #5533 hold raw ticks and are
// normalized here the same way as a fresh measurement.
export function sameBoot(a, b) {
  const left = normalizeBootId(a), right = normalizeBootId(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (!WINDOWS_TICKS.test(left) || !WINDOWS_TICKS.test(right)) return false;
  const difference = BigInt(left) - BigInt(right);
  return (difference < 0n ? -difference : difference) <= TOLERANCE_TICKS;
}

export function measureBootId() {
  if (process.platform === 'linux') return normalizeBootId(fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8'));
  if (process.platform === 'win32') {
    return normalizeBootId(execFileSync('pwsh', ['-NoProfile', '-Command', `$ErrorActionPreference="Stop"; ${WINDOWS_BOOT_TICKS_EXPRESSION}`], { encoding: 'utf8', timeout: 15000 }));
  }
  return undefined;
}
