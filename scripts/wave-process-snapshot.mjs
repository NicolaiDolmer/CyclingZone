import { execFileSync } from 'node:child_process';
import { WINDOWS_BOOT_TICKS_EXPRESSION, normalizeBootId } from './wave-boot-identity.mjs';

export function processSnapshot() {
  if (process.platform !== 'win32') throw Error('Automatic recovery requires the Windows process snapshot; unsupported platform retains the marker');
  const observed = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-Command',
    `$ErrorActionPreference="Stop"; @{ bootId=${WINDOWS_BOOT_TICKS_EXPRESSION}; processes=@(Get-CimInstance Win32_Process | Select-Object @{n="pid";e={[int]$_.ProcessId}}, @{n="ppid";e={[int]$_.ParentProcessId}}, @{n="name";e={$_.Name}}, @{n="commandLine";e={$_.CommandLine}}, @{n="createdAt";e={$_.CreationDate.ToUniversalTime().ToString("o")}}) } | ConvertTo-Json -Compress`], { encoding: 'utf8', timeout: 15000 }));
  // Same normalization as hostBootId() (#5533): raw ticks drift within one boot.
  observed.bootId = normalizeBootId(observed.bootId);
  if (!Array.isArray(observed.processes) || !observed.processes.length || !observed.bootId) throw Error('Process snapshot unavailable');
  return observed;
}
