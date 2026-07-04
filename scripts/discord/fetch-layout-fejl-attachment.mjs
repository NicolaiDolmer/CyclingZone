#!/usr/bin/env node
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

const TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) { console.error('NO_TOKEN'); process.exit(3); }
const THREAD = '1522320752584425532';
const OUTDIR = path.join('docs', 'discord-attachments');

function getJSON(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
function downloadFile(url, dest, depth = 0) {
  if (depth > 5) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return downloadFile(res.headers.location, dest, depth + 1).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error(`status ${res.statusCode}`));
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve()));
    }).on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });
  const headers = { Authorization: `Bot ${TOKEN}`, 'User-Agent': 'CyclingZone-Discord-Sync/1.0' };
  const msgs = await getJSON(`https://discord.com/api/v10/channels/${THREAD}/messages?limit=20`, headers);
  for (const msg of msgs) {
    for (const att of (msg.attachments || [])) {
      const ext = path.extname(att.filename || '.png') || '.png';
      const safeFn = `${THREAD}-${att.id}${ext}`;
      const dest = path.join(OUTDIR, safeFn);
      await downloadFile(att.url, dest);
      console.log(`OK ${safeFn}`);
    }
  }
}
main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
