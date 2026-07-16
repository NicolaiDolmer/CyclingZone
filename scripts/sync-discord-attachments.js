#!/usr/bin/env node
/**
 * Sync Discord attachments — download images from active threads to docs/discord-attachments/
 *
 * Usage: node scripts/sync-discord-attachments.js
 *
 * Reads bot token from DISCORD_TOKEN/DISCORD_BOT_TOKEN env. Outputs _mapping.json with thread -> [images] mapping
 * for use when generating GitHub issues with embedded image references.
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) {
  console.error('NO_TOKEN: set DISCORD_TOKEN via Infisical or parent process environment.');
  process.exit(3);
}
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
  // Batch 3 (2026-05-07 evening)
  '1502023507628785907', // jeppek Annullere lejeaftale uden modparts accept
  '1502022740511690955', // jeppek Byttehandel/leje pa andres ryttere
  '1502022537310371871', // jeppek Ingen modbyd efter modbyd
  '1502021814224949419', // jeppek Kan ikke trykke pa rytter (team/transfers)
  '1502019650131726356', // jeppek Muligt at leje i over 1 saeson
  '1502018453358248127', // jeppek Undefined holdnavn i transferhistorik
  '1502023057454141710', // cybersimon Byttehandel/leje under rytterside
  '1500209380413407343', // .sredna Forbedring til budsystemet (proxy-bidding follow-up)
  // Batch 5 (2026-05-07 sen aften — proxy-bidding regression cluster)
  '1502029191233802371', // cybersimon Kan ikke byde pris rytter er sat til salg for (10%-rule)
  '1502029625986125905', // jeppek Ulæste beskeder fjernes ikke i indbakken
  '1502042565988450384', // bobby2106 Autobud på managerejet rytter — fejl uden besked
  '1502043822841135116', // cybersimon Autobud overholder ikke afrundingsregl
  // Batch 6 (2026-05-30 triage — feedback 2026-05-16 → 2026-05-30)
  '1510269165255135263', // bobby2106 Rangliste: endagsløb vises som samlet sejr
  '1510268058420383824', // bobby2106 Dashboard: sæson-fremskridt opdateres ikke
  '1510266246116151436', // .sredna/bobby Løbsresultat-historik per rytter virker ikke
  '1510263255757754660', // soren1207 Ejer-filter: fri-agenter under Manager-ejede
  '1507078529282605106', // .sredna AI-ryttere ikke frie agenter ved filter
  '1510242164226134236', // jeppek Hall of Fame — kan kun se sig selv
  '1507075204008906822', // jeppek Flash-auktion på egne ryttere
  '1507072644862972057', // jeppek Garanteret salg under deadline day
  '1506780095275204608', // .sredna Transferliste med mange actions
  '1506222527591088198', // .sredna Forvirrende historik (uafsluttet auktion)
  '1506046994051891210', // .sredna Rytter solgt til AI står stadig til salg
  '1505613603217084487', // cybersimon Sprog-dropdown kan ikke scrolles
  // Batch 2026-07-16 (sweep 16/7 — ny server)
  '1527005576163229828', // cybersimon Asking price search in transferlist (forum-tråd)
  '1505478569969582182', // #dansk-snak (kanal) — smukkethomsen/knud/thelamba screenshots 16/7
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
