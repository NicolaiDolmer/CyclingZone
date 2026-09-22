import { execFileSync } from 'node:child_process';

export function processSnapshot() {
  if (process.platform !== 'win32') throw Error('Automatic recovery requires the Windows process snapshot; unsupported platform retains the marker');
  const observed = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-Command',
    '$ErrorActionPreference="Stop"; @{ bootId=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks.ToString(); processes=@(Get-CimInstance Win32_Process | Select-Object @{n="pid";e={[int]$_.ProcessId}}, @{n="ppid";e={[int]$_.ParentProcessId}}, @{n="name";e={$_.Name}}, @{n="commandLine";e={$_.CommandLine}}, @{n="createdAt";e={$_.CreationDate.ToUniversalTime().ToString("o")}}) } | ConvertTo-Json -Compress'], { encoding: 'utf8', timeout: 15000 }));
  if (!Array.isArray(observed.processes) || !observed.processes.length || !observed.bootId) throw Error('Process snapshot unavailable');
  return observed;
}

