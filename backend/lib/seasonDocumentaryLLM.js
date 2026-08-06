// #3402 — Sæsondokumentaren, LLM-FORBEDRINGSLAG (issue-AC lag b), bag DOBBELT
// gate: ANTHROPIC_API_KEY skal være sat OG app_config-flag
// 'season_documentary_llm_enabled' skal være 'on' (fail-safe OFF på begge —
// isEnabled() nedenfor kræver begge for at returnere true).
//
// HALLUCINATIONS-GARDE: LLM'en får den FÆRDIGE deterministiske kladde
// (seasonDocumentaryGrammar.js's paragraffer, som allerede har alle tal/navne
// indsat fra get_season_documentary_facts) og må KUN omformulere den til
// flydende prosa — systemprompten forbyder eksplicit at tilføje nye
// påstande/tal/navne. Kladden er allerede sand og komplet; LLM'en er en
// ren stil-transform, ikke en informationskilde. Falder polish-kaldet (netværk,
// timeout, uventet svarform, sikkerheds-refusal), bruges den deterministiske
// kladde uændret — se seasonDocumentaryGenerate.js.
//
// INGEN LLM-KALD I TESTS: denne fil rammes kun når polishSeasonDocumentary()
// kaldes eksplicit MED en apiKey — testsuiten sender aldrig én (se .test.js),
// og isEnabled()/isLlmConfigured() lader kaldestedet skippe kaldet helt uden
// netværk når nøgle/flag mangler.
//
// Model: claude-sonnet-5 — en ren omformulerings-opgave (ingen agentisk
// værktøjsbrug, ingen dyb ræsonnering over nye fakta), så Sonnet-prisniveauet
// er rigeligt til opgaven; Opus ville være overkill. thinking eksplicit
// disabled (ren stil-transform har ikke brug for ræsonnering, og adaptive
// thinking er default-on for Sonnet 5 — at lade den stå til ville tilføje
// unødig latency/cost til hver af de ~150-200 hold pr. sæsonskifte).
//
// BATCH API — BEVIDST V1-SCOPE-BESLUTNING: issue-teksten nævner Batch API
// ("halv pris, latency irrelevant") som den ENDELIGE arkitektur, men dette
// modul kalder den almindelige (ikke-batch) Messages API synkront pr. hold.
// Begrundelse: (1) sweepen kører ÉN gang pr. hold pr. sæson — ved dagens
// skala (~150-200 menneskehold) er en synkron cron-tick's samlede kald
// billigt og hurtigt nok til at være færdig inden for ét sweep-vindue, uden
// Batch API'ens 24-timers afhentningsvindue og submit/poll-tilstandsmaskine;
// (2) "latency irrelevant" er sandt for spilleren (dokumentaren læses efter
// generering, ikke i samme request), men Batch API's asynkrone submit→poll→
// hent-flow kræver persisteret batch-state og en ekstra sweep-fase — reel
// merkompleksitet uden en reel gevinst ved denne volumen. Hvis LLM-laget
// senere flippes til 'on' i prod og volumen/omkostning retfærdiggør det, er
// Batch API en isoleret opgradering af DENNE fils implementering — kaldestedet
// (seasonDocumentaryGenerate.js) og resten af arkitekturen ændres ikke.
// Flaget i PR-body.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 700;

export const SEASON_DOCUMENTARY_LLM_FLAG_KEY = "season_documentary_llm_enabled";

// #3402 — samme flag-mønster som academyFlag.js/autoPrizeFlag.js (readFlagStage +
// evaluateFlagStage, app_config.value jsonb, fail-safe false ved manglende/ukendt værdi).
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export async function isSeasonDocumentaryLlmEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, SEASON_DOCUMENTARY_LLM_FLAG_KEY), opts);
}

function systemPrompt(lang) {
  const langLabel = lang === "da" ? "Danish" : "English";
  return [
    `You are a sports documentary copy editor for Cycling Zone, a cycling-manager game.`,
    `You receive a DRAFT made of short, already-correct sentences — every name, number, and place in it is verified fact.`,
    `Rewrite the draft into 2-4 flowing, editorial-sounding paragraphs in ${langLabel}, in the tone of a season-review sports documentary: concrete, understated, no hype adjectives, no exclamation marks, no emoji.`,
    `HARD RULES:`,
    `- Do not invent, add, or imply any name, number, place, or event that is not already in the draft.`,
    `- Do not change any number, name, or spelling from the draft.`,
    `- Do not add opinions, predictions, or claims about the future.`,
    `- Output ONLY the rewritten paragraphs as plain text, separated by blank lines. No headings, no preamble, no markdown, no quotation marks around the whole thing.`,
  ].join("\n");
}

/**
 * Kalder Anthropic Messages API for at omskrive den deterministiske kladde
 * til flydende prosa. Ren stil-transform — se filens header for hallucinations-garden.
 *
 * @param {object} p
 * @param {string[]} p.paragraphs  den deterministiske kladdes paragraffer (ÉT sprog)
 * @param {"en"|"da"} p.lang
 * @param {string} p.apiKey        ANTHROPIC_API_KEY — kaldestedet afgør om den findes
 * @param {typeof fetch} [p.fetchImpl]  DI til tests — aldrig brugt uden en injiceret apiKey
 * @returns {Promise<string|null>}  polished tekst, eller null ved enhver fejl (kaldestedet falder tilbage til kladden)
 */
export async function polishSeasonDocumentary({ paragraphs, lang, apiKey, fetchImpl = fetch }) {
  if (!apiKey || !paragraphs?.length) return null;
  const draft = paragraphs.join("\n\n");
  try {
    const res = await fetchImpl(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "disabled" },
        system: systemPrompt(lang),
        messages: [{ role: "user", content: `DRAFT:\n\n${draft}` }],
      }),
    });
    if (!res.ok) {
      // Netværks-/API-fejl (rate limit, 5xx, ugyldig nøgle osv.) — ALDRIG kastet
      // videre til kaldestedet. Dokumentaren skal altid have et resultat
      // (den deterministiske kladde), en fejlende polish må ikke fejle sæsonskiftet.
      return null;
    }
    const data = await res.json();
    if (data.stop_reason === "refusal") return null;
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || null;
  } catch {
    // best-effort: netværksfejl/timeout — samme fail-open-til-kladde som
    // ovenfor. Bevidst ingen captureException her: LLM-laget er OFF by
    // default, og en polish-fejl er en forventet, harmløs degradering
    // (kaldestedet falder tilbage til den deterministiske kladde) — ikke en
    // uventet systemfejl der skal alarmere.
    return null;
  }
}
