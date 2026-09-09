# Transport only: resolve Git Bash, forward raw stdin/stdout/stderr and exit code.
# No tool-name conversion and no patch parser. Shared scripts own all policy.
[CmdletBinding()]
param([Parameter(Mandatory, Position=0)][string]$HookScript)
$ErrorActionPreference = 'Stop'
try {
  $candidates = [Collections.Generic.List[string]]::new()
  if ($IsWindows) {
    $git = Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $execPathOutput = & $git.Source --exec-path 2>$null
    $execPath = $execPathOutput | Select-Object -First 1
    # Native exit status inside a pipeline was null in login Git Bash. Validate
    # the returned directory itself; a guessed install root must not select WSL.
    if ($execPath -and [IO.Path]::IsPathFullyQualified($execPath) -and (Test-Path -LiteralPath $execPath -PathType Container)) {
      $gitRoot = [IO.Path]::GetFullPath((Join-Path $execPath '../../..'))
      $candidates.Add((Join-Path $gitRoot 'bin/bash.exe'))
      $candidates.Add((Join-Path $gitRoot 'usr/bin/bash.exe'))
    }
    $commandRoot = Split-Path (Split-Path $git.Source -Parent) -Parent
    $candidates.Add((Join-Path $commandRoot 'bin/bash.exe'))
    # Git Bash's login PATH often selects Git/mingw64/bin/git.exe instead of cmd/git.exe.
    $candidates.Add((Join-Path (Split-Path $commandRoot -Parent) 'bin/bash.exe'))
  } else {
    $candidates.Add((Get-Command bash -CommandType Application -ErrorAction Stop).Source)
  }
  $bashPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (-not $bashPath) { throw 'Git Bash could not be resolved from this PC''s Git installation. Install Git for Windows and restart Codex.' }
  $scriptPath = [IO.Path]::GetFullPath($HookScript, (Get-Location).ProviderPath)
  if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) { throw "Hook script missing: $HookScript" }
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $bashPath
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.ArgumentList.Add('--noprofile')
  $start.ArgumentList.Add('--norc')
  $start.ArgumentList.Add($scriptPath.Replace('\', '/'))
  if ($IsWindows) {
    $runtimeRoot = Split-Path (Split-Path $bashPath -Parent) -Parent
    if ((Split-Path $runtimeRoot -Leaf) -eq 'usr') { $runtimeRoot = Split-Path $runtimeRoot -Parent }
    $start.Environment['PATH'] = (Join-Path $runtimeRoot 'bin') + ';' + (Join-Path $runtimeRoot 'usr/bin') + ';' + $env:PATH
  }
  $process = [Diagnostics.Process]::Start($start)
  $stdout = $process.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
  $stderr = $process.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
  [Console]::OpenStandardInput().CopyTo($process.StandardInput.BaseStream)
  $process.StandardInput.Close()
  $process.WaitForExit()
  [void]$stdout.GetAwaiter().GetResult()
  [void]$stderr.GetAwaiter().GetResult()
  exit $process.ExitCode
} catch {
  [Console]::Error.WriteLine("CODEX HOOK STARTUP FAILED: $($_.Exception.Message)")
  exit 2
}
