import { checkCommand } from './scripts/unsafe-delete-guard.mjs';
const none = {readScript:()=>null,isTracked:()=>false,cwd:'C:/dev/CyclingZone-worktrees/keep'};
for (const cmd of ['rm -rf ..','Remove-Item -Recurse ..','git worktree remove x','pwsh -NoProfile -File clean.ps1','bash clean.sh','node clean.mjs']) {
  const options = {...none, readScript:()=> 'git worktree remove --force C:/dev/CyclingZone-worktrees/x'};
  console.log(JSON.stringify({cmd,blocked:checkCommand(cmd,options).blocked}));
}
for (const cmd of ['rm -rf ../..','node clean.mjs']) {
 console.log(JSON.stringify({cmd,body:'fs.rmSync("../victim", {recursive:true})',blocked:checkCommand(cmd,{...none,readScript:()=> 'fs.rmSync("../victim", {recursive:true})'}).blocked}));
}
import {spawnSync} from 'node:child_process';
for (const command of ['remove-item -recurse -force C:/Users/x/OneDrive/CyclingZone-context/private-recovery','Remove-Item -Recurse -Force C:/Users/x/OneDrive/CyclingZone-context/private-recovery']) {
 const p=spawnSync('C:/Program Files/Git/bin/bash.exe',['scripts/hooks/block-unsafe-delete.sh'],{input:JSON.stringify({tool_name:'PowerShell',cwd:'C:/dev/CyclingZone-worktrees/keep',tool_input:{command}}),encoding:'utf8'});
 console.log(JSON.stringify({command,hookExit:p.status,stderr:p.stderr}));
}
