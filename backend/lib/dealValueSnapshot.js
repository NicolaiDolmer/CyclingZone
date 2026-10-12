// #2226 · Rytterværdi på handelsdagen, skrevet på selve handels-rækken.
//
// Fair-play-scannet og #2226's detektor skal kende rytterens market_value DA
// handlen blev gennemført. riders.market_value overskrives løbende (søndags-sweep,
// træning), så værdien fryses på auctions/transfer_offers/swap_offers i SAMME
// UPDATE som status-flippet. Rytter-rækken skal være læst FØR handlen muterer den.
//
// Auto-migrate-vinduet: backenden deployes ~3 min før migrationen applies
// (auto-migrate.yml). I det vindue svarer PostgREST PGRST204/42703 på de nye
// kolonner. Snapshot er berigelse, ikke handelslogik, så vi gentager da UPDATE'en
// uden snapshot i stedet for at lade en betalt handel fejle.
import { ensureNoError } from "./marketUtils.js";

function toIntOrNull(value) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : null;
}

/**
 * Snapshot-felter for én rytter med kolonne-præfiks/-suffiks.
 * @param {{ market_value?: number|null, base_value?: number|null }|null|undefined} rider
 * @param {{ prefix?: string, suffix: string }} naming
 */
export function buildRiderValueSnapshot(rider, { prefix = "rider", suffix }) {
  return {
    [`${prefix}_market_value_${suffix}`]: toIntOrNull(rider?.market_value),
    [`${prefix}_base_value_${suffix}`]: toIntOrNull(rider?.base_value),
  };
}

export function isDealValueSnapshotSchemaPending(error, columns) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`;
  if (code !== "42703" && code !== "PGRST204" && !/schema cache|does not exist/i.test(text)) {
    return false;
  }
  return columns.some((column) => text.includes(column));
}

/**
 * UPDATE <table> SET payload + snapshot WHERE id = id. Mangler snapshot-
 * kolonnerne endnu (auto-migrate-vinduet), gentages UPDATE'en uden snapshot.
 * Alle andre fejl kastes som ved expectMutation.
 */
export async function updateDealWithValueSnapshot(supabase, { table, id, payload, snapshot }) {
  const columns = Object.keys(snapshot || {});
  const hasSnapshot = columns.some((column) => snapshot[column] != null);
  if (!hasSnapshot) {
    const { error } = await supabase.from(table).update(payload).eq("id", id);
    ensureNoError(error);
    return { snapshotWritten: false };
  }

  const { error } = await supabase.from(table).update({ ...payload, ...snapshot }).eq("id", id);
  if (!error) return { snapshotWritten: true };
  if (!isDealValueSnapshotSchemaPending(error, columns)) ensureNoError(error);

  console.warn(`[dealValueSnapshot] ${table}: snapshot-kolonner mangler endnu (${error.code}), skriver uden snapshot`);
  const { error: retryError } = await supabase.from(table).update(payload).eq("id", id);
  ensureNoError(retryError);
  return { snapshotWritten: false };
}
