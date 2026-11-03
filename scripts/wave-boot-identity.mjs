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
// first negative drift. Truncating to whole seconds keeps a +-0.5 s margin;
// comparisons additionally accept a small tolerance. A real restart moves the
// boot time by at least the previous boot's uptime (minutes or more). A large
// clock correction can still move it further, so the value is never alone
// proof of a restart, and the state lock is keyed on the kernel's start time.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TICKS_PER_SECOND = 10_000_000n;
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

// A clock-derived id (Windows ticks) can move with a large clock correction,
// so a mismatch alone never proves a restart; callers need independent proof.
export function isClockDerivedBootId(value) {
  return WINDOWS_TICKS.test(normalizeBootId(value) ?? '');
}

// Lock key for one boot. The kernel process's creation time is recorded once
// and never adjusted by clock corrections, so processes measuring on either
// side of a correction still share one lock. Falls back to the normalized id.
export function bootLockKey(bootId, kernelStart) {
  if (typeof kernelStart === 'string' && /^\d+$/.test(kernelStart.trim())) return `kernel:${kernelStart.trim()}`;
  return normalizeBootId(bootId);
}

const WINDOWS_BOOT_PROBE = '$ErrorActionPreference="Stop"; $kernel = Get-CimInstance Win32_Process -Filter "ProcessId = 4"; '
  + `@{ bootId=${WINDOWS_BOOT_TICKS_EXPRESSION}; kernelStart=$(if ($kernel -and $kernel.CreationDate) { $kernel.CreationDate.ToUniversalTime().Ticks.ToString() } else { "" }) } | ConvertTo-Json -Compress`;

// Mark only CIM exceptions, so syntax and programming errors are never retried.
const CIM_CATCH = ' catch [Microsoft.Management.Infrastructure.CimException] { [Console]::Error.WriteLine("WAVE_CIM_TRANSIENT"); exit 74 }';
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function windowsEvidenceProbe(script, { probe = command => execFileSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }), wait = sleep, code = 'WAVE_BOOT_IDENTITY_UNAVAILABLE' } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return probe(`try { ${script} }${CIM_CATCH}`);
    } catch (error) {
      if (error?.status !== 74 || String(error.stderr).trim() !== 'WAVE_CIM_TRANSIENT') throw error;
      if (attempt === 3) throw Object.assign(new Error(`${code}: Windows CIM probe failed after 3 attempts; wave state retained`), { code });
      wait(attempt * 250);
    }
  }
}

export function measureBootIdentity({ platform = process.platform, probe, wait } = {}) {
  if (platform === 'linux') {
    const bootId = normalizeBootId(fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8'));
    return { bootId, lockKey: bootId };
  }
  if (platform === 'win32') {
    const text = windowsEvidenceProbe(WINDOWS_BOOT_PROBE, { probe, wait });
    let raw;
    try { raw = JSON.parse(text); }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw Object.assign(new Error('WAVE_BOOT_IDENTITY_UNAVAILABLE: invalid Windows boot evidence; wave state retained'), { code: 'WAVE_BOOT_IDENTITY_UNAVAILABLE' });
    }
    if (!raw || typeof raw !== 'object' || !normalizeBootId(raw.bootId)) throw Object.assign(new Error('WAVE_BOOT_IDENTITY_UNAVAILABLE: missing Windows boot evidence; wave state retained'), { code: 'WAVE_BOOT_IDENTITY_UNAVAILABLE' });
    const bootId = normalizeBootId(raw.bootId);
    return { bootId, lockKey: bootId && bootLockKey(bootId, raw.kernelStart) };
  }
  return { bootId: undefined, lockKey: undefined };
}

export function measureBootId() {
  return measureBootIdentity().bootId;
}
