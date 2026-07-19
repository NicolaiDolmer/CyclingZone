// #2647 — daglig READ-ONLY invariant-vagt for rytter-ejerskab på auktioner.
//
// BAGGRUND: incidenten 2026-07-18 — 16 hold-ejede ryttere endte på ungdoms-
// auktioner (skulle være umuligt: ungdomsauktioner er forbeholdt FRI ryttere).
// Root cause var upstream; DENNE vagt er et bagvedliggende safety-net der
// detekterer hvis invarianten nogensinde brydes igen, uanset årsag — den
// reparerer INTET, den alarmerer.
//
// TRE invarianter der aldrig må være sande:
//   A. En aktiv/extended UNGDOMSauktion hvor rytteren er hold-ejet
//      (team_id NOT NULL eller pending_team_id NOT NULL).
//   B. En aktiv/extended auktion UDEN sælger (seller_team_id IS NULL) der
//      ikke er en ungdomsauktion, hvor rytteren er hold-ejet. KRITISK: scopet
//      til status IN ('active','extended') — auctionFinalization.js sætter
//      seller_team_id=NULL på COMPLETED rækker (se finalizeYouthAuction), så
//      et uscoped query ville false-positive på EVERY completed sale.
//   C. En stale 'offered' academy_intake-række for en allerede-ejet rytter
//      (samme detektion som academyIntakeReconcile.js #1756 — genbrugt, ikke
//      duplikeret).
//
// READ-ONLY: ingen DB-writes, ingen ny tabel, ingen migration. Én Sentry-
// capture pr. invariant pr. tick med FAST fingerprint (mirror ai-trim-
// invariant-guard #2407/#2434-mønstret i cron.js) — ét Sentry-issue pr.
// invariant uanset findings-antal, aldrig ét issue pr. rytter.

import { fetchAllRows } from "./supabasePagination.js";
import { findStaleOfferedIntake } from "./academyIntakeReconcile.js";

const CHUNK = 1000;
const SAMPLE_LIMIT = 50;

// Alle aktive/extended auktioner — begge invariant A og B læser fra samme
// bagvedliggende population, så vi henter den én gang.
async function fetchActiveAuctions(supabase) {
  return fetchAllRows(() =>
    supabase
      .from("auctions")
      .select("id, rider_id, is_youth, seller_team_id, status")
      .in("status", ["active", "extended"])
      .order("id"));
}

// Rytter-ejerskab for et sæt rytter-id'er, chunked (.in() kan ramme 1000-
// loftet på en stor population, samme forsvar som academyIntakeReconcile.js).
async function fetchRidersOwnership(supabase, riderIds) {
  const byId = new Map();
  for (let i = 0; i < riderIds.length; i += CHUNK) {
    const chunk = riderIds.slice(i, i + CHUNK);
    const rows = await fetchAllRows(() =>
      supabase
        .from("riders")
        .select("id, team_id, pending_team_id")
        .in("id", chunk)
        .order("id"));
    for (const r of rows) byId.set(r.id, r);
  }
  return byId;
}

function isOwned(ridersById, riderId) {
  const rider = ridersById.get(riderId);
  if (!rider) return false;
  return rider.team_id != null || rider.pending_team_id != null;
}

function auctionFindingSample(auctions, ridersById) {
  return auctions.slice(0, SAMPLE_LIMIT).map((a) => {
    const rider = ridersById.get(a.rider_id) || {};
    return {
      auctionId: a.id,
      riderId: a.rider_id,
      teamId: rider.team_id ?? null,
      pendingTeamId: rider.pending_team_id ?? null,
    };
  });
}

/**
 * Kør de tre ownership-invariant-tjek. Pure I/O + notify — INGEN writes.
 *
 * @param {object}   args
 * @param {object}   args.supabase
 * @param {(err:Error, ctx:object) => void} [args.captureExceptionFn]
 * @param {Date}     [args.now]  DI-hook (uændret behov lige nu — alle tre tjek
 *                                er nutids-øjebliksbilleder, ikke tidsvinduer),
 *                                accepteret for konsistens med de øvrige guards.
 * @returns {Promise<{checked:number, findings:{youthOwned:number, sellerlessOwned:number, staleIntake:number}, alerted:boolean}>}
 */
export async function runOwnershipInvariantWatch({
  supabase,
  captureExceptionFn,
  now = new Date(),
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  void now; // reserveret DI-hook, ingen tidsvindue-logik pt.

  const activeAuctions = await fetchActiveAuctions(supabase);
  const youthAuctions = activeAuctions.filter((a) => a.is_youth === true);
  const sellerlessAuctions = activeAuctions.filter(
    (a) => a.is_youth === false && a.seller_team_id == null
  );

  const riderIds = [
    ...new Set([...youthAuctions, ...sellerlessAuctions].map((a) => a.rider_id)),
  ];
  const ridersById = await fetchRidersOwnership(supabase, riderIds);

  const youthOwned = youthAuctions.filter((a) => isOwned(ridersById, a.rider_id));
  const sellerlessOwned = sellerlessAuctions.filter((a) => isOwned(ridersById, a.rider_id));
  const staleIntake = await findStaleOfferedIntake(supabase);

  let alerted = false;

  if (youthOwned.length > 0) {
    alerted = true;
    captureExceptionFn?.(
      new Error(
        `Ownership-invariant-brud: ${youthOwned.length} hold-ejet rytter på aktiv ungdomsauktion (#2647)`
      ),
      {
        tags: { cron: "ownership-invariant-watch" },
        fingerprint: ["owned-rider-on-youth-auction"],
        extra: { count: youthOwned.length, sample: auctionFindingSample(youthOwned, ridersById) },
      }
    );
  }

  if (sellerlessOwned.length > 0) {
    alerted = true;
    captureExceptionFn?.(
      new Error(
        `Ownership-invariant-brud: ${sellerlessOwned.length} hold-ejet rytter på sælgerløs auktion (#2647)`
      ),
      {
        tags: { cron: "ownership-invariant-watch" },
        fingerprint: ["owned-rider-on-sellerless-auction"],
        extra: { count: sellerlessOwned.length, sample: auctionFindingSample(sellerlessOwned, ridersById) },
      }
    );
  }

  if (staleIntake.length > 0) {
    alerted = true;
    captureExceptionFn?.(
      new Error(
        `Ownership-invariant-brud: ${staleIntake.length} stale 'offered' intake-række for ejet rytter (#2647)`
      ),
      {
        tags: { cron: "ownership-invariant-watch" },
        fingerprint: ["stale-offered-intake-owned-rider"],
        extra: { count: staleIntake.length, sample: staleIntake.slice(0, SAMPLE_LIMIT) },
      }
    );
  }

  return {
    checked: activeAuctions.length,
    findings: {
      youthOwned: youthOwned.length,
      sellerlessOwned: sellerlessOwned.length,
      staleIntake: staleIntake.length,
    },
    alerted,
  };
}
