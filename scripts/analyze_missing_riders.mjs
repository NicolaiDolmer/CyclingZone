// Riders that exist in CZ but are NOT in the new world-db (dropped/retired in PCM).
// Focus: game impact (owned + high value) + possible errors (UCI-ranked but missing).
import { readFileSync } from "fs";
const WORLDDB_URL = "https://docs.google.com/spreadsheets/d/1ZwhFqtoXk_4wcImvC9yWvTk3zGlqr4ofT83xzxgsCz8/export?format=csv&gid=0";
const UCI_URL     = "https://docs.google.com/spreadsheets/d/1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic/export?format=csv&gid=0";
function loadEnv(p){const o={};for(const l of readFileSync(p,"utf8").split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim().replace(/^["']|["']$/g,"");}return o;}
const env=loadEnv("C:\\Dev\\CyclingZone\\backend\\.env");const SUPABASE_URL=env.SUPABASE_URL,KEY=env.SUPABASE_SERVICE_KEY;
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===","&&!q){out.push(cur);cur="";}else cur+=c;}out.push(cur);return out;}
function parseCsv(t){const rows=[];let cur="",q=false;for(const c of t){if(c==='"')q=!q;if(c==="\n"&&!q){rows.push(cur);cur="";}else cur+=c;}if(cur.trim())rows.push(cur);return rows.filter(r=>r.trim()).map(parseLine);}
function norm(s){return (s||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/Ł/g,"L").replace(/Ø/g,"O").replace(/Æ/g,"AE").replace(/ß/g,"SS").replace(/Đ/g,"D").replace(/[^A-Z ]/g," ").replace(/\s+/g," ").trim();}
const tok=(f,l)=>norm(l+" "+f).split(" ").sort().join(" ");
async function fetchCsv(u){const r=await fetch(u,{redirect:"follow"});if(!r.ok)throw new Error(u+" -> "+r.status);return parseCsv(await r.text());}

const wdb=await fetchCsv(WORLDDB_URL);
const wh=wdb[0],cId=wh.indexOf("IDcyclist");
const sheetPcm=new Set(wdb.slice(1).map(r=>parseInt(r[cId])).filter(Number.isInteger));

const uci=await fetchCsv(UCI_URL);
const uName=uci[0].indexOf("Name");
const uciNames=new Set(uci.slice(1).map(r=>{const n=norm(r[uName]);return n.split(" ").sort().join(" ");}).filter(Boolean));

// team id -> name map
const tRes=await fetch(`${SUPABASE_URL}/rest/v1/teams?select=id,name`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}});
const teamMap=new Map((await tRes.json()).map(t=>[t.id,t.name]));

// fetch DB riders
const rows=[];let from=0;const PAGE=1000;
while(true){
  const res=await fetch(`${SUPABASE_URL}/rest/v1/riders?select=pcm_id,firstname,lastname,uci_points,market_value,birthdate,team_id&order=pcm_id`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,Range:`${from}-${from+PAGE-1}`}});
  const d=await res.json();
  if(!Array.isArray(d)){console.error("FETCH ERROR:",JSON.stringify(d));break;}
  if(!d.length)break;
  for(const r of d)r.teams=r.team_id?{name:teamMap.get(r.team_id)}:null;
  rows.push(...d);if(d.length<PAGE)break;from+=PAGE;
}
console.log("DB rows fetched:",rows.length);

const nullPcm=rows.filter(r=>r.pcm_id==null);
const missing=rows.filter(r=>r.pcm_id!=null&&!sheetPcm.has(r.pcm_id));
const owned=missing.filter(r=>r.team_id);
const inUci=missing.filter(r=>uciNames.has(tok(r.firstname,r.lastname)));
const fmt=r=>`pcm ${r.pcm_id}  ${r.firstname} ${r.lastname}  uci=${r.uci_points} val=${r.market_value} ${r.teams?.name?("OWNED:"+r.teams.name):""}${uciNames.has(tok(r.firstname,r.lastname))?" [in UCI sheet]":""}`;

console.log("===== MISSING-FROM-WORLDDB SUMMARY =====");
console.log("CZ riders (pcm_id not in new world-db):",missing.length);
console.log("  - OWNED by a player team:",owned.length);
console.log("  - name still in UCI ranking sheet (=> likely active, POSSIBLE ERROR):",inUci.length);
console.log("riders with NO pcm_id (fictional/generated, separate):",nullPcm.length);

console.log("\n--- OWNED missing riders (game impact: stats won't auto-update) ---");
owned.sort((a,b)=>b.market_value-a.market_value).forEach(r=>console.log(fmt(r)));

console.log("\n--- POSSIBLE ERRORS: missing but still in UCI ranking (top 40 by value) ---");
inUci.sort((a,b)=>b.market_value-a.market_value).slice(0,40).forEach(r=>console.log(fmt(r)));

console.log("\n--- highest-value missing overall (top 25) ---");
missing.sort((a,b)=>b.market_value-a.market_value).slice(0,25).forEach(r=>console.log(fmt(r)));

const birthYear=r=>r.birthdate?+String(r.birthdate).slice(0,4):null;
const ages=missing.map(birthYear).filter(Boolean);
console.log("\n--- age profile of missing (birth year) ---");
console.log("  born <=1990:",ages.filter(y=>y<=1990).length,"| 1991-1999:",ages.filter(y=>y>=1991&&y<=1999).length,"| 2000+:",ages.filter(y=>y>=2000).length,"| no birthdate:",missing.length-ages.length);
