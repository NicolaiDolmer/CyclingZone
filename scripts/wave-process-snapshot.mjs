import { WINDOWS_BOOT_TICKS_EXPRESSION, normalizeBootId, windowsEvidenceProbe } from './wave-boot-identity.mjs';

export function processSnapshot({ platform = process.platform, probe, wait } = {}) {
  if (platform !== 'win32') throw Error('Automatic recovery requires the Windows process snapshot; unsupported platform retains the marker');
  const text = windowsEvidenceProbe(
    `$ErrorActionPreference="Stop"; @{ bootId=${WINDOWS_BOOT_TICKS_EXPRESSION}; processes=@(Get-CimInstance Win32_Process | Select-Object @{n="pid";e={[int]$_.ProcessId}}, @{n="ppid";e={[int]$_.ParentProcessId}}, @{n="name";e={$_.Name}}, @{n="commandLine";e={$_.CommandLine}}, @{n="createdAt";e={$_.CreationDate.ToUniversalTime().ToString("o")}}) } | ConvertTo-Json -Compress`, { probe, wait, code: 'WAVE_PROCESS_SNAPSHOT_UNAVAILABLE' });
  // Escape literal controls only inside strings. Track escapes so quotes and
  // backslashes remain intact; never strip fields needed to identify a process.
  let repaired = '', inString = false, escaped = false;
  for (const char of text) {
    if (inString && char.charCodeAt(0) < 32) {
      // A control after a backslash is malformed syntax, not a literal value.
      if (escaped) throw Error('Process snapshot unavailable: invalid JSON; marker retained');
      repaired += `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
      continue;
    }
    repaired += char;
    if (escaped) escaped = false;
    else if (inString && char === '\\') escaped = true;
    else if (char === '"') inString = !inString;
  }
  let observed;
  try { observed = JSON.parse(repaired); }
  catch { throw Error('Process snapshot unavailable: invalid JSON; marker retained'); }
  if (!observed || typeof observed !== 'object') throw Error('Process snapshot unavailable');
  // Same normalization as hostBootId() (#5533): raw ticks drift within one boot.
  observed.bootId = normalizeBootId(observed.bootId);
  if (!Array.isArray(observed.processes) || !observed.processes.length || !observed.bootId || observed.processes.some(row =>
    !row || !Number.isSafeInteger(row.pid) || row.pid < 0 || !Number.isSafeInteger(row.ppid) || row.ppid < 0
    || typeof row.name !== 'string' || !row.name || !(row.commandLine === null || typeof row.commandLine === 'string')
    || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)))) throw Error('Process snapshot unavailable');
  return observed;
}
