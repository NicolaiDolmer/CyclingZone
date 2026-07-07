/**
 * S-02e · Konsekvens-tier (6 lag)
 * ================================
 * Master: docs/slices/02-board-redesign-MASTER.md (Appendix C + Q-batch 1B Q11/Q14 + Q-batch 1C Q21)
 *
 * Lag 1 (passive sponsor-modifier ±20%) lever stadig i boardEvaluation.satisfactionToModifier
 * og persisteres i board_profiles.budget_modifier — IKKE i board_consequences.
 *
 * Lag 2-6 lever i board_consequences-tabellen og evalueres ved sæson-end via
 * evaluateAndApplyConsequences. Hard-blocks (lag 2-3) hookes ind i transfer/auction-routes
 * via assertSigningAllowed. Sponsor-pullout (lag 5) hookes ind i processSeasonStart's
 * modifier-stack via getActiveSponsorPulloutFactor og auto-expires ved sæson-skifte
 * (expireSeasonScopedConsequences).
 */

import { STAR_RIDER_MARKET_VALUE } from "./economyConstants.js";

const SATISFACTION_THRESHOLDS = {
  SALARY_CAP: 40,
  SIGNING_RESTRICTION: 30,
  FORCED_LISTING: 15,
  SPONSOR_PULLOUT: 10,
  BONUS_OFFER: 75,
};

// Lag 3 — pris-tærskel i CZ$. Køb >300K kræver bestyrelsesgodkendelse.
// Q-batch 1B Q11 låser tærsklerne for satisfaction; selve pris-tærsklen er
// implementerings-detalje (master line 226: "N-tærskler afgøres inline").
const SIGNING_RESTRICTION_PRICE_THRESHOLD = 300_000;

// Lag 5 — sponsor-pullout-faktor som basis-points (1000 = 1.00).
const SPONSOR_PULLOUT_FACTOR_BP = 900; // 0.90 = -10%

// Lag 6 — bonus-budget. Q-batch 1B Q14: ~25% af 800K start-balance.
const BONUS_OFFER_AMOUNT = 200_000;

// Lag 6 — eligibility. Mindst 75% af mål 'ahead' (proxy: goalsMet / goalsTotal ≥ 0.75).
const BONUS_OFFER_GOALS_THRESHOLD = 0.75;

// Lag 2 — #2237: cappen skal give reelt vækstrum, ikke fryse til aktuel lønsum.
// Ejer-beslutning 2026-07-07: bindende men mildt — 50% headroom over lønsum ved
// oprettelse/re-evaluering, ALDRIG strammet under en tidligere sat cap (kun opad).
const SALARY_CAP_HEADROOM_FACTOR = 1.5;
// Guard mod cap≈0 for hold med (næsten) løn-fri trup på trigger-tidspunktet.
const SALARY_CAP_FLOOR = 5_000;
// Lag 2 — #2237 ejer-krav 2026-07-07: cappen må ALDRIG opstå for et helt nyt hold i
// dets første ~30 dage/første sæson (nybegynder-venlighed — vi skal ikke skræmme nye
// managere væk). Distinkt fra #1721 (afviser sæson-1-observation for satisfaction
// generelt) — denne grace gælder kun lag-2-TRIGGER, ikke satisfaction-bevægelsen selv.
const NEW_MANAGER_SALARY_CAP_GRACE_DAYS = 30;

// Lag 4 — beskytter star/popularity-rytter mod tvunget listing. Stjerne-definitionen
// er market_value-baseret (#1205, delt konstant) — uci_points er frosset/afkoblet (#1101).
const FORCED_LISTING_PROTECTION_POPULARITY = 70;
const FORCED_LISTING_PROTECTION_STAR_VALUE = STAR_RIDER_MARKET_VALUE;

// Lag 5 — alternativ trigger: 2× plan-udløb i træk under 30% tilfredshed
// (samme counter som S-02c chairman-replacement).
const PULLOUT_PLAN_LAPSE_TRIGGER = 2;
const PULLOUT_PLAN_LAPSE_SATISFACTION = 30;

export const CONSEQUENCE_CONSTANTS = {
  SATISFACTION_THRESHOLDS,
  SIGNING_RESTRICTION_PRICE_THRESHOLD,
  SPONSOR_PULLOUT_FACTOR_BP,
  BONUS_OFFER_AMOUNT,
  BONUS_OFFER_GOALS_THRESHOLD,
  FORCED_LISTING_PROTECTION_POPULARITY,
  FORCED_LISTING_PROTECTION_STAR_VALUE,
  PULLOUT_PLAN_LAPSE_TRIGGER,
  PULLOUT_PLAN_LAPSE_SATISFACTION,
  SALARY_CAP_HEADROOM_FACTOR,
  SALARY_CAP_FLOOR,
  NEW_MANAGER_SALARY_CAP_GRACE_DAYS,
};

export const CONSEQUENCE_LAYERS = {
  SALARY_CAP: 2,
  SIGNING_RESTRICTION: 3,
  FORCED_LISTING: 4,
  SPONSOR_PULLOUT: 5,
  BONUS_OFFER: 6,
};

// #666: layer-labels nu via i18n. Backend returnerer en kode-key så frontend
// kan slå op via t() i backendMessages-namespace. EN/DA fallback for legacy-
// kald af getLayerLabel returneres som plain EN.
const LAYER_LABELS_EN = {
  2: "Salary cap",
  3: "Signing restriction",
  4: "Forced listing",
  5: "Sponsor pullout",
  6: "Bonus offer",
};

const LAYER_LABEL_KEYS = {
  2: "consequence.layer.salaryCap",
  3: "consequence.layer.signingRestriction",
  4: "consequence.layer.forcedListing",
  5: "consequence.layer.sponsorPullout",
  6: "consequence.layer.bonusOffer",
};

export function getLayerLabel(layer) {
  return LAYER_LABELS_EN[layer] || `Layer ${layer}`;
}

export function getLayerLabelKey(layer) {
  return LAYER_LABEL_KEYS[layer] || "consequence.layerFallback";
}

function ensureSupabase(supabase) {
  if (!supabase?.from) throw new Error("Supabase client is required");
}

/**
 * #2237 · Er holdet stadig indenfor sin nybegynder-grace for lag 2 (løncap)?
 * Manglende/ugyldig `created_at` behandles konservativt som "ikke i grace"
 * (undgår at ældre data uden feltet uventet får evig grace).
 */
function isWithinNewManagerSalaryCapGrace(teamCreatedAt, now) {
  if (!teamCreatedAt) return false;
  const createdMs = new Date(teamCreatedAt).getTime();
  if (!Number.isFinite(createdMs)) return false;
  const nowMs = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  return nowMs - createdMs < NEW_MANAGER_SALARY_CAP_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

async function loadActiveConsequencesByLayer(supabase, teamId) {
  const { data, error } = await supabase
    .from("board_consequences")
    .select("*")
    .eq("team_id", teamId)
    .eq("status", "active");
  if (error) throw new Error(`Could not load board_consequences: ${error.message}`);
  const byLayer = new Map();
  for (const row of data || []) byLayer.set(row.layer, row);
  return byLayer;
}

export async function getActiveConsequencesForTeam(supabase, teamId) {
  ensureSupabase(supabase);
  if (!teamId) return [];
  const byLayer = await loadActiveConsequencesByLayer(supabase, teamId);
  return Array.from(byLayer.values()).sort((a, b) => a.layer - b.layer);
}

/**
 * Lag 5 · Sponsor-pullout-multiplier til processSeasonStart.
 * Returnerer 1.0 hvis ingen aktiv pullout. Stacker MULTIPLIKATIVT med budget_modifier (lag 1).
 */
export async function getActiveSponsorPulloutFactor(supabase, teamId) {
  ensureSupabase(supabase);
  if (!teamId) return 1.0;
  const byLayer = await loadActiveConsequencesByLayer(supabase, teamId);
  const pullout = byLayer.get(CONSEQUENCE_LAYERS.SPONSOR_PULLOUT);
  if (!pullout) return 1.0;
  return (pullout.severity || 1000) / 1000;
}

/**
 * Lag 5 cleanup ved sæson-start. Pullout varer ÉN sæson (Q-batch 1B Q11) — den
 * row der havde expires_at_season_id = forrige sæson markeres 'expired'.
 * Idempotent: gentagne kald markerer ingen ekstra rows.
 */
export async function expireSeasonScopedConsequences(supabase, completedSeasonId) {
  ensureSupabase(supabase);
  if (!completedSeasonId) return { expired: 0 };
  const { data, error } = await supabase
    .from("board_consequences")
    .update({ status: "expired", resolved_at: new Date().toISOString() })
    .eq("status", "active")
    .eq("expires_at_season_id", completedSeasonId)
    .select("id");
  if (error) throw new Error(`Could not expire season-scoped consequences: ${error.message}`);
  return { expired: (data || []).length };
}

// ─── Hard-block helpers (lag 2-3) ─────────────────────────────────────────────

/**
 * #2237 · Selv-helende effektiv cap: en gemt `cap.severity` kan stamme fra FØR
 * denne fix (frosset til en near-0 lønsum, se GAP 1) og først re-kalibreres til
 * 1.5x-headroom-formlen ved næste sæson-end re-evaluering. Indtil da må håndhævelse
 * ALDRIG straffe den lønsum holdet allerede reelt har LIGE NU — ellers ville en
 * hidtil uhåndhævet vej (fx kontraktforlængelse) med ét blive en hård retroaktiv
 * klemme for eksisterende hold, hvilket ejeren eksplicit afviste (2026-07-07).
 * Giver bevidst INGEN ekstra headroom ud over nuværende lønsum her — headroommet
 * (1.5x) leveres af evaluateAndApplyConsequences ved næste sæson-end; dette er kun
 * en stop-gap-guard mod at bide på data fra før fixet.
 */
function effectiveCapSeverity(cap, currentTotalSalary) {
  return Math.max(cap.severity, currentTotalSalary || 0);
}

/**
 * Aggregerer signing-block-tjek for én potentiel handel.
 * Returnerer null hvis tilladt, ellers { code, layer, reason, threshold }.
 *
 * - Lag 2 (salary_cap): blocks hvis (current_total_salary + new_rider_salary) > severity-cap.
 * - Lag 3 (signing_restriction): blocks hvis purchase_price > severity-pris-tærskel.
 */
export async function assertSigningAllowed({ supabase, buyerTeamId, riderId, purchasePrice }) {
  ensureSupabase(supabase);
  if (!buyerTeamId) return null;

  const byLayer = await loadActiveConsequencesByLayer(supabase, buyerTeamId);
  const cap = byLayer.get(CONSEQUENCE_LAYERS.SALARY_CAP);
  const restriction = byLayer.get(CONSEQUENCE_LAYERS.SIGNING_RESTRICTION);

  if (!cap && !restriction) return null;

  // Lag 3: pris-tærskel — checker først (billigere DB-trip-undgåelse hvis kun lag 3 aktiv).
  if (restriction && Number(purchasePrice || 0) > restriction.severity) {
    return {
      code: "board_signing_restriction",
      layer: CONSEQUENCE_LAYERS.SIGNING_RESTRICTION,
      threshold: restriction.severity,
      reason: `The board blocks purchases above ${restriction.severity} CZ$ (satisfaction below ${SATISFACTION_THRESHOLDS.SIGNING_RESTRICTION}%).`,
      reasonCode: "error.boardSigningRestriction",
      reasonParams: {
        threshold: restriction.severity,
        satisfaction: SATISFACTION_THRESHOLDS.SIGNING_RESTRICTION,
      },
    };
  }

  if (cap) {
    const { data: buyerRiders, error: ridersError } = await supabase
      .from("riders")
      .select("id, salary")
      .eq("team_id", buyerTeamId);
    if (ridersError) throw new Error(`Could not load buyer salaries: ${ridersError.message}`);

    const currentSalary = (buyerRiders || []).reduce((sum, r) => sum + (r.salary || 0), 0);
    let incomingSalary = 0;
    if (riderId) {
      const { data: rider, error: riderError } = await supabase
        .from("riders")
        .select("salary, team_id")
        .eq("id", riderId)
        .single();
      if (riderError) throw new Error(`Could not load incoming rider salary: ${riderError.message}`);
      // Hvis køber allerede ejer rytteren (skal ikke kunne ske, men sikkerhed) — ingen delta.
      if (rider?.team_id !== buyerTeamId) {
        incomingSalary = rider?.salary || 0;
      }
    }

    const effectiveCap = effectiveCapSeverity(cap, currentSalary);
    if (currentSalary + incomingSalary > effectiveCap) {
      return {
        code: "board_salary_cap",
        layer: CONSEQUENCE_LAYERS.SALARY_CAP,
        threshold: effectiveCap,
        reason: `Salary cap set by the board (${effectiveCap} CZ$). You cannot increase the team's total salary — sell a rider first.`,
        reasonCode: "error.boardSalaryCap",
        reasonParams: { cap: effectiveCap },
      };
    }
  }

  return null;
}

/**
 * #2237 · Lag 2 håndhævet på kontraktforlængelse (den eneste manager-initierede
 * løn-forøgelses-vej udenom transfer/auktion, som allerede dækkes af assertSigningAllowed).
 * Blokerer kun rene FORØGELSER — en forlængelse der sænker/holder lønnen uændret blokeres aldrig.
 * Returnerer null hvis tilladt, ellers { code, layer, reason, threshold } (samme form som assertSigningAllowed).
 */
export async function assertSalaryIncreaseAllowed({ supabase, teamId, oldSalary, newSalary }) {
  ensureSupabase(supabase);
  if (!teamId) return null;
  if (Number(newSalary || 0) <= Number(oldSalary || 0)) return null;

  const byLayer = await loadActiveConsequencesByLayer(supabase, teamId);
  const cap = byLayer.get(CONSEQUENCE_LAYERS.SALARY_CAP);
  if (!cap) return null;

  const { data: teamRiders, error } = await supabase
    .from("riders")
    .select("id, salary")
    .eq("team_id", teamId);
  if (error) throw new Error(`Could not load team salaries: ${error.message}`);

  const currentTotal = (teamRiders || []).reduce((sum, r) => sum + (r.salary || 0), 0);
  const projectedTotal = currentTotal - Number(oldSalary || 0) + Number(newSalary || 0);
  const effectiveCap = effectiveCapSeverity(cap, currentTotal);

  if (projectedTotal > effectiveCap) {
    return {
      code: "board_salary_cap",
      layer: CONSEQUENCE_LAYERS.SALARY_CAP,
      threshold: effectiveCap,
      reason: `Salary cap set by the board (${effectiveCap} CZ$). This contract extension would push your total salary over the cap — sell a rider first.`,
      reasonCode: "error.boardSalaryCapExtension",
      reasonParams: { cap: effectiveCap },
    };
  }

  return null;
}

// ─── Forced listing (lag 4) ───────────────────────────────────────────────────

/**
 * Vælger den rytter der skal tvangs-listes ved sat<15.
 * - Beskytter pop≥70 OR market_value≥STAR_RIDER_MARKET_VALUE ("star riders protected"
 *   i help-teksten — samme stjerne-definition som team_star-achievementet, #1205).
 * - Vælger laveste market_value blandt resten.
 * - Returnerer null hvis ingen kandidat (alle beskyttede eller ingen ryttere).
 */
export function selectForcedListingRider(riders) {
  if (!Array.isArray(riders) || riders.length === 0) return null;

  const candidates = riders.filter((r) => {
    if (!r || !r.id) return false;
    if ((r.popularity || 0) >= FORCED_LISTING_PROTECTION_POPULARITY) return false;
    if ((r.market_value || 0) >= FORCED_LISTING_PROTECTION_STAR_VALUE) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  // Stabil sortering: laveste market_value, tie-break på id (deterministisk).
  candidates.sort((a, b) => {
    const va = a.market_value || 0;
    const vb = b.market_value || 0;
    if (va !== vb) return va - vb;
    return String(a.id).localeCompare(String(b.id));
  });

  return candidates[0];
}

// ─── Bonus offer eligibility (lag 6) ──────────────────────────────────────────

export function isBonusOfferEligible({ satisfaction, goalsMet, goalsTotal }) {
  if ((satisfaction ?? 0) <= SATISFACTION_THRESHOLDS.BONUS_OFFER) return false;
  if (!goalsTotal || goalsTotal <= 0) return false;
  const ratio = (goalsMet ?? 0) / goalsTotal;
  return ratio >= BONUS_OFFER_GOALS_THRESHOLD;
}

/**
 * Vælger ekstra-mål baseret på board-fokus. Q-batch 1B Q14 specificerer
 * "vind 1 monument ELLER sign 1 stjerne pop ≥75". Vi vælger deterministisk:
 * star_signing → signature_rider, ellers monument_podium.
 */
export function selectBonusExtraGoal(board) {
  const focus = board?.focus || "balanced";
  if (focus === "star_signing") {
    return {
      type: "signature_rider",
      target: 75,
      // EN fallback label for legacy callers; #666 prefers labelKey for i18n.
      label: "Sign 1 star (popularity ≥75)",
      labelKey: "consequence.bonusGoal.signatureRider",
    };
  }
  return {
    type: "monument_podium",
    target: 1,
    label: "Top 3 in at least 1 monument",
    labelKey: "consequence.bonusGoal.monumentPodium",
  };
}

// ─── Hovedmotor — kaldes fra processTeamSeasonEnd ─────────────────────────────

/**
 * Evaluerer alle 6 lag for én team ved sæson-end og opretter consequences-rows
 * + sender notifs (lag 4-6 → board_critical, lag 2-3 = silent).
 *
 * Idempotent via unique-active-index på (team_id, layer): forsøger upsert-style
 * (delete+insert hvis severity skifter for vedvarende lag, skip hvis allerede aktiv).
 *
 * Lag 1 (passive_modifier) håndteres IKKE her — det er allerede skrevet til
 * board_profiles.budget_modifier af evaluateBoardSeason.
 */
export async function evaluateAndApplyConsequences({
  supabase,
  team,
  board,
  newSatisfaction,
  previousSatisfaction = null,
  goalsMet,
  goalsTotal,
  planIsComplete,
  seasonId,
  notify,
  consecutiveLowExpirations = 0,
  boardTestMode = false,
  now = new Date(),
}) {
  ensureSupabase(supabase);
  if (!team?.id || !board?.id) {
    return { applied: [], skipped: [] };
  }

  const applied = [];
  const skipped = [];
  const byLayer = await loadActiveConsequencesByLayer(supabase, team.id);
  // status='active' eksplicit (DB har DEFAULT 'active', men vi sætter det explicit
  // så fake supabase i tests + dependent code kan stole på feltet uden at gå via DB).
  const baseRow = {
    team_id: team.id,
    source_board_id: board.id,
    status: "active",
  };

  // ── Lag 2: Salary cap (sat<40)
  if (newSatisfaction < SATISFACTION_THRESHOLDS.SALARY_CAP) {
    const existing = byLayer.get(CONSEQUENCE_LAYERS.SALARY_CAP);

    // #2237 ejer-krav 2026-07-07: helt nyt hold (< 30 dage) må ALDRIG få cappen
    // opstå — nybegynder-venlighed. Kan ikke ramme et hold der allerede har en
    // aktiv cap (den ville kun kunne være oprettet efter grace-perioden sluttede).
    const inGrace = !existing && isWithinNewManagerSalaryCapGrace(team.created_at, now);

    // #2237 ejer-krav: cappen må ikke opstå på et enkelt dyk — kun hvis krisen er
    // VEDVARENDE (denne OG forrige evaluering under 40%), medmindre den allerede
    // er aktiv (så er re-evaluering/opdatering altid tilladt).
    const sustainedLow =
      Boolean(existing) ||
      (previousSatisfaction != null && Number(previousSatisfaction) < SATISFACTION_THRESHOLDS.SALARY_CAP);

    if (inGrace) {
      skipped.push({ layer: 2, reason: "new_manager_grace" });
    } else if (!sustainedLow) {
      skipped.push({ layer: 2, reason: "first_dip_not_sustained" });
    } else {
      // #2237: cap = 50% headroom over lønsum ved trigger-tid, floor mod cap≈0, og
      // ALDRIG strammet under en tidligere sat cap (kun re-evalueret opad når lønsummen
      // vokser videre — bevidst mildt, jf. ejer-beslutning 2026-07-07).
      const totalSalary = (team.riders || []).reduce((sum, r) => sum + (r.salary || 0), 0);
      const candidateCap = Math.max(Math.round(totalSalary * SALARY_CAP_HEADROOM_FACTOR), SALARY_CAP_FLOOR);
      const newCap = Math.max(candidateCap, existing?.severity || 0);
      if (existing && existing.severity === newCap) {
        skipped.push({ layer: 2, reason: "unchanged" });
      } else {
        // Mark previous as expired før insert (unique-active-index ville ellers fejle).
        if (existing) {
          await supabase
            .from("board_consequences")
            .update({ status: "expired", resolved_at: new Date().toISOString() })
            .eq("id", existing.id);
        }
        await supabase.from("board_consequences").insert({
          ...baseRow,
          layer: CONSEQUENCE_LAYERS.SALARY_CAP,
          severity: newCap,
          payload: { satisfaction: newSatisfaction, total_salary_at_create: totalSalary },
        });
        applied.push({ layer: 2, severity: newCap });
      }
    }
  } else {
    // Sat steg over 40 → expirér aktiv cap.
    const existing = byLayer.get(CONSEQUENCE_LAYERS.SALARY_CAP);
    if (existing) {
      await supabase
        .from("board_consequences")
        .update({ status: "expired", resolved_at: new Date().toISOString() })
        .eq("id", existing.id);
      applied.push({ layer: 2, severity: 0, action: "expired" });
    }
  }

  // ── Lag 3: Signing-restriktion (sat<30)
  if (newSatisfaction < SATISFACTION_THRESHOLDS.SIGNING_RESTRICTION) {
    const existing = byLayer.get(CONSEQUENCE_LAYERS.SIGNING_RESTRICTION);
    if (!existing) {
      await supabase.from("board_consequences").insert({
        ...baseRow,
        layer: CONSEQUENCE_LAYERS.SIGNING_RESTRICTION,
        severity: SIGNING_RESTRICTION_PRICE_THRESHOLD,
        payload: { satisfaction: newSatisfaction },
      });
      applied.push({ layer: 3, severity: SIGNING_RESTRICTION_PRICE_THRESHOLD });
    } else {
      skipped.push({ layer: 3, reason: "already_active" });
    }
  } else {
    const existing = byLayer.get(CONSEQUENCE_LAYERS.SIGNING_RESTRICTION);
    if (existing) {
      await supabase
        .from("board_consequences")
        .update({ status: "expired", resolved_at: new Date().toISOString() })
        .eq("id", existing.id);
      applied.push({ layer: 3, action: "expired" });
    }
  }

  // ── Lag 4: Tvunget listing (sat<15) — vælg + insert listing + create row
  // #805 test-mode: tvangssalg er en reel økonomisk konsekvens (kan føre til salg),
  // så det suppress fuldt — ingen transfer_listing, ingen consequence-row, ingen
  // notify (en "rytter force-listed"-besked uden faktisk listing ville være
  // misvisende player-facing copy). Satisfaction-presset er fortsat synligt i UI.
  if (boardTestMode && newSatisfaction < SATISFACTION_THRESHOLDS.FORCED_LISTING) {
    skipped.push({ layer: 4, reason: "test_mode_suppressed" });
  } else if (newSatisfaction < SATISFACTION_THRESHOLDS.FORCED_LISTING) {
    const existing = byLayer.get(CONSEQUENCE_LAYERS.FORCED_LISTING);
    if (existing) {
      skipped.push({ layer: 4, reason: "already_active" });
    } else {
      const target = selectForcedListingRider(team.riders || []);
      if (target) {
        const askingPrice = target.market_value || 0;
        const { data: listing, error: listingError } = await supabase
          .from("transfer_listings")
          .insert({
            rider_id: target.id,
            seller_team_id: team.id,
            asking_price: askingPrice,
            status: "open",
          })
          .select("id")
          .single();
        if (listingError) {
          // Listing-fejl må ikke blokere sæson-end — log + spring over.
          console.error(`  ⚠️  forced listing failed for ${team.name}: ${listingError.message}`);
        } else {
          const riderName = target.firstname && target.lastname
            ? `${target.firstname} ${target.lastname}`
            : `Rider ${target.id}`;
          await supabase.from("board_consequences").insert({
            ...baseRow,
            layer: CONSEQUENCE_LAYERS.FORCED_LISTING,
            severity: askingPrice,
            payload: {
              rider_id: target.id,
              rider_name: riderName,
              listing_id: listing.id,
              satisfaction: newSatisfaction,
            },
          });
          applied.push({ layer: 4, severity: askingPrice, rider_name: riderName });
          if (notify) {
            await notify({
              type: "board_critical",
              title: "The board demands a sale",
              message: `Satisfaction is at ${newSatisfaction}%. The board has force-listed ${riderName} at ${askingPrice} CZ$.`,
              metadata: {
                titleCode: "notif.boardForcedListing.title",
                titleParams: {},
                messageCode: "notif.boardForcedListing.message",
                messageParams: {
                  satisfaction: newSatisfaction,
                  riderName,
                  askingPrice,
                },
              },
            });
          }
        }
      }
    }
  }

  // ── Lag 5: Sponsor-pullout (sat<10 ELLER 2× plan-udløb under 30%)
  // Trigger b kun ved planIsComplete=true (samme som S-02c chairman-replacement).
  const pulloutTriggerA = newSatisfaction < SATISFACTION_THRESHOLDS.SPONSOR_PULLOUT;
  const pulloutTriggerB =
    planIsComplete &&
    newSatisfaction < PULLOUT_PLAN_LAPSE_SATISFACTION &&
    consecutiveLowExpirations >= PULLOUT_PLAN_LAPSE_TRIGGER;

  if (boardTestMode && (pulloutTriggerA || pulloutTriggerB)) {
    // #805 test-mode: pullout fryser sponsor-modifier (-10%) næste sæson → suppress
    // (ingen consequence-row → effektiv modifier 1.0). Dækket transitivt af lag 1-override.
    skipped.push({ layer: 5, reason: "test_mode_suppressed" });
  } else if (pulloutTriggerA || pulloutTriggerB) {
    const existing = byLayer.get(CONSEQUENCE_LAYERS.SPONSOR_PULLOUT);
    if (existing) {
      skipped.push({ layer: 5, reason: "already_active" });
    } else {
      await supabase.from("board_consequences").insert({
        ...baseRow,
        layer: CONSEQUENCE_LAYERS.SPONSOR_PULLOUT,
        severity: SPONSOR_PULLOUT_FACTOR_BP,
        expires_at_season_id: seasonId,
        payload: {
          satisfaction: newSatisfaction,
          trigger: pulloutTriggerA ? "low_satisfaction" : "double_plan_lapse",
        },
      });
      applied.push({ layer: 5, severity: SPONSOR_PULLOUT_FACTOR_BP });
      if (notify) {
        await notify({
          type: "board_critical",
          title: "Sponsor pulls out",
          message: "The board reports that a main sponsor has pulled out after the season. Sponsor income drops by 10% next season.",
          metadata: {
            titleCode: "notif.boardSponsorPullout.title",
            titleParams: {},
            messageCode: "notif.boardSponsorPullout.message",
            messageParams: {},
          },
        });
      }
    }
  }

  // ── Lag 6: Bonus-offer (sat>75 + ≥75% mål 'ahead')
  // Idempotency: 1×/sæson — skip hvis aktivt offer ELLER offer skabt i nuværende sæson.
  if (isBonusOfferEligible({ satisfaction: newSatisfaction, goalsMet, goalsTotal })) {
    const existing = byLayer.get(CONSEQUENCE_LAYERS.BONUS_OFFER);
    if (existing) {
      skipped.push({ layer: 6, reason: "already_active" });
    } else {
      // Tjek om der allerede er ETHVERT (aktiv ELLER resolved) bonus-offer i denne sæson.
      const { data: thisSeasonOffers, error: thisSeasonError } = await supabase
        .from("board_consequences")
        .select("id")
        .eq("team_id", team.id)
        .eq("layer", CONSEQUENCE_LAYERS.BONUS_OFFER)
        .eq("expires_at_season_id", seasonId);
      if (thisSeasonError) {
        throw new Error(`Could not check season bonus-offers: ${thisSeasonError.message}`);
      }
      if ((thisSeasonOffers || []).length > 0) {
        skipped.push({ layer: 6, reason: "already_offered_this_season" });
      } else {
        const extraGoal = selectBonusExtraGoal(board);
        await supabase.from("board_consequences").insert({
          ...baseRow,
          layer: CONSEQUENCE_LAYERS.BONUS_OFFER,
          severity: BONUS_OFFER_AMOUNT,
          expires_at_season_id: seasonId,
          payload: {
            satisfaction: newSatisfaction,
            goals_met: goalsMet,
            goals_total: goalsTotal,
            extra_goal_type: extraGoal.type,
            extra_goal_target: extraGoal.target,
            extra_goal_label: extraGoal.label,
          },
        });
        applied.push({ layer: 6, severity: BONUS_OFFER_AMOUNT, extra_goal: extraGoal });
        if (notify) {
          await notify({
            type: "board_critical",
            title: "Bonus offer from the board",
            message: `The board is impressed (${newSatisfaction}% satisfaction, ${goalsMet}/${goalsTotal} goals met). They offer +${BONUS_OFFER_AMOUNT} CZ$ for an extra goal: ${extraGoal.label}. Accept or decline on the Board page.`,
            metadata: {
              titleCode: "notif.boardBonusOffer.title",
              titleParams: {},
              messageCode: "notif.boardBonusOffer.message",
              messageParams: {
                satisfaction: newSatisfaction,
                goalsMet,
                goalsTotal,
                bonusAmount: BONUS_OFFER_AMOUNT,
                goalLabelKey: extraGoal.labelKey || null,
              },
            },
          });
        }
      }
    }
  }

  return { applied, skipped };
}

// ─── Manager actions på lag 6 (accept/decline) ────────────────────────────────

/**
 * Manager accepterer bonus-tilbuddet.
 * - Markerer row 'accepted' + resolved_at
 * - Returnerer { ok, bonus_amount, extra_goal } så caller kan kreditere + tilføje mål
 *
 * Caller (api.js) er ansvarlig for credit + at tilføje extra_goal til 1yr-board's
 * current_goals — vi vil ikke duplicere finance-tx-kontrakter her.
 */
export async function acceptBonusOffer({ supabase, teamId, offerId }) {
  ensureSupabase(supabase);
  const { data: offer, error: offerError } = await supabase
    .from("board_consequences")
    .select("*")
    .eq("id", offerId)
    .eq("team_id", teamId)
    .eq("layer", CONSEQUENCE_LAYERS.BONUS_OFFER)
    .eq("status", "active")
    .maybeSingle();
  if (offerError) throw new Error(`Could not load bonus offer: ${offerError.message}`);
  if (!offer) return { ok: false, code: "not_found" };

  const { error: updateError } = await supabase
    .from("board_consequences")
    .update({ status: "accepted", resolved_at: new Date().toISOString() })
    .eq("id", offer.id);
  if (updateError) throw new Error(`Could not accept bonus offer: ${updateError.message}`);

  return {
    ok: true,
    bonus_amount: offer.severity,
    extra_goal: {
      type: offer.payload?.extra_goal_type,
      target: offer.payload?.extra_goal_target,
      label: offer.payload?.extra_goal_label,
    },
    source_board_id: offer.source_board_id,
  };
}

export async function declineBonusOffer({ supabase, teamId, offerId }) {
  ensureSupabase(supabase);
  const { data: offer, error: offerError } = await supabase
    .from("board_consequences")
    .select("id")
    .eq("id", offerId)
    .eq("team_id", teamId)
    .eq("layer", CONSEQUENCE_LAYERS.BONUS_OFFER)
    .eq("status", "active")
    .maybeSingle();
  if (offerError) throw new Error(`Could not load bonus offer: ${offerError.message}`);
  if (!offer) return { ok: false, code: "not_found" };

  const { error: updateError } = await supabase
    .from("board_consequences")
    .update({ status: "declined", resolved_at: new Date().toISOString() })
    .eq("id", offer.id);
  if (updateError) throw new Error(`Could not decline bonus offer: ${updateError.message}`);

  return { ok: true };
}

// ─── Layer 4 fulfillment — markerer row 'fulfilled' når listing sælges ────────

/**
 * Kaldes fra transfer/auction-finalize-flow når en listing sælges. Hvis listing-id
 * matcher et aktivt forced_listing-event for sælgerteamet, markeres det 'fulfilled'.
 */
export async function markForcedListingFulfilled({ supabase, teamId, listingId }) {
  ensureSupabase(supabase);
  if (!teamId || !listingId) return { ok: false };
  const { data: rows, error } = await supabase
    .from("board_consequences")
    .select("id, payload")
    .eq("team_id", teamId)
    .eq("layer", CONSEQUENCE_LAYERS.FORCED_LISTING)
    .eq("status", "active");
  if (error) throw new Error(`Could not load forced listings: ${error.message}`);

  const match = (rows || []).find((row) => row.payload?.listing_id === listingId);
  if (!match) return { ok: false };

  const { error: updateError } = await supabase
    .from("board_consequences")
    .update({ status: "fulfilled", resolved_at: new Date().toISOString() })
    .eq("id", match.id);
  if (updateError) throw new Error(`Could not fulfill forced listing: ${updateError.message}`);
  return { ok: true };
}
