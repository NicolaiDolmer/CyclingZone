/** Read-only data prerequisites for #5904; never starts jobs or certifies load. */
import { pathToFileURL } from 'node:url';

const STAGING_REF = 'pywxpnynzmbukdvoiazp'; // Approved staging-cutover; #5904 variant A.
const REQUEST_TIMEOUT_MS = 15_000;
const SCHEMA_PROBES = [
  ['races', 'id,squad,finalize_state,finalize_updated_at,engine_rules_revision'],
  ['training_date_work', 'team_id,season_id,tick_date'],
  ['race_day_participation', 'rider_id,season_id,game_day,race_id,stage_number'],
];

function blocked(blockers) {
  return { status: 'BLOCKED', loadTestPassed: false, resultRows: null, blockers };
}

export async function checkStagingPrerequisites(config, fetchImpl = fetch) {
  // Literal equality rejects prod, arbitrary targets, credentials, redirects,
  // paths, ports, query strings and lookalike hosts before sending any secret.
  if (config?.ref !== STAGING_REF || config?.url !== `https://${STAGING_REF}.supabase.co`
    || typeof config?.key !== 'string' || !config.key.trim()
    || !Number.isSafeInteger(config?.minResults) || config.minResults <= 0) {
    return blocked(['INVALID_STAGING_CONFIG']);
  }
  const blockers = [];
  async function probe(table, select, exactCount = false) {
    const url = new URL(`/rest/v1/${table}`, config.url);
    url.searchParams.set('select', select);
    url.searchParams.set('limit', '0');
    const headers = { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Accept-Profile': 'public' };
    if (exactCount) headers.Prefer = 'count=exact';
    try {
      const response = await fetchImpl(url, {
        method: 'HEAD', headers, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        blockers.push(`${exactCount ? 'RESULT_COUNT' : `SCHEMA_${table.toUpperCase()}`}_HTTP_${response.status}`);
        return null;
      }
      return response;
    } catch {
      // Error messages/bodies can contain URLs or authorization headers. Emit
      // only the fixed failure code, including for cancellations/timeouts.
      blockers.push(`${exactCount ? 'RESULT_COUNT' : `SCHEMA_${table.toUpperCase()}`}_REQUEST_FAILED`);
      return null;
    }
  }
  // Four bounded HEADs, no row downloads, RPC, schema change or flag access.
  for (const [table, select] of SCHEMA_PROBES) await probe(table, select);
  const response = await probe('race_results', 'id', true);
  let resultRows = null;
  if (response) {
    const match = /^(?:\*|\d+-\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
    const count = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(count) || count < 0) blockers.push('RESULT_COUNT_UNKNOWN');
    else {
      resultRows = count;
      if (count < config.minResults) blockers.push('RESULT_VOLUME_TOO_SMALL');
    }
  }
  return {
    status: blockers.length ? 'BLOCKED' : 'DATA_PREREQUISITES_READY',
    loadTestPassed: false, stagingRef: STAGING_REF,
    minimumResultRows: config.minResults, resultRows, blockers,
  };
}

export async function runCli(args, { env = process.env, fetchImpl = fetch, write = s => process.stdout.write(s) } = {}) {
  if (args.length !== 2 || args[0] !== '--min-results' || !/^[1-9]\d*$/.test(args[1])) {
    write(`${JSON.stringify(blocked(['USAGE_REQUIRE_MIN_RESULTS']))}\n`);
    return 1;
  }
  const result = await checkStagingPrerequisites({
    ref: env.STAGING_REF, url: env.STAGING_SUPABASE_URL, key: env.STAGING_SERVICE_KEY,
    minResults: Number(args[1]),
  }, fetchImpl);
  write(`${JSON.stringify(result)}\n`);
  return result.status === 'DATA_PREREQUISITES_READY' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
