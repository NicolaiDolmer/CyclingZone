#!/usr/bin/env node
/**
 * Sync Discord attachments — download images from active threads to docs/discord-attachments/
 *
 * Usage: node scripts/sync-discord-attachments.js
 *
 * Reads bot token from .mcp.json. Outputs _mapping.json with thread → [images] mapping
 * for use when generating GitHub issues with embedded image references.
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

const TOKEN = JSON.parse(fs.readFileSync('.mcp.json', 'utf8')).mcpServers.discord.env.DISCORD_TOKEN;
const OUTDIR = path.join('docs', 'discord-attachments');
const REPO_RAW_BASE = 'https://raw.githubusercontent.com/NicolaiDolmer/CyclingZone/main/docs/discord-attachments';

// Threads with attachments (verified from earlier reads)
const THREADS = [
  '1495102203990642708', // bobby Fejl med speaks
  '1496263138364883017', // bobby Salg af rytter under min
  '1496576763860484196', // bobby Burde ikke kunne forhandles
  '1496621137130422432', // bobby Fejl ved password reset
  '1500511461003366402', // cybersimon Garanteret salg
  '1500960022270836867', // cybersimon Bestyrelsen minus
  '1501315801133879337', // cybersimon Forhandling virker ikke
  '1501336583679381604', // jeppek Ryttere uden potentiale
  '1501342366869618899', // jeppek Fejl i lon
  '1501342816721309819', // jeppek Fejlvisning auktioner
  '1501342989232898108', // jeppek Fejl i vagt+hojde
  '1501343527894913185', // jeppek Mange auktioner ved klik
  '1501344466437410968', // jeppek Fejl ved auktioner
  '1501346323503386634', // jeppek U23 viser U25
  '1501350653287469086', // jeppek Patch Notes sprog
  '1501353203915165766', // jeppek Lavere balance
  '1501355219047415949', // jeppek Mange sma lan
  '1501359883163930634', // jeppek Forskellig balance
  '1501363934760796282', // jeppek Sogning fornavn
  '1501358396329164850', // jeppek Balance auktionstabben
  '1501473256417267722', // .sredna Galdsloft falsk-positiv (Tier 4 — for context)
  '1500927555731984567', // cybersimon Rytter table (Tier 4)
];

function getJSON(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 300)}`));
        }
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error(`Parse error: ${body.substring(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest, depth = 0) {
  if (depth > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, dest, depth + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode} for ${url.substring(0, 100)}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', err => { try { fs.unlinkSync(dest); } catch(e) {} reject(err); });
    }).on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

  const headers = {
    'Authorization': `Bot ${TOKEN}`,
    'User-Agent': 'CyclingZone-Discord-Sync/1.0 (Node)'
  };
  const mapping = {};
  let totalDownloaded = 0;

  for (const threadId of THREADS) {
    const apiUrl = `https://discord.com/api/v10/channels/${threadId}/messages?limit=20`;
    let messages;
    try {
      messages = await getJSON(apiUrl, headers);
    } catch(e) {
      console.error(`[${threadId}] API: ${e.message}`);
      continue;
    }
    if (!Array.isArray(messages)) {
      console.error(`[${threadId}] non-array response`);
      continue;
    }

    const attachments = [];
    // oldest first for natural reading order
    for (const msg of messages.slice().reverse()) {
      if (!msg.attachments || msg.attachments.length === 0) continue;
      for (const att of msg.attachments) {
        const ext = path.extname(att.filename || '.png') || '.png';
        const safeFn = `${threadId}-${att.id}${ext}`;
        const dest = path.join(OUTDIR, safeFn);
        if (fs.existsSync(dest)) {
          attachments.push({
            filename: safeFn,
            githubUrl: `${REPO_RAW_BASE}/${safeFn}`,
            messageId: msg.id,
            messageContent: msg.content || '',
            author: msg.author.username,
            timestamp: msg.timestamp,
            cached: true,
          });
          continue;
        }
        try {
          await downloadFile(att.url, dest);
          attachments.push({
            filename: safeFn,
            githubUrl: `${REPO_RAW_BASE}/${safeFn}`,
            messageId: msg.id,
            messageContent: msg.content || '',
            author: msg.author.username,
            timestamp: msg.timestamp,
            cached: false,
          });
          totalDownloaded++;
          console.log(`+ ${safeFn}`);
        } catch(e) {
          console.error(`! ${safeFn}: ${e.message}`);
        }
      }
    }
    if (attachments.length > 0) mapping[threadId] = attachments;
  }

  fs.writeFileSync(
    path.join(OUTDIR, '_mapping.json'),
    JSON.stringify(mapping, null, 2)
  );
  console.log(`\nDone. ${Object.keys(mapping).length} threads, ${totalDownloaded} new downloads, ${Object.values(mapping).flat().length} total attachments mapped.`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
