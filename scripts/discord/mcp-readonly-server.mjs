#!/usr/bin/env node
/**
 * READ-ONLY Discord MCP-server (stdio) for Claude Code (#5484).
 *
 * Erstatter `npx -y mcp-discord`, som gav CONNECT_TIMEOUT ved sessionstart:
 * den ventede paa en Discord gateway-login FOER MCP-handshaket, og Discord
 * tillader kun én gateway-IDENTIFY pr. 5. sekund pr. bot (max_concurrency=1).
 * Starter flere sessioner samtidig, staar de i koe (5, 10, 15 ... 31 s) og
 * rammer Claude Codes 30 s-timeout.
 *
 * Denne server bruger kun Discord REST (ingen gateway, ingen afhaengigheder),
 * svarer paa handshaket med det samme og kan ikke skrive til Discord: der
 * findes ingen send/delete/create-tools (docs/SOCIAL_RULES.md).
 *
 * Tool-navnene matcher mcp-discord, saa `mcp__discord__discord_read_messages`
 * m.fl. virker uaendret, naar serveren hedder "discord" i .mcp.json.
 *
 * Token: DISCORD_TOKEN (eller DISCORD_BOT_TOKEN) fra parent-processens env,
 * laest ved hvert kald. Printes aldrig. Installeres af scripts/setup-discord-mcp.ps1.
 */
import { pathToFileURL } from 'node:url';

export const SERVER_INFO = { name: 'cz-discord-readonly', version: '1.0.0' };
const API = 'https://discord.com/api/v10';
const DEFAULT_PROTOCOL = '2025-06-18';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_429_RETRIES = 3;

const CHANNEL_TYPES = {
  0: 'GuildText', 2: 'GuildVoice', 4: 'GuildCategory', 5: 'GuildAnnouncement',
  10: 'AnnouncementThread', 11: 'PublicThread', 12: 'PrivateThread',
  13: 'GuildStageVoice', 15: 'GuildForum', 16: 'GuildMedia',
};
const THREAD_TYPES = new Set([10, 11, 12]);
const SNOWFLAKE = /^\d{15,22}$/;

const idArg = (name) => ({ type: 'object', properties: { [name]: { type: 'string' } }, required: [name] });

export const TOOLS = [
  {
    name: 'discord_read_messages',
    description: 'READ-ONLY. Retrieves messages from a Discord text channel or thread (oldest first).',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'discord_get_server_info',
    description: 'READ-ONLY. Retrieves Discord server (guild) info including channels and member count.',
    inputSchema: idArg('guildId'),
  },
  {
    name: 'discord_get_forum_channels',
    description: 'READ-ONLY. Lists forum channels in a Discord server.',
    inputSchema: idArg('guildId'),
  },
  {
    name: 'discord_get_forum_post',
    description: 'READ-ONLY. Retrieves a forum post (thread) and its 10 newest messages.',
    inputSchema: idArg('threadId'),
  },
  {
    name: 'discord_login',
    description: 'READ-ONLY identity check: confirms which bot the configured DISCORD_TOKEN belongs to. Takes no token argument.',
    inputSchema: { type: 'object', properties: {} },
  },
];

export class DiscordApiError extends Error {
  constructor(status, path, message) {
    super(message);
    this.status = status;
    this.path = path;
  }
}

function readToken(env) {
  return env.DISCORD_TOKEN || env.DISCORD_BOT_TOKEN || null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function snowflakeToIso(id) {
  return new Date(Number((BigInt(id) >> 22n) + 1420070400000n)).toISOString();
}

export function createDiscordClient({ env = process.env, fetchImpl = globalThis.fetch, sleepImpl = sleep } = {}) {
  return async function dapi(path) {
    const token = readToken(env);
    if (!token) {
      throw new DiscordApiError(0, path, 'DISCORD_TOKEN is not set in the environment of the process that started this MCP server. Set it as a user env var (see docs/DISCORD_MCP_SETUP.md) and restart Claude Code.');
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${API}${path}`, {
        headers: { Authorization: `Bot ${token}`, 'User-Agent': `DiscordBot (cyclingzone.org, ${SERVER_INFO.version})` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        const body = await res.json().catch(() => ({}));
        await sleepImpl(Math.ceil((body.retry_after || 1) * 1000) + 250);
        continue;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const hint = res.status === 401 ? ' (DISCORD_TOKEN is invalid or rotated)' : '';
        throw new DiscordApiError(res.status, path, `Discord API ${res.status} on ${path}: ${body.message || res.statusText || 'error'}${hint}`);
      }
      return res.json();
    }
  };
}

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const toolError = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

function requireSnowflake(args, key) {
  const value = args?.[key];
  if (typeof value !== 'string' || !SNOWFLAKE.test(value)) {
    throw new DiscordApiError(0, '', `Invalid ${key}: expected a Discord ID (digits only).`);
  }
  return value;
}

function channelDetail(c) {
  return {
    id: c.id,
    name: c.name,
    type: CHANNEL_TYPES[c.type] ?? c.type,
    categoryId: c.parent_id ?? null,
    position: c.position,
    topic: c.topic ?? null,
  };
}

const handlers = {
  async discord_read_messages(args, dapi) {
    const channelId = requireSnowflake(args, 'channelId');
    const limit = Math.min(100, Math.max(1, Math.floor(Number(args?.limit ?? 50)) || 50));
    const channel = await dapi(`/channels/${channelId}`);
    if (channel.type === 15 || channel.type === 16) {
      return toolError('Channel type does not support reading messages (forum channel: use discord_get_forum_post with a thread ID).');
    }
    const messages = await dapi(`/channels/${channelId}/messages?limit=${limit}`);
    if (!messages.length) return text('No messages found in channel');
    const formatted = messages
      .map((m) => ({
        id: m.id,
        content: m.content,
        author: { id: m.author?.id, username: m.author?.username, bot: Boolean(m.author?.bot) },
        timestamp: m.timestamp,
        attachments: (m.attachments || []).length,
        embeds: (m.embeds || []).length,
        replyTo: m.message_reference?.message_id ?? null,
      }))
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return text({ channelId, messageCount: formatted.length, messages: formatted });
  },

  async discord_get_server_info(args, dapi) {
    const guildId = requireSnowflake(args, 'guildId');
    const [guild, channels] = await Promise.all([
      dapi(`/guilds/${guildId}?with_counts=true`),
      dapi(`/guilds/${guildId}/channels`),
    ]);
    const details = channels.map(channelDetail);
    const ofType = (name) => details.filter((c) => c.type === name);
    return text({
      id: guild.id,
      name: guild.name,
      description: guild.description ?? null,
      icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.webp` : null,
      owner: guild.owner_id,
      createdAt: snowflakeToIso(guild.id),
      memberCount: guild.approximate_member_count ?? 'unknown',
      channels: {
        count: {
          text: ofType('GuildText').length,
          voice: ofType('GuildVoice').length,
          category: ofType('GuildCategory').length,
          forum: ofType('GuildForum').length,
          announcement: ofType('GuildAnnouncement').length,
          stage: ofType('GuildStageVoice').length,
          total: details.length,
        },
        details: {
          text: ofType('GuildText'),
          voice: ofType('GuildVoice'),
          category: ofType('GuildCategory'),
          forum: ofType('GuildForum'),
          announcement: ofType('GuildAnnouncement'),
          stage: ofType('GuildStageVoice'),
        },
      },
      features: guild.features ?? [],
      premium: { tier: guild.premium_tier, subscriptions: guild.premium_subscription_count ?? 0 },
    });
  },

  async discord_get_forum_channels(args, dapi) {
    const guildId = requireSnowflake(args, 'guildId');
    const channels = await dapi(`/guilds/${guildId}/channels`);
    const forums = channels.filter((c) => c.type === 15);
    if (!forums.length) return text(`No forum channels found in guild: ${guildId}`);
    return text(forums.map((c) => ({ id: c.id, name: c.name, topic: c.topic || 'No topic set' })));
  },

  async discord_get_forum_post(args, dapi) {
    const threadId = requireSnowflake(args, 'threadId');
    const thread = await dapi(`/channels/${threadId}`);
    if (!THREAD_TYPES.has(thread.type)) return toolError(`Cannot find thread with ID: ${threadId}`);
    const messages = await dapi(`/channels/${threadId}/messages?limit=10`);
    return text({
      id: thread.id,
      name: thread.name,
      parentId: thread.parent_id ?? null,
      messageCount: messages.length,
      createdAt: thread.thread_metadata?.create_timestamp ?? snowflakeToIso(thread.id),
      messages: messages.map((m) => ({ id: m.id, content: m.content, author: m.author?.username, createdAt: m.timestamp })),
    });
  },

  async discord_login(args, dapi) {
    if (args && Object.prototype.hasOwnProperty.call(args, 'token')) {
      return toolError('This server never accepts a token argument. It reads DISCORD_TOKEN from the environment.');
    }
    const me = await dapi('/users/@me');
    return text(`Discord REST OK as ${me.username} (id ${me.id}). Read-only server: no gateway login needed.`);
  },
};

export async function callTool(name, args, dapi) {
  const handler = handlers[name];
  if (!handler) return toolError(`Unknown tool: ${name}. This server is read-only; writes to Discord are not available via MCP.`);
  try {
    return await handler(args ?? {}, dapi);
  } catch (err) {
    return toolError(err instanceof DiscordApiError ? err.message : `Discord request failed: ${err?.message || err}`);
  }
}

/** Handles one JSON-RPC message. Returns the response object, or null for notifications. */
export async function handleMessage(msg, dapi) {
  if (!msg || typeof msg !== 'object' || msg.id === undefined || msg.id === null) return null;
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: msg.params?.protocolVersion || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      return reply(await callTool(msg.params?.name, msg.params?.arguments, dapi));
    default:
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
  }
}

export function startStdioServer({ input = process.stdin, output = process.stdout, dapi = createDiscordClient() } = {}) {
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
        continue;
      }
      handleMessage(msg, dapi).then((response) => {
        if (response) output.write(JSON.stringify(response) + '\n');
      });
    }
  });
  input.on('end', () => process.exit(0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStdioServer();
}
