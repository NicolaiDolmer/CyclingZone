# One short-lived unnamed Windows Job Object; only its supervisor owns the job handle.
param([Parameter(Mandatory)][string]$SpecPath)
$ErrorActionPreference = 'Stop'
try {
  if (-not $IsWindows -or [IntPtr]::Size -ne 8) { throw 'Unsupported containment platform' }
  $document = [Text.Json.JsonDocument]::Parse([IO.File]::ReadAllText($SpecPath))
  $spec = $document.RootElement
  $application = (Get-Command -Name $spec.GetProperty('file').GetString() -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $arguments = @($spec.GetProperty('arguments').EnumerateArray() | ForEach-Object { $_.GetString() })
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Globalization;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class CzWaveJobHost {
  public static string Operation = "initialize";
  public static int NativeError = 0;
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved,desktop,title;
    public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
    public ushort show,reservedBytes; public IntPtr reservedPointer,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup start; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long processTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking;
    public uint processLimit; public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long a,b,c,d; public uint faults,total,active,terminated;
  }
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,IntPtr info,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting info,uint size,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcessW(string file,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupEx startup,out ProcessInfo process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr sourceProcess,IntPtr source,IntPtr targetProcess,out IntPtr target,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr GetStdHandle(int number);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool ok,string operation) {
    if(ok)return; Operation=operation; NativeError=Marshal.GetLastWin32Error(); throw new Win32Exception(NativeError);
  }
  static string Quote(string value) {
    if(value.Length>0 && value.IndexOfAny(new char[]{' ','\t','\n','\v','"'})<0)return value;
    var result=new StringBuilder("\""); int slashes=0;
    foreach(char c in value) {
      if(c=='\\'){slashes++;continue;}
      if(c=='"')result.Append('\\',slashes*2+1).Append(c);
      else result.Append('\\',slashes).Append(c);
      slashes=0;
    }
    return result.Append('\\',slashes*2).Append('"').ToString();
  }
  static uint Active(IntPtr job) {
    Accounting info; Check(QueryInformationJobObject(job,1,out info,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero),"query-job"); return info.active;
  }
  public static int Run(string application,string[] arguments,string cwd,uint ownerPid,string ownerCreated,string stopFile) {
    IntPtr job=IntPtr.Zero,owner=IntPtr.Zero,attributes=IntPtr.Zero,jobValue=IntPtr.Zero,handleValues=IntPtr.Zero,limits=IntPtr.Zero;
    IntPtr[] streams=new IntPtr[3]; var child=new ProcessInfo(); bool attributeReady=false;
    try {
      owner=OpenProcess(0x00101000,false,ownerPid); Check(owner!=IntPtr.Zero,"open-owner");
      long actual,exited,kernel,user; Check(GetProcessTimes(owner,out actual,out exited,out kernel,out user),"owner-identity");
      Operation="owner-identity";
      long expected=DateTime.Parse(ownerCreated,CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind).ToUniversalTime().ToFileTimeUtc();
      // CIM records creation at microsecond precision; this is identity tolerance, not a timeout.
      if(Math.Abs(actual-expected)>9 || WaitForSingleObject(owner,0)==0)throw new InvalidOperationException("Owner identity unavailable");
      job=CreateJobObjectW(IntPtr.Zero,null); Check(job!=IntPtr.Zero,"create-job");
      var info=new ExtendedLimits(); info.basic.flags=0x2000; // KILL_ON_JOB_CLOSE, no breakaway.
      limits=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(ExtendedLimits))); Marshal.StructureToPtr(info,limits,false);
      Check(SetInformationJobObject(job,9,limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits))),"job-limits");
      IntPtr bytes=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref bytes); Check(bytes!=IntPtr.Zero,"attribute-size");
      attributes=Marshal.AllocHGlobal(bytes); Check(InitializeProcThreadAttributeList(attributes,2,0,ref bytes),"attribute-list"); attributeReady=true;
      jobValue=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobValue,job);
      Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x0002000d),jobValue,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"job-attribute");
      handleValues=Marshal.AllocHGlobal(3*IntPtr.Size);
      for(int i=0;i<3;i++) {
        Check(DuplicateHandle(GetCurrentProcess(),GetStdHandle(-10-i),GetCurrentProcess(),out streams[i],0,true,2),"standard-handle");
        Marshal.WriteIntPtr(handleValues,i*IntPtr.Size,streams[i]);
      }
      Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x00020002),handleValues,new IntPtr(3*IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"handle-attribute");
      var startup=new StartupEx(); startup.start.cb=Marshal.SizeOf(typeof(StartupEx)); startup.attributes=attributes;
      startup.start.flags=0x100; startup.start.input=streams[0]; startup.start.output=streams[1]; startup.start.error=streams[2];
      var line=new StringBuilder(Quote(application)); foreach(string argument in arguments)line.Append(' ').Append(Quote(argument));
      // JOB_LIST attaches before initial execution, including failure/crash windows.
      Check(CreateProcessW(application,line,IntPtr.Zero,IntPtr.Zero,true,0x08080004,IntPtr.Zero,cwd,ref startup,out child),"create-process");
      bool member; Check(IsProcessInJob(child.process,job,out member)&&member,"verify-membership");
      bool stopping=WaitForSingleObject(owner,0)==0||File.Exists(stopFile); uint exitCode=1;
      if(stopping)Check(TerminateJobObject(job,1),"stop-before-resume");
      else Check(ResumeThread(child.thread)!=0xffffffff,"resume-child");
      while(true) {
        uint childWait=WaitForSingleObject(child.process,50),ownerWait=WaitForSingleObject(owner,0);
        Check(childWait!=0xffffffff&&ownerWait!=0xffffffff,"wait-process");
        if(!stopping&&(childWait==0||ownerWait==0||File.Exists(stopFile))) {
          Check(TerminateJobObject(job,1),"stop-job"); stopping=true;
        }
        if(Active(job)==0) {
          Check(WaitForSingleObject(child.process,5000)==0,"wait-stopped-child");
          Check(GetExitCodeProcess(child.process,out exitCode),"child-exit-code"); return unchecked((int)exitCode);
        }
        Thread.Sleep(10);
      }
    } finally {
      if(job!=IntPtr.Zero)CloseHandle(job);
      if(child.thread!=IntPtr.Zero)CloseHandle(child.thread);
      if(child.process!=IntPtr.Zero)CloseHandle(child.process);
      if(owner!=IntPtr.Zero)CloseHandle(owner);
      foreach(var handle in streams)if(handle!=IntPtr.Zero)CloseHandle(handle);
      if(attributeReady)DeleteProcThreadAttributeList(attributes);
      if(attributes!=IntPtr.Zero)Marshal.FreeHGlobal(attributes);
      if(jobValue!=IntPtr.Zero)Marshal.FreeHGlobal(jobValue);
      if(handleValues!=IntPtr.Zero)Marshal.FreeHGlobal(handleValues);
      if(limits!=IntPtr.Zero)Marshal.FreeHGlobal(limits);
    }
  }
}
'@
  $code = [CzWaveJobHost]::Run($application,[string[]]$arguments,$spec.GetProperty('cwd').GetString(),$spec.GetProperty('ownerPid').GetUInt32(),$spec.GetProperty('ownerCreatedAt').GetString(),$spec.GetProperty('stopFile').GetString())
  $proofFile = $spec.GetProperty('proofFile').GetString()
  $proof = @{version=1;containment='windows-job-v1';activeProcesses=0;token=$spec.GetProperty('token').GetString();waveId=$spec.GetProperty('waveId').GetString();childKey=$spec.GetProperty('childKey').GetString();supervisorPid=$PID}
  $temporary = $proofFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  $stream = [IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($proof|ConvertTo-Json -Compress));$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
  [IO.File]::Move($temporary,$proofFile,$true)
  exit $code
} catch {
  $native = 'CzWaveJobHost' -as [type]
  if($native){[Console]::Error.WriteLine('WAVE_JOB_CONTAINMENT_UNPROVEN operation='+$native::Operation+' code='+$native::NativeError)}
  else{[Console]::Error.WriteLine('WAVE_JOB_CONTAINMENT_UNPROVEN initialization')}
  exit 125
} finally {
  if ($document) { $document.Dispose() }
}

