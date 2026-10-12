// Publish aggregate evidence without private database identifiers/fingerprints.
// Full evidence stays in ignored transient storage for restoration and validation.
import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
const publicDir='docs/snapshots/6490';
const privateDir='.codex.local/6490-evidence-full';
mkdirSync(privateDir,{recursive:true});
const privateKey=/hash|sha256|lsn|xid|provenance|^target$|stagingRef|^schema$/i;
function redact(value){
 if(Array.isArray(value))return value.map(redact);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
  .filter(([key])=>!privateKey.test(key)||/Match|Restored/i.test(key)).map(([key,v])=>[key,redact(v)]));
 if(typeof value==='string')return value.replace(/\b[a-f0-9]{32,64}\b/g,'<private fingerprint>')
  .replace(/\b(?:pywxpnynzmbukdvoiazp|ghwvkxzhsbbltzfnuhhz)\b/g,'<database identifier>');
 return value;
}
for(const name of readdirSync(publicDir).filter(n=>n.endsWith('.json'))){
 const raw=readFileSync(`${publicDir}/${name}`,'utf8'),data=JSON.parse(raw);
 if(data._publicEvidenceRedacted)continue;
 writeFileSync(`${privateDir}/${name}`,raw);
 const safe=redact(data);
 const output=Array.isArray(safe)?{_publicEvidenceRedacted:true,checks:safe}:{...safe,_publicEvidenceRedacted:true};
 writeFileSync(`${publicDir}/${name}`,JSON.stringify(output,null,2)+'\n');
}
const readme=readFileSync(`${publicDir}/README.md`,'utf8');
writeFileSync(`${publicDir}/README.md`,redact(readme));
console.log('Public measurement evidence redacted; full verification evidence retained privately.');
