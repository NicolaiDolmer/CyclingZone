// Owner-approved exception for #7313 only, renewed 28 Oct until 29 Oct 2026 23:00 Copenhagen.
// The normal review-gate and all other PRs keep their existing policy.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { evaluateGate, fetchPrData, DEFAULT_REPO } from '../review-gate.mjs';

export const CODE_RABBIT_NIGHT_PRS = Object.freeze([7313]);
export const CODE_RABBIT_NIGHT_END = Date.parse('2026-10-29T22:00:00Z');

export function evaluateCodeRabbitNight({ data, checkRuns = [], rabbitReviews = [], now, repo }) {
  const fail = detail => ({ ok: false, secondReviewer: 'CodeRabbit', headSha: data?.headSha, detail });
  if (repo !== DEFAULT_REPO || !CODE_RABBIT_NIGHT_PRS.includes(data?.number)) return fail('uden for ejerens PR');
  if (!Number.isFinite(now) || now >= CODE_RABBIT_NIGHT_END) return fail('mandatet er udloebet eller tid mangler');
  if (!/^[0-9a-f]{40}$/.test(data.headSha || '')) return fail('ugyldigt HEAD');
  const receipt = `<!-- coderabbit-substitute-renewed-20261028: pr=${data.number} sha=${data.headSha} -->`;
  if (!(data.comments || []).some(c => c.author === 'NicolaiDolmer' && c.association === 'OWNER' && String(c.body || '').includes(receipt))) return fail('ejerbeslutning mangler paa HEAD');
  const native = evaluateGate(data);
  if (!native.codex?.ok || data.draft) return fail('Codex-review/draft-gate er ikke groen');
  if (checkRuns.length !== 1) return fail('manglende eller tvetydigt CodeRabbit-check');
  const check = checkRuns[0];
  if (check.name !== 'CodeRabbit' || check.app?.slug !== 'coderabbitai' || check.head_sha !== data.headSha || check.status !== 'completed' || check.conclusion !== 'success' || !/^Result: Success - Review completed(?:\r?\n|$)/.test(check.output?.summary || '')) return fail('CodeRabbit-check er ikke completed/success paa HEAD');
  const reviews = rabbitReviews.filter(r => r.user?.login === 'coderabbitai[bot]' && r.user?.type === 'Bot' && r.commit_id === data.headSha && (String(r.body || '').trim() || r.state !== 'COMMENTED'))
    .sort((a,b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')) || Number(b.id || 0) - Number(a.id || 0));
  const review = reviews[0];
  const summaries = (data.comments || []).filter(c => c.author === 'coderabbitai[bot]' && c.authorType === 'Bot').map(c => {
    const normalizedBody = String(c.body || '').replace(/^[ \t]*(?:>[ \t]*)*/gm, '');
    const heads = [...new Set([...normalizedBody.matchAll(/^(?:Reviewing files that changed from the base of the PR and between [a-f0-9]{40} and |- Last reviewed commit: )([a-f0-9]{40})\.?[ \t]*$/gm)].map(m => m[1]))];
    return { ...c, normalizedBody, heads };
  });
  if (summaries.some(c => c.heads.includes(data.headSha) && c.heads.length !== 1)) return fail('tvetydig CodeRabbit-summary HEAD');
  const summaryReceipts = summaries.filter(c => c.heads.length === 1 && c.heads[0] === data.headSha);
  if (summaryReceipts.some(c => /\b(?:Critical|Major)\b|outside[ -]diff|off[ -]diff/i.test(c.body))) return fail('CodeRabbit-summary har blokerende eller uklassificerede fund');
  const zeroReceipt = summaryReceipts.find(c => {
    const at = Date.parse(c.at || '');
    const start = Date.parse(check.started_at || '');
    const end = Date.parse(check.completed_at || '');
    return /^No actionable comments were generated in the recent review\.\s*$/m.test(c.normalizedBody) && Number.isFinite(at) && Number.isFinite(start) && Number.isFinite(end) && end >= start && at >= start && at <= end + 60000;
  });
  if (!review && !zeroReceipt) return fail('manglende CodeRabbit-review paa HEAD');
  const rabbitThreads = (data.threads || []).filter(t => String(t.author || '').replace(/\[bot\]$/, '') === 'coderabbitai');
// Require the official completion check and an actual review or SHA/time-bound zero-issue summary.
  for (const receiptReview of reviews) {
    if (!['COMMENTED','APPROVED'].includes(receiptReview.state)) return fail('CodeRabbit-review er ikke afsluttet');
    const count = String(receiptReview.body || '').match(/\*\*Actionable comments (?:posted|generated):\s*(\d+)\*\*/i);
    if (/\b(?:Critical|Major)\b|outside[ -]diff|off[ -]diff/i.test(receiptReview.body || '')) return fail('CodeRabbit-body har blokerende eller uklassificerede fund');
    if (!count || rabbitThreads.filter(t => t.commit === data.headSha && t.reviewId === receiptReview.id).length !== Number(count[1])) return fail('CodeRabbit-review har ukendt eller ufuldstaendig issue-dom');
  }
  if (rabbitThreads.some(t => t.commit === data.headSha && !reviews.some(r => Number.isSafeInteger(r.id) && r.id === t.reviewId))) return fail('CodeRabbit-traad mangler review-kvittering');
  const open = rabbitThreads.filter(t => !t.isResolved);
  if (open.some(t => !['P2','P3'].includes(t.rabbitSeverity))) return fail('uloest blokerende/ukendt CodeRabbit-traad');
  const notes = open.length;
  return { ok: true, secondReviewer: 'CodeRabbit', expiresAt: CODE_RABBIT_NIGHT_END, notes, headSha: data.headSha, codex: native.codex, nativeClaude: native.claude, reviewId: review?.id ?? null, zeroReceipt: Boolean(zeroReceipt), checkId: check.id ?? null, detail: 'Ejerens afgraensede CodeRabbit-erstatning er verificeret paa HEAD' };
}

function apiRows(path, jq) {
  const text = execFileSync('gh', ['api', '--paginate', path, '--jq', jq], { encoding:'utf8', maxBuffer:64*1024*1024 }).trim();
  return text ? text.split(/\r?\n/).map(line => JSON.parse(line)) : [];
}
export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 4 || argv[0] !== '--pr' || argv[2] !== '--head') throw new Error('Kun --pr N --head SHA understottes');
  const pr = Number(argv[1]);
  const head = argv[3];
  if (!CODE_RABBIT_NIGHT_PRS.includes(pr) || !/^[0-9a-f]{40}$/.test(head)) throw new Error('Kun #7313 med fuldt HEAD');
  const data = fetchPrData(DEFAULT_REPO, pr);
  if (data.headSha !== head) { console.log(JSON.stringify({ok:false,headSha:data.headSha,detail:'HEAD skiftede'})); return 1; }
  const checkRuns = apiRows(`repos/${DEFAULT_REPO}/commits/${head}/check-runs?check_name=CodeRabbit&per_page=100`, '.check_runs[] | tojson');
  const rabbitReviews = apiRows(`repos/${DEFAULT_REPO}/pulls/${pr}/reviews?per_page=100`, '.[] | tojson');
  const result = evaluateCodeRabbitNight({data,checkRuns,rabbitReviews,repo:DEFAULT_REPO,now:Date.now()});
  console.log(JSON.stringify(result));
  return result.ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode=1; }
}
