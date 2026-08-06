// #3402 — Sæsondokumentaren: orkestrering. Henter verificerede fakta (RPC
// get_season_documentary_facts, #2891/#2863-mønsteret), bygger den
// deterministiske kladde (seasonDocumentaryGrammar.js, ALTID til stede),
// forsøger valgfrit LLM-poleringen (seasonDocumentaryLLM.js, dobbelt-gated),
// og UPSERTer én cachet/persisteret række pr. (season_id, team_id).
//
// IDEMPOTENT: upsert på PRIMARY KEY (season_id, team_id) — en genkørsel
// (fx sweepen der kører igen efter en fejl) overskriver med samme deterministiske
// output (ren funktion af persisterede rækker) og evt. et nyt LLM-forsøg.
//
// INGEN LLM-KALD I TESTS: llmEnabled default false + anthropicApiKey default
// læst fra process.env.ANTHROPIC_API_KEY (tom streng/undefined i CI). Test-filen
// injicerer aldrig en rigtig nøgle og stubber polish() eksplicit hvor LLM-stien
// testes, så intet testkald rammer netværket.

import { buildSeasonDocumentary } from "./seasonDocumentaryGrammar.js";
import { polishSeasonDocumentary, isSeasonDocumentaryLlmEnabled } from "./seasonDocumentaryLLM.js";

export const SEASON_DOCUMENTARY_LLM_MODEL = "claude-sonnet-5";

/**
 * Henter de verificerede rå-fakta for ét hold via get_season_documentary_facts.
 * Kastes eksplicit ved fejl (#1851-klassen: intet tavst `|| {}`, som ville få
 * en fejlende RPC til at se ud som "intet at fortælle").
 */
export async function fetchSeasonDocumentaryFacts(supabase, seasonId, teamId) {
  const { data, error } = await supabase.rpc("get_season_documentary_facts", {
    p_season_id: seasonId,
    p_team_id: teamId,
  });
  if (error) throw new Error(`get_season_documentary_facts: ${error.message}`);
  return data || {};
}

/**
 * Genererer + persisterer sæsondokumentaren for ÉT hold. Ren orkestrering —
 * al tekst-logik bor i seasonDocumentaryGrammar.js (deterministisk) og
 * seasonDocumentaryLLM.js (valgfri polering).
 *
 * @param {object} p
 * @param {import("@supabase/supabase-js").SupabaseClient} p.supabase
 * @param {string} p.seasonId
 * @param {string} p.teamId
 * @param {string} p.teamName
 * @param {number} p.seasonNumber
 * @param {boolean} [p.llmEnabled]  fra isSeasonDocumentaryLlmEnabled(supabase) — kaldestedet afgør
 * @param {string} [p.anthropicApiKey]  default process.env.ANTHROPIC_API_KEY
 * @param {typeof fetchSeasonDocumentaryFacts} [p.fetchFacts]  DI til tests
 * @param {typeof polishSeasonDocumentary} [p.polish]  DI til tests
 * @returns {Promise<object>}  den upsertede række
 */
export async function generateSeasonDocumentary({
  supabase,
  seasonId,
  teamId,
  teamName,
  seasonNumber,
  llmEnabled = false,
  anthropicApiKey = process.env.ANTHROPIC_API_KEY,
  fetchFacts = fetchSeasonDocumentaryFacts,
  polish = polishSeasonDocumentary,
}) {
  const facts = await fetchFacts(supabase, seasonId, teamId);
  const ctx = { teamId, teamName: teamName || "—", seasonNumber };
  const deterministic = buildSeasonDocumentary(facts, ctx);

  let llmEn = null;
  let llmDa = null;
  // Dobbelt-gate: flag OG nøgle. Fejler poleringen (netværk, refusal, timeout)
  // falder vi tilbage til den deterministiske tekst — se polishSeasonDocumentary's
  // egen "returnér null ved enhver fejl"-kontrakt.
  if (llmEnabled && anthropicApiKey) {
    [llmEn, llmDa] = await Promise.all([
      polish({ paragraphs: deterministic.en, lang: "en", apiKey: anthropicApiKey }),
      polish({ paragraphs: deterministic.da, lang: "da", apiKey: anthropicApiKey }),
    ]);
  }

  const hasLlm = !!(llmEn || llmDa);
  const nowIso = new Date().toISOString();
  const row = {
    season_id: seasonId,
    team_id: teamId,
    facts,
    deterministic_en: deterministic.en,
    deterministic_da: deterministic.da,
    llm_en: llmEn,
    llm_da: llmDa,
    llm_model: hasLlm ? SEASON_DOCUMENTARY_LLM_MODEL : null,
    source: hasLlm ? "llm" : "deterministic",
    generated_at: nowIso,
    updated_at: nowIso,
  };

  const { error } = await supabase
    .from("season_documentaries")
    .upsert(row, { onConflict: "season_id,team_id" });
  if (error) throw new Error(`season_documentaries upsert: ${error.message}`);

  return row;
}

/**
 * Wrapper der selv slår LLM-flaget op (til sweep-brug — enkelt-hold-generate
 * fra en admin-handling kan i stedet sende llmEnabled eksplicit).
 */
export async function generateSeasonDocumentaryAutoFlag(args) {
  const llmEnabled = await isSeasonDocumentaryLlmEnabled(args.supabase);
  return generateSeasonDocumentary({ ...args, llmEnabled });
}
