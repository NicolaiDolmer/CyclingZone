// #8143 trin 1 · Måleprøven: hvad koster ét lille spørgsmål ad hver vej?
//
// Den eneste bruger af den direkte linje (directDb.ts) i trin 1. Når kontakten
// direct_db_probe_8143 står på "on", stiller prøven hvert minut ét lille
// spørgsmål ad begge veje (web-adgangen og den direkte linje), måler tiden for
// hver og gemmer to rækker i public.direct_db_probe_samples. Opgørelsen pr. vej
// pr. time (midterværdi, 95 %, antal fejl) læses med én SELECT; den står i
// docs/AI_OPS_REFERENCE.md og i designet.
//
// Prøven må aldrig mærkes af spillerne:
//  - egen timer (unref), aldrig inde i et spillerkald;
//  - højst én runde ad gangen; en runde, der stadig kører, springes over;
//  - hver fejl sluges og tælles (både i hukommelsen og som række med ok = false);
//  - uden DIRECT_DB_URL startes timeren slet ikke: ingen kald, ingen log.
//
// Kontakten læses direkte på nøglen (ikke via stage-kataloget): den er intern,
// og kun værdien "on" (eller true) tænder. Ingen række = slukket.
//
// Hvorfor de to spørgsmål er sammenlignelige: web-vejen læser én indstilling
// (det hyppigste spørgsmål, serveren stiller i dag), den direkte vej stiller
// `SELECT 1`. Databasens egen tid for begge er under et tiendedel millisekund
// (målt 13/11), så forskellen er vejen, ikke spørgsmålet. Den direkte vejs tid
// for at få en forbindelse måles for sig (acquire_ms), så en ny forbindelse
// ikke forveksles med prisen pr. spørgsmål.

import {
  getDirectDb,
  closeDirectDb,
  isDirectDbConfigured,
  type DirectDb,
  type DirectDbErrorKind,
  type DirectDbTiming,
  DirectDbError,
} from "./directDb.ts";

export const DIRECT_DB_PROBE_FLAG_KEY = "direct_db_probe_8143";
export const DIRECT_DB_PROBE_TABLE = "direct_db_probe_samples";
export const DIRECT_DB_PROBE_INTERVAL_MS = 60_000;
export const DIRECT_DB_PROBE_RETENTION_DAYS = 14;
const WEB_TIMEOUT_MS = 15_000;
const EXPIRE_EVERY_MS = 60 * 60_000;
const STOP_WAIT_MS = 5_000;

export type ProbePath = "web" | "direct";

export interface ProbeSample {
  sampled_at: string;
  path: ProbePath;
  ok: boolean;
  query_ms: number | null;
  acquire_ms: number | null;
  new_connection: boolean | null;
  error_kind: string | null;
}

export interface ProbeStats {
  ticks: number;
  measured: number;
  skippedBusy: number;
  errors: { web: number; direct: number; store: number; expire: number; flag: number; tick: number };
}

export type ProbeTickResult =
  | { status: "no-line" }
  | { status: "off" }
  | { status: "busy" }
  | { status: "error" }
  | { status: "measured"; samples: ProbeSample[] };

// Supabase-klienten er utypet ved grænsen (samme valg som de andre flag-moduler).
type SupabaseLike = any;

interface Logger {
  warn: (...args: unknown[]) => void;
  log?: (...args: unknown[]) => void;
}

export interface DirectDbProbeOptions {
  supabase: SupabaseLike;
  directDb?: Pick<DirectDb, "isEnabled" | "query">;
  perfNow?: () => number;
  now?: () => number;
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
  logger?: Logger;
  intervalMs?: number;
}

function round1(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** Kort, fast fejlklasse til rækken. Aldrig en fejltekst (den kan rumme detaljer om forbindelsen). */
function webErrorKind(err: unknown): string {
  if (err && typeof err === "object") {
    const name = String((err as { name?: unknown }).name ?? "");
    const message = String((err as { message?: unknown }).message ?? "").toLowerCase();
    if (name === "AbortError" || name === "TimeoutError" || message.includes("abort")) return "timeout";
    if (message.includes("fetch failed") || message.includes("network")) return "connection";
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return `sql-${code}`;
  }
  return "query";
}

function directErrorKind(err: unknown): DirectDbErrorKind | "query" {
  return err instanceof DirectDbError ? err.kind : "query";
}

/** Læser kontakten direkte på nøglen. Fejl, fravær og alt andet end "on"/true giver slukket. */
export async function isDirectDbProbeOn(supabase: SupabaseLike): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", DIRECT_DB_PROBE_FLAG_KEY)
      .maybeSingle();
    if (error || !data) return false;
    return data.value === "on" || data.value === true;
  } catch {
    // best-effort: en fejlet aflæsning betyder slukket (fail-safe), aldrig en kastet fejl.
    return false;
  }
}

export function createDirectDbProbe(options: DirectDbProbeOptions) {
  const supabase = options.supabase;
  const directDb = options.directDb ?? getDirectDb();
  const perfNow = options.perfNow ?? (() => performance.now());
  const now = options.now ?? (() => Date.now());
  const setIntervalFn = options.setIntervalFn ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearIntervalFn = options.clearIntervalFn ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  const logger: Logger = options.logger ?? console;
  const intervalMs = options.intervalMs ?? DIRECT_DB_PROBE_INTERVAL_MS;

  const stats: ProbeStats = {
    ticks: 0,
    measured: 0,
    skippedBusy: 0,
    errors: { web: 0, direct: 0, store: 0, expire: 0, flag: 0, tick: 0 },
  };
  let timer: unknown = null;
  let running: Promise<ProbeTickResult> | null = null;
  let lastExpireAt = Number.NEGATIVE_INFINITY;
  let webFirst = true;

  async function measureWeb(sampledAt: string): Promise<ProbeSample> {
    const start = perfNow();
    let ok = false;
    let kind: string | null = null;
    try {
      const { error } = await supabase
        .from("app_config")
        .select("key")
        .eq("key", DIRECT_DB_PROBE_FLAG_KEY)
        .abortSignal(AbortSignal.timeout(WEB_TIMEOUT_MS))
        .maybeSingle();
      ok = !error;
      if (error) kind = webErrorKind(error);
    } catch (err) {
      // best-effort: talt som fejl på web-vejen og gemt som række med ok = false.
      kind = webErrorKind(err);
    }
    const queryMs = round1(perfNow() - start);
    if (!ok) stats.errors.web += 1;
    return { sampled_at: sampledAt, path: "web", ok, query_ms: queryMs, acquire_ms: null, new_connection: null, error_kind: kind };
  }

  async function measureDirect(sampledAt: string): Promise<ProbeSample> {
    const start = perfNow();
    let timing: DirectDbTiming | null = null;
    let ok = false;
    let kind: string | null = null;
    try {
      await directDb.query("SELECT 1 AS ok", [], { onTiming: (t) => { timing = t; } });
      ok = true;
    } catch (err) {
      // best-effort: talt som fejl på den direkte vej; fejlklassen gemmes, aldrig teksten.
      kind = directErrorKind(err);
    }
    if (!ok) stats.errors.direct += 1;
    const t = timing as DirectDbTiming | null;
    return {
      sampled_at: sampledAt,
      path: "direct",
      ok,
      query_ms: t ? round1(t.queryMs) : round1(perfNow() - start),
      acquire_ms: t ? round1(t.acquireMs) : null,
      new_connection: t ? t.newConnection : null,
      error_kind: kind,
    };
  }

  async function store(samples: ProbeSample[]): Promise<void> {
    try {
      const { error } = await supabase.from(DIRECT_DB_PROBE_TABLE).insert(samples);
      if (error) stats.errors.store += 1;
    } catch {
      // best-effort: en fejlet gemning tælles; næste runde prøver igen.
      stats.errors.store += 1;
    }
  }

  async function maybeExpire(): Promise<void> {
    const at = now();
    if (at - lastExpireAt < EXPIRE_EVERY_MS) return;
    lastExpireAt = at;
    const cutoff = new Date(at - DIRECT_DB_PROBE_RETENTION_DAYS * 24 * 60 * 60_000).toISOString();
    try {
      const { error } = await supabase.from(DIRECT_DB_PROBE_TABLE).delete().lt("sampled_at", cutoff);
      if (error) stats.errors.expire += 1;
    } catch {
      // best-effort: udløbet tages igen ved næste time.
      stats.errors.expire += 1;
    }
  }

  async function runTick(): Promise<ProbeTickResult> {
    stats.ticks += 1;
    try {
      if (!directDb.isEnabled()) return { status: "no-line" };
      if (!(await isDirectDbProbeOn(supabase))) return { status: "off" };
      const sampledAt = new Date(now()).toISOString();
      // Skiftevis rækkefølge, så ingen af vejene altid går først.
      const first = webFirst ? await measureWeb(sampledAt) : await measureDirect(sampledAt);
      const second = webFirst ? await measureDirect(sampledAt) : await measureWeb(sampledAt);
      webFirst = !webFirst;
      const samples = [first, second];
      await store(samples);
      await maybeExpire();
      stats.measured += 1;
      return { status: "measured", samples };
    } catch {
      // best-effort: prøven må aldrig kaste ud i timeren; fejlen tælles.
      stats.errors.tick += 1;
      return { status: "error" };
    }
  }

  function tick(): Promise<ProbeTickResult> {
    if (running) {
      stats.skippedBusy += 1;
      return Promise.resolve({ status: "busy" });
    }
    const current = runTick().finally(() => { running = null; });
    running = current;
    return current;
  }

  return {
    tick,
    stats: (): ProbeStats => ({ ...stats, errors: { ...stats.errors } }),
    isRunning: () => timer !== null,
    start(): boolean {
      if (timer !== null || !directDb.isEnabled()) return false;
      const handle = setIntervalFn(() => { void tick(); }, intervalMs);
      (handle as { unref?: () => void } | null)?.unref?.();
      timer = handle;
      logger.log?.(`[direct-db-probe] klar; kontakten ${DIRECT_DB_PROBE_FLAG_KEY} styrer målingen`);
      return true;
    },
    /** Stopper nye runder med det samme (synkront). */
    stopTimer(): void {
      if (timer === null) return;
      clearIntervalFn(timer);
      timer = null;
    },
    /** Venter på en runde, der allerede kører, højst STOP_WAIT_MS. */
    async drain(): Promise<void> {
      const current = running;
      if (!current) return;
      let waitTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        current,
        new Promise<void>((resolve) => {
          waitTimer = setTimeout(resolve, STOP_WAIT_MS);
          waitTimer.unref?.();
        }),
      ]);
      if (waitTimer) clearTimeout(waitTimer);
    },
  };
}

export type DirectDbProbe = ReturnType<typeof createDirectDbProbe>;

// ── Serverens ene prøve (server.js) ────────────────────────────────────────

let serverProbe: DirectDbProbe | null = null;

/** Kaldes når serveren lytter. Uden DIRECT_DB_URL sker der intet. */
export function startDirectDbProbe(options: { supabase: SupabaseLike }): boolean {
  if (serverProbe || !isDirectDbConfigured()) return false;
  serverProbe = createDirectDbProbe({ supabase: options.supabase });
  return serverProbe.start();
}

/** Ved SIGTERM: ingen nye runder. Synkron, så den kan stå ved siden af stopCronScheduling(). */
export function stopDirectDbProbe(): void {
  serverProbe?.stopTimer();
}

/** Ved SIGTERM, efter baggrundsjobbene: vent på en igangværende runde, og luk puljen pænt. */
export async function closeDirectDbLine(): Promise<void> {
  try {
    serverProbe?.stopTimer();
    await serverProbe?.drain();
    await closeDirectDb();
  } catch (err) {
    // best-effort: lukning ved udrulning må aldrig stoppe processens exit.
    console.warn(`[direct-db-probe] lukning fejlede: ${err instanceof Error ? err.name : "ukendt"}`);
  }
}
