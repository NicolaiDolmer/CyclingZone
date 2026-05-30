#!/usr/bin/env node
/**
 * Cross-reference active Discord feedback threads against GitHub issues that
 * have already been filed, so we only create issues for NEW (un-triaged) feedback.
 *
 * Inputs (all read internally, nothing secret printed):
 *   - Discord REST: active threads in the guild (token from .mcp.json)
 *   - scripts/file-discord-issues-batch*.js  (thread IDs already batch-filed)
 *   - scripts/discord/.gh-issues.json        (all GH issues, for body link match)
 *
 * Output: scripts/discord/.candidates.md  (human-readable triage list)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GUILD = '474142653529849886';
const API = 'https://discord.com/api/v10';
const HERE = path.join(process.cwd(), 'scripts');
const DISCORD_DIR = path.join(HERE, 'discord');

function readToken() {
  const candidates = [
    path.join(process.cwd(), '.mcp.json'),
    path.join(os.homedir(), 'OneDrive', 'CyclingZone-context', 'secrets', 'mcp.json'),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const env = j?.mcpServers?.discord?.env || j || {};
      const t = env.DISCORD_TOKEN || env.DISCORD_BOT_TOKEN || j.DISCORD_TOKEN || j.DISCORD_BOT_TOKEN;
      if (t) return t;
    } catch {}
  }
  return null;
}

async function dapi(token, p) {
  const res = await fetch(`${API}${p}`, { headers: { Authorization: `Bot ${token}` } });
  if (!res.ok) throw new Error(`${res.status} on ${p}`);
  return res.json();
}

function snip(s, n = 240) {
  if (!s) return '';
  return s.replace(/\s+/g, ' ').trim().slice(0, n);
}

// ---- build the set of already-filed thread IDs ----
const filed = new Set();
const filedReason = new Map();

// 1) batch scripts
for (const f of fs.readdirSync(HERE)) {
  if (!/^file-discord-issues-batch.*\.js$/.test(f)) continue;
  const src = fs.readFileSync(path.join(HERE, f), 'utf8');
  for (const m of src.matchAll(/threadId:\s*'(\d+)'/g)) {
    filed.add(m[1]);
    filedReason.set(m[1], f);
  }
  for (const m of src.matchAll(/channels\/\d+\/(\d+)/g)) {
    filed.add(m[1]);
    if (!filedReason.has(m[1])) filedReason.set(m[1], f);
  }
}

// 2) GitHub issues (body links to discord threads)
const ghPath = path.join(DISCORD_DIR, '.gh-issues.json');
let ghIssues = [];
if (fs.existsSync(ghPath)) {
  try {
    ghIssues = JSON.parse(fs.readFileSync(ghPath, 'utf8'));
    for (const iss of ghIssues) {
      const body = iss.body || '';
      // (a) direct thread links: discord.com/channels/<guild>/<threadId>
      for (const m of body.matchAll(/channels\/\d+\/(\d+)/g)) {
        filed.add(m[1]);
        if (!filedReason.has(m[1])) filedReason.set(m[1], `#${iss.number} (${iss.state})`);
      }
      // (b) BLINDSPOT FIX (#batch7 dup-incident 2026-05-31): attachment links
      //     embedded as raw.githubusercontent/.../<threadId>-<attId>.<ext>.
      //     A thread referenced ONLY via its screenshot was missed by (a) and
      //     re-filed as a false-NEW candidate. Match the filename's leading
      //     snowflake (17-20 digits) so image-only references count as filed.
      for (const m of body.matchAll(/discord-attachments\/(\d{17,20})-\d+\.(?:png|jpe?g|webp|gif)/gi)) {
        filed.add(m[1]);
        if (!filedReason.has(m[1])) filedReason.set(m[1], `#${iss.number} (${iss.state}, via billede)`);
      }
    }
  } catch (e) {
    console.error('WARN: could not parse .gh-issues.json:', e.message);
  }
}

async function main() {
  const token = readToken();
  if (!token) { console.error('NO_TOKEN'); process.exit(3); }

  const channels = await dapi(token, `/guilds/${GUILD}/channels`);
  const chanName = new Map(channels.map((c) => [c.id, c.name]));

  const active = await dapi(token, `/guilds/${GUILD}/threads/active`);
  const threads = (active.threads || []).slice()
    .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));

  const newOnes = [];
  const already = [];

  for (const t of threads) {
    const rec = {
      id: t.id,
      name: t.name,
      parent: chanName.get(t.parent_id) || t.parent_id,
      count: t.message_count ?? '?',
    };
    try {
      const msgs = await dapi(token, `/channels/${t.id}/messages?after=0&limit=1`);
      if (msgs.length) {
        rec.opener = snip(msgs[0].content);
        rec.author = msgs[0].author?.username || '';
        rec.ts = (msgs[0].timestamp || '').slice(0, 10);
      }
    } catch (e) { rec.opener = `(read error: ${e.message})`; }

    if (filed.has(t.id)) { rec.filedAs = filedReason.get(t.id); already.push(rec); }
    else newOnes.push(rec);
  }

  let out = `# Discord feedback triage — candidate list\n\n`;
  out += `Active threads: ${threads.length} · already filed: ${already.length} · NEW candidates: ${newOnes.length}\n`;
  out += `GH issues scanned: ${ghIssues.length}\n\n`;
  out += `## NEW — not yet filed (${newOnes.length})\n\n`;
  for (const r of newOnes) {
    out += `- **${r.ts || '????'}** [${r.parent}] @${r.author || '?'} · msgs=${r.count}\n`;
    out += `  - ${r.name}\n`;
    if (r.opener) out += `  - _${r.opener}_\n`;
    out += `  - thread: ${r.id}\n`;
  }
  out += `\n## Already filed (${already.length}) — skip\n\n`;
  for (const r of already) {
    out += `- ${r.ts || '????'} ${r.name}  →  ${r.filedAs}\n`;
  }

  fs.mkdirSync(DISCORD_DIR, { recursive: true });
  fs.writeFileSync(path.join(DISCORD_DIR, '.candidates.md'), out);
  console.error(`DONE new=${newOnes.length} filed=${already.length}`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
