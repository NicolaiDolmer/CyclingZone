// #7327 (D7/T3, spec 2026-10-28-cross-feature-coordination-design.md): gemme-
// flowet for Taktik-fanen, trukket ud af RaceTacticsTab.save som ren logik.
//
// Et "Gem etape N" er TO skrivninger: intentionen (PUT /stage-roles, versioneret
// pr. etape, #6095) og ordren for den aabne etape (PUT /team-orders/:stage).
// Foer #7327 skrev save() intentionen og derefter ordren; fejlede ordren, blev
// den lokale baseline og stage_versions staaende bagud, og et genforsoeg loeb ind
// i stage_roles_conflict paa holdets EGEN foerste gemning (og kasserede kladden).
//
// Nu (ejer 31/10, design A):
//   · En bekraeftet del faar sin kvittering (genlaesning af stage-roles = nye
//     versioner), og kun dens del af baseline flyttes. Kladden roeres aldrig.
//     Ogsaa efter en lykket PUT sammenlignes kvitteringen med det sendte: en
//     etape en anden fane har gemt imellem PUT og genlaesning er en konflikt.
//   · Genforsoeg sender kun det manglende: intentionen er ikke laengere aendret
//     mod baseline, saa kun ordren gaar afsted.
//   · 409 eller et tvetydigt svar (netvaerk/5xx/timeout efter commit) afklares ved
//     genlaesning: serverens udgave == det sendte => egen gemning, == baseline =>
//     ingen har roert den (genforsoeg med friske versioner, een gang), ellers en
//     fremmed aendring => konflikt. Serverens overskrivningsbeskyttelse bevares:
//     en fremmed aendring overskrives kun efter "Behold mine".
//   · Ordren skrives kun naar intentionen er bekraeftet (ordren baerer
//     intentionens indsats, #6647), saa de to tabeller aldrig siger hver sit.
//
// Ren: ingen React, ingen netvaerk. I/O kommer ind som deps (testbart med doubles).

export type Cell = { race_role: string; effort: string };
export type Matrix = Record<string, Record<string, Cell>>;
export type RolesBody = { stage_versions?: Record<string, string> } & Record<string, unknown>;

/** saved = bekraeftet af serveren · failed = forsoegt, ikke gemt · skipped = ikke forsoegt (en tidligere del manglede) · notNeeded = intet at gemme. */
export type PartState = "saved" | "failed" | "skipped" | "notNeeded";
export type SaveStatus = "saved" | "partial" | "conflict" | "failed";

export type RolesPutResult = { ok: true } | { ok: false; status: number; error: string | null };

export interface TacticsSavePlan {
  /** Redigerbare etaper hvor kladden afviger fra baseline (det der skal skrives). */
  stages: number[];
  /** Version pr. etape som klienten sidst saa den ("empty" = ingen raekker). */
  baseVersions: Record<number, string>;
  /** Kladden der sendes, normaliseret som serveren gemmer den. */
  sentMatrix: Matrix;
  /** Baseline (sidst kendte serverudgave), normaliseret paa samme maade. */
  baselineMatrix: Matrix;
  /** Skal ordren for den aabne etape gemmes? */
  ordersNeeded: boolean;
}

export interface TacticsSaveDeps {
  putRoles(stages: number[], baseVersions: Record<number, string>): Promise<RolesPutResult>;
  /** Genlaes stage-roles (kvittering). null = kunne ikke laese. */
  readRoles(): Promise<RolesBody | null>;
  /** Serverens udgave som matrix, normaliseret som sentMatrix. */
  matrixOf(body: RolesBody): Matrix;
  /** Gem ordren. Kaster med serverens fejlkode; en eventuel svarvaerdi ignoreres. */
  putOrders(): Promise<unknown>;
}

export interface TacticsSaveOutcome {
  status: SaveStatus;
  parts: { roles: PartState; orders: PartState };
  errorKey: string | null;
  /** Seneste genlaesning af stage-roles (nye versioner), hvis der er en. */
  receipt: RolesBody | null;
  /** Etaper hvis intention nu er bekraeftet gemt (baseline maa flyttes for dem). */
  confirmedStages: number[];
}

export const EMPTY_STAGE_VERSION = "empty";

/** Svar hvor serveren kan have committet uden at vi fik kvitteringen. */
export function isAmbiguousFailure(status: number): boolean {
  return status === 0 || status === 408 || status >= 500;
}

function sameCell(a: Cell | undefined, b: Cell | undefined): boolean {
  if (!a || !b) return a === b;
  return a.race_role === b.race_role && a.effort === b.effort;
}

/** Er etapen ens i de to matricer (celle for celle, samme regel som isDirty)? */
export function stageEqual(a: Matrix, b: Matrix, stage: number): boolean {
  const sa = a?.[stage] ?? {};
  const sb = b?.[stage] ?? {};
  for (const id of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    if (!sameCell(sa[id], sb[id])) return false;
  }
  return true;
}

export function versionsFor(body: RolesBody | null, stages: number[]): Record<number, string> {
  const versions = body?.stage_versions ?? {};
  return Object.fromEntries(stages.map((sn) => [sn, versions[String(sn)] ?? EMPTY_STAGE_VERSION]));
}

type StageVerdict = "committed" | "untouched" | "foreign";

/** Hvad er der sket med hver etape ifoelge serverens nuvaerende udgave? */
export function classifyStages(server: Matrix, plan: Pick<TacticsSavePlan, "stages" | "sentMatrix" | "baselineMatrix">): Record<number, StageVerdict> {
  const out: Record<number, StageVerdict> = {};
  for (const sn of plan.stages) {
    if (stageEqual(server, plan.sentMatrix, sn)) out[sn] = "committed";
    else if (stageEqual(server, plan.baselineMatrix, sn)) out[sn] = "untouched";
    else out[sn] = "foreign";
  }
  return out;
}

type RolesResult = { state: "saved" | "failed" | "conflict"; errorKey: string | null; receipt: RolesBody | null; confirmed: number[] };

async function safePutRoles(deps: TacticsSaveDeps, stages: number[], base: Record<number, string>): Promise<RolesPutResult> {
  try {
    return await deps.putRoles(stages, base);
  } catch {
    return { ok: false, status: 0, error: null };
  }
}

async function safeRead(deps: TacticsSaveDeps): Promise<RolesBody | null> {
  try {
    return await deps.readRoles();
  } catch {
    return null;
  }
}

/**
 * Kvittering efter en LYKKET PUT. Genlaesningen sker efter skrivningen, saa en
 * anden fane kan have gemt imellem. Kun etaper hvor serveren har praecis det
 * sendte er bekraeftet; afviger en etape, er den aendret af en anden siden vores
 * skrivning og behandles som konflikt (ellers ville kladden faa den anden fanes
 * version mens baseline flyttes til det sendte, og naeste gem overskrev stille).
 * Kunne kvitteringen ikke laeses, er skrivningen stadig bekraeftet af PUT'en:
 * versionerne flyttes ikke, og et senere gem afklares via 409 + genlaesning.
 */
function confirmAfterWrite(plan: TacticsSavePlan, deps: TacticsSaveDeps, receipt: RolesBody | null, fallback: RolesBody | null): RolesResult {
  if (!receipt) return { state: "saved", errorKey: null, receipt: fallback, confirmed: plan.stages };
  const verdict = classifyStages(deps.matrixOf(receipt), plan);
  const committed = plan.stages.filter((sn) => verdict[sn] === "committed");
  if (committed.length === plan.stages.length) return { state: "saved", errorKey: null, receipt, confirmed: committed };
  return { state: "conflict", errorKey: "stage_roles_conflict", receipt, confirmed: committed };
}

async function saveRoles(plan: TacticsSavePlan, deps: TacticsSaveDeps): Promise<RolesResult> {
  const first = await safePutRoles(deps, plan.stages, plan.baseVersions);
  if (first.ok) return confirmAfterWrite(plan, deps, await safeRead(deps), null);

  const conflict = first.error === "stage_roles_conflict";
  if (!conflict && !isAmbiguousFailure(first.status)) {
    return { state: "failed", errorKey: first.error || "generic", receipt: null, confirmed: [] };
  }

  // 409 eller tvetydigt svar: afklar ved genlaesning, aldrig ved blind gentagelse.
  const receipt = await safeRead(deps);
  if (!receipt) return { state: "failed", errorKey: first.error || "generic", receipt: null, confirmed: [] };
  const verdict = classifyStages(deps.matrixOf(receipt), plan);
  const committed = plan.stages.filter((sn) => verdict[sn] === "committed");
  const untouched = plan.stages.filter((sn) => verdict[sn] === "untouched");
  if (plan.stages.some((sn) => verdict[sn] === "foreign")) {
    return { state: "conflict", errorKey: "stage_roles_conflict", receipt, confirmed: committed };
  }
  if (untouched.length === 0) return { state: "saved", errorKey: null, receipt, confirmed: committed };
  if (!conflict) {
    // Svaret gik tabt, og serveren har ikke etaperne: genforsoeg er sikkert, men
    // overlades til manageren (een knap), med de friske versioner i kvitteringen.
    return { state: "failed", errorKey: first.error || "generic", receipt, confirmed: committed };
  }

  // 409 men ingen andre har roert etaperne (vores version var bare bagud, fx efter
  // egen gemning uden kvittering): genforsoeg EEN gang med serverens versioner.
  const retry = await safePutRoles(deps, untouched, versionsFor(receipt, untouched));
  // Samme kvitteringsregel som foerste PUT: alle etaper tjekkes mod den friske
  // genlaesning. Fejler den, beholdes den forrige kvittering (de genforsoegte
  // etapers versioner er saa bagud, og et senere gem afklares via 409).
  if (retry.ok) return confirmAfterWrite(plan, deps, await safeRead(deps), receipt);
  // En anden fane kan have gemt mellem genlaesningen og genforsoeget: "Behold mine"
  // skal staa paa serverens NUVAERENDE versioner, saa der laeses igen.
  if (retry.error === "stage_roles_conflict") return { state: "conflict", errorKey: "stage_roles_conflict", receipt: (await safeRead(deps)) ?? receipt, confirmed: committed };
  return { state: "failed", errorKey: retry.error || "generic", receipt, confirmed: committed };
}

function overall(parts: TacticsSaveOutcome["parts"], rolesConflict: boolean): SaveStatus {
  if (rolesConflict) return "conflict";
  const needed = (Object.values(parts) as PartState[]).filter((p) => p !== "notNeeded");
  if (needed.every((p) => p === "saved")) return "saved";
  return needed.some((p) => p === "saved") ? "partial" : "failed";
}

/** Koer et gem. Kaster aldrig: alle fejl ender i udfaldet. */
export async function runTacticsSave(plan: TacticsSavePlan, deps: TacticsSaveDeps): Promise<TacticsSaveOutcome> {
  let roles: PartState = "notNeeded";
  let orders: PartState = plan.ordersNeeded ? "skipped" : "notNeeded";
  let errorKey: string | null = null;
  let receipt: RolesBody | null = null;
  let confirmedStages: number[] = [];
  let rolesConflict = false;

  if (plan.stages.length) {
    const r = await saveRoles(plan, deps);
    roles = r.state === "saved" ? "saved" : "failed";
    rolesConflict = r.state === "conflict";
    errorKey = r.errorKey;
    receipt = r.receipt;
    confirmedStages = r.confirmed;
  }

  if (plan.ordersNeeded && roles !== "failed") {
    try {
      await deps.putOrders();
      orders = "saved";
    } catch (err) {
      orders = "failed";
      errorKey = (err instanceof Error && err.message) || "generic";
    }
  }

  const parts = { roles, orders };
  return { status: overall(parts, rolesConflict), parts, errorKey, receipt, confirmedStages };
}

/**
 * Kvitteringen ind i den lokale tilstand: KUN de bekraeftede etaper faar serverens
 * nye version. En etape en anden fane har aendret imens beholder sin gamle version
 * (dens lokale baseline er heller ikke flyttet), saa et senere gem af den stadig
 * rammer serverens konfliktvagt i stedet for stille at overskrive den anden fane.
 */
export function withConfirmedVersions(previous: RolesBody | null, receipt: RolesBody, confirmedStages: number[]): RolesBody {
  const versions: Record<string, string> = { ...(previous?.stage_versions ?? {}) };
  const fresh = receipt.stage_versions ?? {};
  for (const sn of confirmedStages) versions[String(sn)] = fresh[String(sn)] ?? EMPTY_STAGE_VERSION;
  return { ...receipt, stage_versions: versions };
}

/** Baseline efter et gem: de bekraeftede etaper faar det sendte; resten er uroert. */
export function advanceBaseline(baseline: Matrix, sent: Matrix, confirmedStages: number[]): Matrix {
  if (!confirmedStages.length) return baseline;
  const next: Matrix = { ...baseline };
  for (const sn of confirmedStages) if (sent[sn]) next[sn] = sent[sn];
  return next;
}

/**
 * "Behold mine" efter en ægte konflikt: serverens udgave bliver baseline (nye
 * versioner), etaper manageren har aendret beholder kladden, de oevrige tager
 * serverens udgave. Naeste gem overskriver derfor kun manageren egne etaper,
 * og kun fordi manageren valgte det.
 */
export function keepMineAfterConflict({ draft, baseline, server }: { draft: Matrix; baseline: Matrix; server: Matrix }): { draft: Matrix; baseline: Matrix } {
  const next: Matrix = { ...server };
  for (const sn of Object.keys(draft)) {
    if (!stageEqual(draft, baseline, Number(sn))) next[sn] = draft[sn];
  }
  return { draft: next, baseline: server };
}
