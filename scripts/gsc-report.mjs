#!/usr/bin/env node
// Privat Search Console-rapport (#3797/#1407). Credentials kommer kun fra env.
// --weekly: rullende 7 dage, 3 dages forsinkelse; --out: privat Markdown/JSON.
// Setup og ugentlig drift: docs/runbooks/GSC_SERVICE_ACCOUNT.md.
import process from 'node:process';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const RUNBOOK = 'docs/runbooks/GSC_SERVICE_ACCOUNT.md';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API_BASE = 'https://searchconsole.googleapis.com/webmasters/v3/sites';
const TIMEZONE = 'America/Los_Angeles';
const LAG_DAYS = 3;
const fail = (message, exitCode = 1) => Object.assign(new Error(message), {exitCode});
const isoDate = date => date.toISOString().slice(0, 10);

export function parseOptions(argv) {
  const args = {};
  for (const arg of argv) {
    const match = /^--(weekly|json|days|site|out|now)(?:=(.*))?$/.exec(arg);
    if (!match || Object.hasOwn(args, match[1])) throw fail('Ukendt eller gentaget argument.');
    const [, key, value] = match;
    if (['weekly','json'].includes(key) ? value !== undefined : !value) throw fail('Ugyldig argumentværdi.');
    args[key] = value ?? true;
  }
  if (args.weekly && args.days) throw fail('Brug enten --weekly eller --days.');
  if (args.days && !/^\d+$/.test(args.days)) throw fail('--days skal være et helt tal.');
  const days = Number(args.days ?? (args.weekly ? 7 : 28));
  if (days < 1 || days > 240) throw fail('--days skal være mellem 1 og 240, så begge perioder ligger inden for GSC-historikken.');
  if (args.now && (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(args.now) || !Number.isFinite(new Date(args.now).getTime()))) throw fail('--now skal være et ISO-tidspunkt med tidszone.');
  return {...args, days};
}

export function periodRange(days, now, lagDays = LAG_DAYS) {
  if (!Number.isInteger(days) || days < 1 || days > 240 || !(now instanceof Date) || !Number.isFinite(now.getTime()) || !Number.isInteger(lagDays) || lagDays < 0) throw fail('Perioden kræver antal dage og et eksplicit gyldigt tidspunkt.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
  const end = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate()-lagDays);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate()-(days-1));
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate()-1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate()-(days-1));
  return {current:{start:isoDate(start),end:isoDate(end)},previous:{start:isoDate(prevStart),end:isoDate(prevEnd)}};
}

function readServiceAccount(raw) {
  if (!raw?.trim()) throw fail(`GSC_SERVICE_ACCOUNT_JSON mangler. Kør gennem Infisical; se ${RUNBOOK}.`,2);
  let sa;
  try { sa=JSON.parse(raw); } catch { throw fail(`GSC_SERVICE_ACCOUNT_JSON er ugyldig JSON. Se ${RUNBOOK}.`,2); }
  if (!sa || sa.type!=='service_account' || typeof sa.client_email!=='string' || typeof sa.private_key!=='string') throw fail(`Ugyldig servicekonto. Se ${RUNBOOK}.`,2);
  return sa;
}

async function requestJson(fetchImpl, url, options, label) {
  let res;
  try { res=await fetchImpl(url,{...options,signal:AbortSignal.timeout(30000)}); }
  catch { throw fail(`${label}: netværksfejl eller timeout.`,3); }
  if (!res.ok) throw fail(`${label}: HTTP ${res.status}. Kontrollér API, servicekonto og ejendommens læseadgang; se ${RUNBOOK}.`,3);
  try { return await res.json(); } catch { throw fail(`${label}: ugyldigt JSON-svar.`,3); }
}

async function getAccessToken(sa, now, fetchImpl) {
  if (sa.token_uri && sa.token_uri!==TOKEN_URL) throw fail('Servicekontoens token-endpoint er ikke Googles forventede endpoint.',2);
  const epoch=Math.floor(now.getTime()/1000);
  const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const claim=Buffer.from(JSON.stringify({iss:sa.client_email,scope:SCOPE,aud:TOKEN_URL,iat:epoch,exp:epoch+3600})).toString('base64url');
  const input=`${header}.${claim}`;
  let signature;
  try { signature=crypto.sign('RSA-SHA256',Buffer.from(input),sa.private_key).toString('base64url'); }
  catch { throw fail(`JWT kunne ikke signeres. Se ${RUNBOOK}.`,2); }
  const body=await requestJson(fetchImpl,TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${input}.${signature}`})},'Google-token');
  if (typeof body?.access_token!=='string' || !body.access_token) throw fail('Google-token: svaret mangler adgangstoken.',3);
  return body.access_token;
}

export async function collectReport({site,days,now,authNow=now,serviceAccount,fetchImpl=fetch}) {
  const period=periodRange(days,now);
  const token=await getAccessToken(serviceAccount,authNow,fetchImpl);
  const q=async (range,dimensions,rowLimit) => {
    const json=await requestJson(fetchImpl,`${API_BASE}/${encodeURIComponent(site)}/searchAnalytics/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({startDate:range.start,endDate:range.end,dimensions,rowLimit,type:'web',dataState:'final',aggregationType:dimensions.includes('page')?'byPage':'byProperty'})},'Search Console');
    if (!json || typeof json!=='object' || (json.rows!==undefined && !Array.isArray(json.rows))) throw fail('Search Console: uventet svarformat.',3);
    return json.rows ?? [];
  };
  const [current,previous,queries,pages,countries,devices,dates]=await Promise.all([
    q(period.current,[],1),q(period.previous,[],1),q(period.current,['query'],25),q(period.current,['page'],10),q(period.current,['country'],10),q(period.current,['device'],10),q(period.current,['date'],25000)
  ]);
  return {site,days,generatedAt:authNow.toISOString(),asOf:now.toISOString(),timezone:TIMEZONE,lagDays:LAG_DAYS,searchType:'web',dataState:'final',period,totals:{current:current[0]??null,previous:previous[0]??null},queries,pages,countries,devices,dates,coverage:{totals:'property; no query dimension',queries:'top 25, anonymised queries omitted',pages:'top 10, by page',countries:'top 10',devices:'top 10',indexing:'not measured by Search Analytics; use Pages / URL Inspection'}};
}

function cell(value) { return String(value).replace(/[\\`*_\[\]<>|]/g,'\\$&').replace(/[\r\n]/g,' '); }
function format(metric,value) {
  if (value===null || value===undefined) return 'Ingen data';
  return metric==='ctr'?`${(value*100).toFixed(1)}%`:metric==='position'?value.toFixed(1):String(value);
}
function change(metric,current,previous) {
  if (current==null || previous==null) return 'Ingen sammenligning';
  if (metric==='ctr') return `${((current-previous)*100).toFixed(1)} procentpoint`;
  if (metric==='position') return `${(current-previous).toFixed(1)} (lavere er bedre)`;
  if (!previous) return current?'Ny aktivitet fra nul':'0';
  const delta=(current-previous)/previous*100;
  return `${delta>=0?'+':''}${delta.toFixed(1)}%`;
}
export function renderReport(report) {
  const {period,totals}=report;
  const lines=['# Privat SEO-rapport', '',`Ejendom: ${cell(report.site)}`,`Periode: ${period.current.start} til ${period.current.end} (${report.days} dage).`,`Forrige periode: ${period.previous.start} til ${period.previous.end}.`,`Datodøgn: ${TIMEZONE}. Websøgning, endelige data, ${LAG_DAYS} dages forsinkelse.`,`Hentet: ${report.generatedAt}`, '', '| Måling | Denne periode | Forrige | Ændring |','| --- | ---: | ---: | --- |'];
  for (const [metric,label] of [['clicks','Klik'],['impressions','Visninger'],['ctr','CTR'],['position','Gennemsnitsposition']]) lines.push(`| ${label} | ${format(metric,totals.current?.[metric])} | ${format(metric,totals.previous?.[metric])} | ${change(metric,totals.current?.[metric],totals.previous?.[metric])} |`);
  lines.push('', 'Totalerne hentes separat for hele ejendommen. Toplisterne er udsnit og må ikke summeres til totaler. Google udelader anonymiserede søgeord; en tom liste betyder ingen tilgængelige data, ikke nul brugere.');
  for (const [key,title] of [['queries','Top 25 søgeord'],['pages','Top 10 sider'],['countries','Top 10 lande'],['devices','Enheder'],['dates','Daglig udvikling']]) {
    lines.push('',`## ${title}`,'');
    if (!report[key].length) { lines.push('Ingen data.'); continue; }
    lines.push('| Navn | Klik | Visninger | CTR | Position |','| --- | ---: | ---: | ---: | ---: |');
    for (const row of report[key]) lines.push(`| ${cell(row.keys?.[0]??'')} | ${format('clicks',row.clicks)} | ${format('impressions',row.impressions)} | ${format('ctr',row.ctr)} | ${format('position',row.position)} |`);
  }
  lines.push('', 'Indekseringsstatus og canonical er ikke målt af denne rapport. Kontrollér Search Console → Sider og URL Inspection. GSC-klik er ikke besøg, konti eller en signup-konverteringsrate.','');
  return lines.join('\n');
}

export async function writeReport(file,content) {
  const target=path.resolve(file);
  let ancestor=path.dirname(target);
  for (;;) {
    try { ancestor=await fs.realpath(ancestor); break; }
    catch (err) { if (err.code!=='ENOENT') throw err; const parent=path.dirname(ancestor); if(parent===ancestor) throw err; ancestor=parent; }
  }
  // Afvis enhver Git-rod, også via symlink/junction. balance-internals opløses
  // til privat OneDrive uden for Git; en fil direkte i repoet afvises.
  for (let dir=ancestor;;dir=path.dirname(dir)) {
    try { await fs.lstat(path.join(dir,'.git')); throw fail('--out skal ligge privat uden for Git-checkouts.'); }
    catch (err) { if (err.code!=='ENOENT') throw err; }
    if (path.dirname(dir)===dir) break;
  }
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(target,content,{encoding:'utf8',mode:0o600,flag:'wx'});
}

async function main() {
  const options=parseOptions(process.argv.slice(2));
  // Væguret læses kun ved CLI-grænsen. Alle domænefunktioner får now eksplicit.
  const authNow=new Date();
  const now=options.now?new Date(options.now):authNow;
  const serviceAccount=readServiceAccount(process.env.GSC_SERVICE_ACCOUNT_JSON);
  const report=await collectReport({site:options.site||process.env.GSC_SITE_URL||'sc-domain:cyclingzone.org',days:options.days,now,authNow,serviceAccount});
  const content=options.json?JSON.stringify(report,null,2)+'\n':renderReport(report);
  if (options.out) { await writeReport(options.out,content); console.log('Privat SEO-rapport gemt.'); }
  else console.log(content);
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(err=>{ console.error(err.exitCode?err.message:'Rapporten kunne ikke skrives eller indlæses. Ingen følsomme fejldetaljer vises.'); process.exitCode=err.exitCode||3; });
}
