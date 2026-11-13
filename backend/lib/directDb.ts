// #8143 trin 1 · Serverens direkte linje til databasen, ved siden af web-adgangen.
//
// Design: docs/superpowers/specs/2026-11-13-8143-direkte-databaselinje-design.md.
// Ét lille modul med to indgange: `query` (stil ét spørgsmål) og `transaction`
// (kør en handel, alt eller intet). I trin 1 er den eneste bruger måleprøven i
// directDbProbe.ts; directDb.test.js har en vagt, der kun tillader de udpegede
// filer at importere modulet. Listen udvides bevidst, én tung vej ad gangen.
//
// SLUKKET SOM STANDARD: forbindelsen læses fra miljøvariablen DIRECT_DB_URL.
// Mangler den, er modulet slukket: ingen pulje, ingen forbindelse, ingen log.
// Hemmeligheden bor kun i Infisical og hos serverens udbyder (driftsvejledning
// i docs/AI_OPS_REFERENCE.md). Den skrives aldrig i repo, log eller fejltekst.
//
// Reglerne, der gør linjen sikker at have kørende ved siden af web-adgangen:
//  1. Pulje med loft og korte tidsgrænser (DIRECT_DB_LIMITS), så et kald aldrig
//     kan hænge i minutter, og så linjen aldrig tager pladser fra web-adgangen.
//  2. Krypteret forbindelse MED tjek af modpartens bevis. Der findes ingen
//     genvej, der slår tjekket fra; sslmode i adressen ignoreres med vilje.
//  3. Puljen og hver udlånt forbindelse har deres egen fejlmodtager: en tabt
//     forbindelse bliver til en talt fejl, aldrig et nedbrud af serveren.
//  4. Fejltekster renses for forbindelsesadresse, vært, bruger og adgangskode,
//     før de forlader modulet.
//  5. Kun indstillinger og låse, der gælder for én handel ad gangen (SET LOCAL,
//     set_config(..., true), pg_advisory_xact_lock). Session-indstillinger og
//     session-låse afvises i koden. Det er reglen fra dag ét, så fordelerens
//     anden tilstand (mange forbindelser deler få pladser) senere er en
//     indstilling og ikke en ombygning. Af samme grund bruges aldrig navngivne
//     forberedte spørgsmål.
//
// `pg` hentes først, når linjen faktisk bruges. Biblioteket har ingen egne
// typer, og serverens opstart må ikke afhænge af det, mens linjen er slukket.

export const DIRECT_DB_URL_ENV = "DIRECT_DB_URL";
/** Valgfri: databaseudbyderens offentlige rod-certifikat (PEM), hvis det ikke er i Nodes standardliste. */
export const DIRECT_DB_CA_ENV = "DIRECT_DB_CA_PEM";

/** Lofter og tidsgrænser fra designet (#8143, afsnit "Forbindelsen"). */
export const DIRECT_DB_LIMITS = Object.freeze({
  maxConnections: 8,
  minConnections: 0,
  idleCloseMs: 30_000,
  connectTimeoutMs: 3_000,
  statementTimeoutMs: 15_000,
  lockTimeoutMs: 3_000,
  idleInTransactionMs: 10_000,
  shutdownTimeoutMs: 5_000,
});

const APPLICATION_NAME = "cz-backend-direct";
const REDACTED = "[skjult]";

export type DirectDbErrorKind =
  | "off"
  | "config"
  | "driver-missing"
  | "pool-timeout"
  | "timeout"
  | "lock-timeout"
  | "connection"
  | "auth"
  | "tls"
  | "session-scope"
  | "query";

export class DirectDbError extends Error {
  kind: DirectDbErrorKind;
  sqlState: string | null;
  constructor(kind: DirectDbErrorKind, message: string, sqlState: string | null = null) {
    super(message);
    this.name = "DirectDbError";
    this.kind = kind;
    this.sqlState = sqlState;
  }
}

export interface DirectDbQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

export interface DirectDbTiming {
  /** Tid til at få en forbindelse fra puljen (inkl. åbning, hvis den var ny). */
  acquireMs: number;
  /** Tid for selve spørgsmålet på en åben forbindelse. */
  queryMs: number;
  /** Sand, hvis forbindelsen blev åbnet til netop dette kald. */
  newConnection: boolean;
}

export interface DirectDbQueryOptions {
  onTiming?: (timing: DirectDbTiming) => void;
}

export interface DirectDbTransactionClient {
  query(text: string, params?: unknown[]): Promise<DirectDbQueryResult>;
}

// Den del af pg's Pool/Client, modulet bruger. Tests giver deres egen.
export interface PgClientLike {
  query(text: string, params?: unknown[]): Promise<{ rows?: unknown[]; rowCount?: number | null } | unknown>;
  release(destroy?: unknown): void;
  on(event: "error", listener: (err: unknown) => void): unknown;
  removeListener(event: "error", listener: (err: unknown) => void): unknown;
}

export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
  on(event: "error", listener: (err: unknown) => void): unknown;
}

export interface DirectDbPoolConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  query_timeout: number;
  allowExitOnIdle: boolean;
  application_name: string;
  ssl: { rejectUnauthorized: true; servername: string; ca?: string };
}

export type CreatePool = (config: DirectDbPoolConfig) => Promise<PgPoolLike> | PgPoolLike;

interface Logger {
  warn: (...args: unknown[]) => void;
}

export interface DirectDbOptions {
  env?: Record<string, string | undefined>;
  createPool?: CreatePool;
  logger?: Logger;
  now?: () => number;
}

export interface DirectDbStats {
  poolErrors: number;
  clientErrors: number;
  queries: number;
  transactions: number;
  failures: number;
}

export interface DirectDb {
  isEnabled(): boolean;
  query(text: string, params?: unknown[], options?: DirectDbQueryOptions): Promise<DirectDbQueryResult>;
  transaction<T>(work: (tx: DirectDbTransactionClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  stats(): DirectDbStats;
}

// ── Konfiguration ──────────────────────────────────────────────────────────

function readUrl(env: Record<string, string | undefined>): string | null {
  const raw = env[DIRECT_DB_URL_ENV];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

/** Sand, hvis miljøvariablen er sat. Siger intet om, hvorvidt linjen virker. */
export function isDirectDbConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readUrl(env) !== null;
}

/**
 * Bygger puljens indstillinger af adressen. Adressen skilles ad i felter, så
 * pg aldrig ser den samlede tekst (og dermed aldrig kan lade et `sslmode` i
 * adressen overstyre tjekket af modpartens bevis).
 */
export function buildPoolConfig(url: string, env: Record<string, string | undefined> = {}): DirectDbPoolConfig {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DirectDbError("config", `${DIRECT_DB_URL_ENV} kan ikke læses som en databaseadresse`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new DirectDbError("config", `${DIRECT_DB_URL_ENV} skal være en postgres-adresse`);
  }
  const host = parsed.hostname;
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres";
  if (!host || !user || !password) {
    throw new DirectDbError("config", `${DIRECT_DB_URL_ENV} mangler vært, bruger eller adgangskode`);
  }
  const port = parsed.port ? Number(parsed.port) : 5432;
  const ca = typeof env[DIRECT_DB_CA_ENV] === "string" && env[DIRECT_DB_CA_ENV]!.trim() !== ""
    ? env[DIRECT_DB_CA_ENV]!.replace(/\\n/g, "\n")
    : undefined;
  return {
    host,
    port,
    user,
    password,
    database,
    max: DIRECT_DB_LIMITS.maxConnections,
    min: DIRECT_DB_LIMITS.minConnections,
    idleTimeoutMillis: DIRECT_DB_LIMITS.idleCloseMs,
    connectionTimeoutMillis: DIRECT_DB_LIMITS.connectTimeoutMs,
    query_timeout: DIRECT_DB_LIMITS.statementTimeoutMs,
    // Puljen må aldrig holde processen i live alene.
    allowExitOnIdle: true,
    application_name: APPLICATION_NAME,
    ssl: ca
      ? { rejectUnauthorized: true, servername: host, ca }
      : { rejectUnauthorized: true, servername: host },
  };
}

// ── Rensning af fejltekst ──────────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fjerner forbindelsesadresser og de kendte dele af den konfigurerede adresse. */
export function redactConnectionDetails(text: string, secrets: string[] = []): string {
  let out = String(text ?? "");
  out = out.replace(/postgres(?:ql)?:\/\/[^\s'"`<>]+/gi, `postgres://${REDACTED}`);
  const parts = [...new Set(secrets.filter((s) => typeof s === "string" && s.length >= 3))]
    .sort((a, b) => b.length - a.length);
  for (const part of parts) {
    out = out.replace(new RegExp(escapeRegExp(part), "g"), REDACTED);
  }
  return out;
}

function secretPartsOf(url: string | null): string[] {
  if (!url) return [];
  const parts = [url];
  try {
    const parsed = new URL(url);
    parts.push(parsed.hostname, parsed.username, parsed.password,
      decodeURIComponent(parsed.username), decodeURIComponent(parsed.password));
  } catch {
    // best-effort: en adresse, der ikke kan læses, renses stadig som helhed ovenfor.
  }
  return parts;
}

function errorText(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

function sqlStateOf(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/** Sorterer en fejl i en lille fast liste; teksten bruges kun til at genkende tidsgrænser og net. */
export function classifyDbError(err: unknown): DirectDbErrorKind {
  if (err instanceof DirectDbError) return err.kind;
  const code = sqlStateOf(err) ?? "";
  const message = errorText(err).toLowerCase();
  if (code === "55P03") return "lock-timeout";
  if (code === "57014" || code === "25P03") return "timeout";
  if (code === "28P01" || code === "28000") return "auth";
  if (message.includes("timeout exceeded when trying to connect")) return "pool-timeout";
  if (message.includes("query read timeout") || message.includes("timeout")) return "timeout";
  if (/certificate|self[- ]signed|tls|ssl/.test(message)) return "tls";
  if (code.startsWith("08") || /econnreset|econnrefused|enotfound|etimedout|terminated|connection/.test(message)) {
    return "connection";
  }
  return "query";
}

/** Laver en ny, renset fejl. Den oprindelige fejl hænges ikke på, så intet slipper ud via `cause`. */
export function sanitizeDbError(err: unknown, secrets: string[] = []): DirectDbError {
  if (err instanceof DirectDbError) {
    return new DirectDbError(err.kind, redactConnectionDetails(err.message, secrets), err.sqlState);
  }
  return new DirectDbError(classifyDbError(err), redactConnectionDetails(errorText(err), secrets), sqlStateOf(err));
}

// ── Reglen om én handel ad gangen ──────────────────────────────────────────

// Session-indstillinger, session-låse og andet, der overlever handlen. SET LOCAL,
// set_config(..., true) og pg_advisory_xact_lock er tilladt.
const SESSION_SCOPED_PATTERNS: Array<[RegExp, string]> = [
  [/(^|;)\s*SET\s+(?!LOCAL\b|TRANSACTION\b|CONSTRAINTS\b)(SESSION\s+)?\w/i, "SET uden LOCAL"],
  [/(^|;)\s*RESET\b/i, "RESET"],
  [/\bpg_(try_)?advisory_lock(_shared)?\s*\(/i, "session-lås (brug pg_advisory_xact_lock)"],
  [/(^|;)\s*(LISTEN|UNLISTEN)\b/i, "LISTEN"],
  [/(^|;)\s*PREPARE\b/i, "PREPARE"],
  [/(^|;)\s*DISCARD\b/i, "DISCARD"],
  [/\bWITH\s+HOLD\b/i, "markør WITH HOLD"],
  [/(^|;)\s*CREATE\s+(TEMP|TEMPORARY)\b/i, "midlertidig tabel"],
  [/\bset_config\s*\([^)]*,\s*false\s*\)/i, "set_config(..., false)"],
];

/** Kaster, hvis spørgsmålet ville efterlade noget i forbindelsen ud over én handel. */
export function assertTransactionScoped(text: string): void {
  for (const [pattern, label] of SESSION_SCOPED_PATTERNS) {
    if (pattern.test(text)) {
      throw new DirectDbError("session-scope", `Afvist på den direkte linje: ${label}. Kun indstillinger og låse for én handel er tilladt (#8143).`);
    }
  }
}

/** Første spørgsmål i hver handel: tidsgrænserne gælder kun for netop denne handel. */
export const TRANSACTION_PREAMBLE =
  "BEGIN; SELECT " +
  `set_config('statement_timeout', '${DIRECT_DB_LIMITS.statementTimeoutMs}', true), ` +
  `set_config('lock_timeout', '${DIRECT_DB_LIMITS.lockTimeoutMs}', true), ` +
  `set_config('idle_in_transaction_session_timeout', '${DIRECT_DB_LIMITS.idleInTransactionMs}', true)`;

// ── Selve linjen ───────────────────────────────────────────────────────────

async function defaultCreatePool(config: DirectDbPoolConfig): Promise<PgPoolLike> {
  // Variabel modulnavn: pg har ingen egne typer, og typecheck må ikke kræve dem.
  const moduleName = "pg";
  let mod: { default?: { Pool?: unknown }; Pool?: unknown };
  try {
    mod = await import(moduleName);
  } catch {
    throw new DirectDbError("driver-missing", "Biblioteket pg kunne ikke indlæses");
  }
  const Pool = (mod.default?.Pool ?? mod.Pool) as (new (cfg: DirectDbPoolConfig) => PgPoolLike) | undefined;
  if (typeof Pool !== "function") throw new DirectDbError("driver-missing", "Biblioteket pg har ingen Pool");
  return new Pool(config);
}

function toResult(raw: unknown): DirectDbQueryResult {
  // Flere sætninger i ét kald giver en liste; den sidste er svaret.
  const last = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  const value = (last ?? {}) as { rows?: unknown[]; rowCount?: number | null };
  return {
    rows: Array.isArray(value.rows) ? (value.rows as Array<Record<string, unknown>>) : [],
    rowCount: typeof value.rowCount === "number" ? value.rowCount : null,
  };
}

export function createDirectDb(options: DirectDbOptions = {}): DirectDb {
  const env = options.env ?? process.env;
  const createPool: CreatePool = options.createPool ?? defaultCreatePool;
  const logger: Logger = options.logger ?? console;
  const now = options.now ?? (() => performance.now());
  const url = readUrl(env);
  const secrets = secretPartsOf(url);
  const stats: DirectDbStats = { poolErrors: 0, clientErrors: 0, queries: 0, transactions: 0, failures: 0 };
  const seenClients = new WeakSet<object>();
  let poolPromise: Promise<PgPoolLike> | null = null;
  let closed = false;
  let lastLogAt = Number.NEGATIVE_INFINITY;

  function logOnce(message: string): void {
    // Højst én linje i minuttet, så en faldet forbindelse ikke fylder loggen.
    const at = Date.now();
    if (at - lastLogAt < 60_000) return;
    lastLogAt = at;
    logger.warn(`[direct-db] ${redactConnectionDetails(message, secrets)}`);
  }

  function onPoolError(err: unknown): void {
    stats.poolErrors += 1;
    logOnce(`ledig forbindelse faldt (${classifyDbError(err)}): ${errorText(err)}`);
  }

  function onClientError(err: unknown): void {
    stats.clientErrors += 1;
    logOnce(`udlånt forbindelse faldt (${classifyDbError(err)}): ${errorText(err)}`);
  }

  function getPool(): Promise<PgPoolLike> {
    if (!url) return Promise.reject(new DirectDbError("off", `Den direkte linje er slukket (${DIRECT_DB_URL_ENV} mangler)`));
    if (closed) return Promise.reject(new DirectDbError("off", "Den direkte linje er lukket"));
    if (!poolPromise) {
      poolPromise = (async () => {
        const config = buildPoolConfig(url, env);
        const pool = await createPool(config);
        pool.on("error", onPoolError);
        return pool;
      })();
      // En fejl ved oprettelsen må ikke huskes; næste kald prøver igen.
      poolPromise.catch(() => { poolPromise = null; });
    }
    return poolPromise;
  }

  async function acquire(): Promise<{ client: PgClientLike; acquireMs: number; newConnection: boolean }> {
    const pool = await getPool();
    const start = now();
    const client = await pool.connect();
    const acquireMs = now() - start;
    const newConnection = !seenClients.has(client as object);
    seenClients.add(client as object);
    client.on("error", onClientError);
    return { client, acquireMs, newConnection };
  }

  function release(client: PgClientLike, broken: unknown): void {
    client.removeListener("error", onClientError);
    // En fejl på forbindelsen (ikke i spørgsmålet) betyder: luk den, genbrug den ikke.
    client.release(broken ? true : undefined);
  }

  function isBrokenConnection(err: unknown): boolean {
    const kind = classifyDbError(err);
    return kind === "connection" || kind === "tls" || kind === "timeout";
  }

  return {
    isEnabled: () => url !== null && !closed,

    async query(text, params = [], queryOptions = {}) {
      stats.queries += 1;
      let held: PgClientLike | null = null;
      let broken: unknown = null;
      try {
        assertTransactionScoped(text);
        const { client, acquireMs, newConnection } = await acquire();
        held = client;
        const start = now();
        const raw = await client.query(text, params);
        const queryMs = now() - start;
        queryOptions.onTiming?.({ acquireMs, queryMs, newConnection });
        return toResult(raw);
      } catch (err) {
        stats.failures += 1;
        if (isBrokenConnection(err)) broken = err;
        throw sanitizeDbError(err, secrets);
      } finally {
        if (held) release(held, broken);
      }
    },

    async transaction(work) {
      stats.transactions += 1;
      let held: PgClientLike | null = null;
      let broken: unknown = null;
      let workError: unknown = undefined;
      try {
        const { client } = await acquire();
        held = client;
        await client.query(TRANSACTION_PREAMBLE);
        const tx: DirectDbTransactionClient = {
          async query(text, params = []) {
            assertTransactionScoped(text);
            try {
              return toResult(await client.query(text, params));
            } catch (err) {
              throw sanitizeDbError(err, secrets);
            }
          },
        };
        let result: Awaited<ReturnType<typeof work>>;
        try {
          result = await work(tx);
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackErr) {
            // best-effort: ROLLBACK fejlede, så forbindelsen lukkes i stedet for at blive genbrugt.
            broken = rollbackErr;
          }
          workError = err;
          throw err;
        }
        await client.query("COMMIT");
        return result;
      } catch (err) {
        stats.failures += 1;
        if (!broken && isBrokenConnection(err)) broken = err;
        // Kalderens egen fejl (fx en regel i spillet) sendes uændret videre efter
        // ROLLBACK; fejl fra databasen er allerede renset i tx.query.
        if (err === workError && !(err instanceof DirectDbError)) throw err;
        throw sanitizeDbError(err, secrets);
      } finally {
        if (held) release(held, broken);
      }
    },

    async close() {
      closed = true;
      const pending = poolPromise;
      poolPromise = null;
      if (!pending) return;
      try {
        const pool = await pending;
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          pool.end(),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, DIRECT_DB_LIMITS.shutdownTimeoutMs);
            timer.unref?.();
          }),
        ]);
        if (timer) clearTimeout(timer);
      } catch (err) {
        // best-effort: lukning ved udrulning må aldrig stoppe processens exit.
        logOnce(`lukning af puljen fejlede: ${errorText(err)}`);
      }
    },

    stats: () => ({ ...stats }),
  };
}

// Serverens ene linje. Oprettes uden at røre netværket; puljen åbnes først ved brug.
const sharedDirectDb = createDirectDb();

export function getDirectDb(): DirectDb {
  return sharedDirectDb;
}

export function directQuery(text: string, params?: unknown[], options?: DirectDbQueryOptions): Promise<DirectDbQueryResult> {
  return sharedDirectDb.query(text, params, options);
}

export function directTransaction<T>(work: (tx: DirectDbTransactionClient) => Promise<T>): Promise<T> {
  return sharedDirectDb.transaction(work);
}

/** Pæn lukning ved udrulning. Kaldes efter baggrundsjobbene (server.js via directDbProbe.ts). */
export function closeDirectDb(): Promise<void> {
  return sharedDirectDb.close();
}
