import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TOOLS, handleMessage, createDiscordClient, callTool } from './mcp-readonly-server.mjs';

const FAKE_TOKEN = 'fake.token-value-that-must-never-appear-in-output';
const CHANNEL = '1504952590486474805';

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    const path = url.replace('https://discord.com/api/v10', '');
    const route = routes[path];
    const next = Array.isArray(route) ? route.shift() : route;
    if (!next) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ message: 'Unknown' }) };
    const status = next.status ?? 200;
    return { ok: status >= 200 && status < 300, status, statusText: '', json: async () => next.body };
  };
  return { impl, calls };
}

const client = (routes, env = { DISCORD_TOKEN: FAKE_TOKEN }) => {
  const f = fakeFetch(routes);
  return { dapi: createDiscordClient({ env, fetchImpl: f.impl, sleepImpl: async () => {} }), calls: f.calls };
};
const outputText = (result) => result.content.map((c) => c.text).join('\n');

test('initialize svarer straks, echoer protokolversion og annoncerer tools', async () => {
  const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, null);
  assert.equal(res.result.protocolVersion, '2025-11-25');
  assert.deepEqual(res.result.capabilities, { tools: {} });
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, null), null);
});

test('tools/list er read-only: kun de 5 laese-tools, ingen skrive-tools', async () => {
  const res = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, null);
  const names = res.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['discord_get_forum_channels', 'discord_get_forum_post', 'discord_get_server_info', 'discord_login', 'discord_read_messages']);
  assert.equal(TOOLS.length, 5);
  for (const n of names) assert.doesNotMatch(n, /send|delete|create|edit|add|remove|webhook|reply/);
});

test('ukendt skrive-tool afvises', async () => {
  const { dapi, calls } = client({});
  const res = await callTool('discord_send', { channelId: CHANNEL, message: 'x' }, dapi);
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test('read_messages: aeldste foerst, klampet limit, Bot-auth-header', async () => {
  const { dapi, calls } = client({
    [`/channels/${CHANNEL}`]: { body: { id: CHANNEL, type: 0 } },
    [`/channels/${CHANNEL}/messages?limit=100`]: {
      body: [
        { id: '2', content: 'nyest', author: { id: 'a', username: 'u2' }, timestamp: '2026-09-24T10:00:00.000Z', attachments: [{}], embeds: [] },
        { id: '1', content: 'aeldst', author: { id: 'b', username: 'u1', bot: true }, timestamp: '2026-09-24T09:00:00.000Z', message_reference: { message_id: '0' } },
      ],
    },
  });
  const res = await callTool('discord_read_messages', { channelId: CHANNEL, limit: 500 }, dapi);
  assert.equal(res.isError, undefined);
  const body = JSON.parse(outputText(res));
  assert.equal(body.messageCount, 2);
  assert.deepEqual(body.messages.map((m) => m.id), ['1', '2']);
  assert.equal(body.messages[0].author.bot, true);
  assert.equal(body.messages[0].replyTo, '0');
  assert.equal(body.messages[1].attachments, 1);
  assert.ok(calls.every((c) => c.auth === `Bot ${FAKE_TOKEN}`));
});

test('read_messages paa forum-kanal giver fejl med henvisning til forum_post', async () => {
  const { dapi } = client({ [`/channels/${CHANNEL}`]: { body: { id: CHANNEL, type: 15 } } });
  const res = await callTool('discord_read_messages', { channelId: CHANNEL }, dapi);
  assert.equal(res.isError, true);
  assert.match(outputText(res), /discord_get_forum_post/);
});

test('manglende token: fejl uden netvaerkskald', async () => {
  const { dapi, calls } = client({}, {});
  const res = await callTool('discord_read_messages', { channelId: CHANNEL }, dapi);
  assert.equal(res.isError, true);
  assert.match(outputText(res), /DISCORD_TOKEN is not set/);
  assert.equal(calls.length, 0);
});

test('401 giver tydelig fejl, og token-vaerdien laekker aldrig', async () => {
  const { dapi } = client({ [`/channels/${CHANNEL}`]: { status: 401, body: { message: '401: Unauthorized' } } });
  const res = await callTool('discord_read_messages', { channelId: CHANNEL }, dapi);
  assert.equal(res.isError, true);
  assert.match(outputText(res), /invalid or rotated/);
  assert.doesNotMatch(JSON.stringify(res), /fake\.token/);
});

test('429 respekteres og proeves igen', async () => {
  const { dapi, calls } = client({
    '/users/@me': [{ status: 429, body: { retry_after: 0.01 } }, { body: { id: '9', username: 'Cycling Zone' } }],
  });
  const res = await callTool('discord_login', {}, dapi);
  assert.match(outputText(res), /Discord REST OK as Cycling Zone/);
  assert.equal(calls.length, 2);
});

test('ugyldigt ID og token-argument afvises uden netvaerkskald', async () => {
  const { dapi, calls } = client({});
  assert.equal((await callTool('discord_read_messages', { channelId: '../users/@me' }, dapi)).isError, true);
  assert.equal((await callTool('discord_login', { token: 'x' }, dapi)).isError, true);
  assert.equal(calls.length, 0);
});

test('get_server_info grupperer kanaler og udleder oprettelsesdato fra ID', async () => {
  const guild = '1504615050831466669';
  const { dapi } = client({
    [`/guilds/${guild}?with_counts=true`]: { body: { id: guild, name: 'Cycling Zone', icon: 'abc', owner_id: '1', approximate_member_count: 70, features: [], premium_tier: 0 } },
    [`/guilds/${guild}/channels`]: { body: [{ id: '10', name: 'general', type: 0, position: 0 }, { id: '11', name: 'bugs', type: 15, parent_id: '12', position: 3, topic: 't' }] },
  });
  const body = JSON.parse(outputText(await callTool('discord_get_server_info', { guildId: guild }, dapi)));
  assert.equal(body.memberCount, 70);
  assert.equal(body.channels.count.total, 2);
  assert.equal(body.channels.details.forum[0].categoryId, '12');
  assert.equal(body.createdAt, '2026-05-14T22:43:02.514Z');
});

test('stdio-handshake virker uden token og uden netvaerk (ingen gateway-login)', async () => {
  const env = { ...process.env };
  delete env.DISCORD_TOKEN;
  delete env.DISCORD_BOT_TOKEN;
  const child = spawn(process.execPath, [fileURLToPath(new URL('./mcp-readonly-server.mjs', import.meta.url))], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const responses = [];
  let buf = '';
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('handshake timeout')), 10000);
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        responses.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
        if (responses.length === 2) { clearTimeout(timer); resolve(); }
      }
    });
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  try {
    await done;
  } finally {
    child.stdin.end();
  }
  assert.equal(responses[0].result.serverInfo.name, 'cz-discord-readonly');
  assert.equal(responses[1].result.tools.length, 5);
});
