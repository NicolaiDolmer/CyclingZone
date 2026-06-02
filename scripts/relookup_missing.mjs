// For the 19 "active but missing" riders: search the world-db BROADLY by name
// (surname match, token-subset, swapped order) to see if they exist under a
// different pcm_id / spelling. Also flag if a match is one we JUST inserted (=duplicate).
import { readFileSync } from "fs";
const WORLDDB_URL="https://docs.google.com/spreadsheets/d/1ZwhFqtoXk_4wcImvC9yWvTk3zGlqr4ofT83xzxgsCz8/export?format=csv&gid=0";
const UCI_URL="https://docs.google.com/spreadsheets/d/1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic/export?format=csv&gid=0";
function loadEnv(p){const o={};for(const l of readFileSync(p,"utf8").split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim().replace(/^["']|["']$/g,"");}return o;}
const env=loadEnv("C:\\Dev\\CyclingZone\\backend\\.env");const SUPABASE_URL=env.SUPABASE_URL,KEY=env.SUPABASE_SERVICE_KEY;
function parseLine(line){const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===","&&!q){out.push(cur);cur="";}else cur+=c;}out.push(cur);return out;}
function parseCsv(t){const rows=[];let cur="",q=false;for(const c of t){if(c==='"')q=!q;if(c==="\n"&&!q){rows.push(cur);cur="";}else cur+=c;}if(cur.trim())rows.push(cur);return rows.filter(r=>r.trim()).map(parseLine);}
function norm(s){return (s||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/Ł/g,"L").replace(/Ø/g,"O").replace(/Æ/g,"AE").replace(/ß/g,"SS").replace(/Đ/g,"D").replace(/[^A-Z ]/g," ").replace(/\s+/g," ").trim();}
const tset=(f,l)=>new Set(norm(l+" "+f).split(" ").filter(Boolean));
const tkey=(f,l)=>[...tset(f,l)].sort().join(" ");
async function fetchCsv(u){const r=await fetch(u,{redirect:"follow"});if(!r.ok)throw new Error(u+" -> "+r.status);return parseCsv(await r.text());}
const sub=(a,b)=>[...a].every(x=>b.has(x)); // a subset of b
const shared=(a,b)=>[...a].filter(x=>b.has(x)).length;

const wdb=await fetchCsv(WORLDDB_URL);
const wh=wdb[0],cId=wh.indexOf("IDcyclist"),cLast=wh.indexOf("gene_sz_lastname"),cFirst=wh.indexOf("gene_sz_firstname"),cBirth=wh.indexOf("gene_i_birthdate");
const wrows=wdb.slice(1).map(r=>({pcm:parseInt(r[cId]),first:(r[cFirst]||"").trim(),last:(r[cLast]||"").trim(),birth:(r[cBirth]||"").trim()})).filter(r=>Number.isInteger(r.pcm));
for(const r of wrows){r.set=tset(r.first,r.last);r.surn=norm(r.last);}
const sheetPcm=new Set(wrows.map(r=>r.pcm));

const uci=await fetchCsv(UCI_URL);const uName=uci[0].indexOf("Name");
const uciNames=new Set(uci.slice(1).map(r=>{const n=norm(r[uName]);return n.split(" ").sort().join(" ");}).filter(Boolean));

// CZ riders
const rows=[];let from=0;const PAGE=1000;
while(true){const res=await fetch(`${SUPABASE_URL}/rest/v1/riders?select=pcm_id,firstname,lastname,uci_points,market_value,created_at`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,Range:`${from}-${from+PAGE-1}`}});const d=await res.json();if(!Array.isArray(d)){console.error(d);break;}if(!d.length)break;rows.push(...d);if(d.length<PAGE)break;from+=PAGE;}
const czPcm=new Map(rows.filter(r=>r.pcm_id!=null).map(r=>[r.pcm_id,r]));
const insertedToday=new Set(rows.filter(r=>r.created_at>"2026-06-02").map(r=>r.pcm_id));

const missingActive=rows.filter(r=>r.pcm_id!=null&&!sheetPcm.has(r.pcm_id)&&uciNames.has(tkey(r.firstname,r.lastname)))
  .sort((a,b)=>b.market_value-a.market_value);

const statusOf=p=>insertedToday.has(p)?"⚠️ JUST-INSERTED (DUPLICATE!)":(czPcm.has(p)?`existing CZ rider (${czPcm.get(p).firstname} ${czPcm.get(p).lastname})`:"in world-db, not CZ");

console.log(`Broad name-search for ${missingActive.length} active-but-missing riders:\n`);
for(const r of missingActive){
  const want=tset(r.firstname,r.lastname);const surn=norm(r.lastname);
  const cands=wrows.map(w=>{
    let type=null;
    if(tkey(w.first,w.last)===tkey(r.firstname,r.lastname))type="EXACT";
    else if(want.size&&w.set.size&&(sub(want,w.set)||sub(w.set,want))&&shared(want,w.set)>=2)type="SUBSET";
    else if(surn&&w.surn===surn)type="SURNAME";
    return type?{w,type}:null;
  }).filter(Boolean).sort((a,b)=>({EXACT:0,SUBSET:1,SURNAME:2}[a.type]-{EXACT:0,SUBSET:1,SURNAME:2}[b.type]));
  console.log(`MISSING pcm ${r.pcm_id}  ${r.firstname} ${r.lastname}  (uci=${r.uci_points}, val=${r.market_value})`);
  if(!cands.length){console.log("   no world-db name match (genuinely absent)\n");continue;}
  for(const c of cands.slice(0,4))console.log(`   ↳ wdb pcm ${c.w.pcm}  ${c.w.first} ${c.w.last}  [${c.type}]  -> ${statusOf(c.w.pcm)}`);
  console.log("");
}
