// Wave A1 (#1441 Fase 3) — facilitets-/staff-service: køb, ansæt, fyr.
// Al balance-mutation går via economyEngine.debitTeam (ledger + idempotency).
// Hård gate: alle funktioner er no-ops mens FACILITIES_ENABLED=false; tests
// injicerer flags-parameteren ({ facilitiesEnabled: true }) — prod-callsites
// udelader den så koden følger kode-konstanten.
import { FACILITIES_ENABLED, FACILITY_TRACKS, staffSalaryFor, staffReleaseSeverance } from "./facilityConstants.js";
import { validateUpgrade, validateHire, getUpgradePrice, severanceCost } from "./facilityEngine.js";
import { generateStaffCandidates } from "./staffCandidates.js";
import { deriveStaffAbilities } from "./staffAbilityDerivation.js";
import { debitTeam } from "./economyEngine.js";
import { FINANCE_REASON } from "./economyConstants.js";

const DEFAULT_FLAGS = Object.freeze({ facilitiesEnabled: FACILITIES_ENABLED });

async function loadTeamBalance(teamId, supabaseClient) {
  const { data, error } = await supabaseClient
    .from("teams")
    .select("balance")
    .eq("id", teamId)
    .single();
  if (error) throw new Error(`facilityService: could not load team balance for ${teamId}: ${error.message}`);
  return data.balance ?? 0;
}

// Manglende row = tier 0 (alle hold starter uden faciliteter).
async function loadFacilityTier(teamId, track, supabaseClient) {
  const { data, error } = await supabaseClient
    .from("team_facilities")
    .select("tier")
    .eq("team_id", teamId)
    .eq("track", track)
    .maybeSingle();
  if (error) throw new Error(`facilityService: could not load facility tier for ${teamId}/${track}: ${error.message}`);
  return data?.tier ?? 0;
}

async function loadActiveStaff(teamId, role, supabaseClient) {
  const { data, error } = await supabaseClient
    .from("team_staff")
    .select("id, name, role, tier, salary, status")
    .eq("team_id", teamId)
    .eq("role", role)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`facilityService: could not load active staff for ${teamId}/${role}: ${error.message}`);
  return data;
}

// #2649: opslag på staffId (i stedet for role) TIL ejerskabs-guarden i releaseStaff.
// .eq("team_id", teamId) håndhæves i APPLIKATIONS-koden her (ikke kun RLS) — en
// staff-række der findes, men tilhører et andet hold, matcher aldrig denne query
// og giver samme "staff_not_found" som et ukendt id (ingen oplysningslæk om,
// hvorvidt id'et findes hos en anden).
async function loadStaffById(teamId, staffId, supabaseClient) {
  const { data, error } = await supabaseClient
    .from("team_staff")
    .select("id, name, role, tier, salary, status")
    .eq("id", staffId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) throw new Error(`facilityService: could not load staff ${staffId} for ${teamId}: ${error.message}`);
  return data;
}

export async function purchaseFacilityUpgrade(
  { teamId, track, seasonId, seasonNumber },
  supabaseClient,
  flags = DEFAULT_FLAGS
) {
  if (!flags.facilitiesEnabled) return { ok: false, error: "facilities_disabled" };
  // Membership-validering FØR DB-queries — ugyldig track skal aldrig koste queries.
  if (!FACILITY_TRACKS.includes(track)) return { ok: false, error: "invalid_track" };

  const balance = await loadTeamBalance(teamId, supabaseClient);
  const currentTier = await loadFacilityTier(teamId, track, supabaseClient);

  // NB: to samtidige køb af FORSKELLIGE tracks kan tilsammen overtrække
  // balancen (accepteret ved beta-skala; negativ-rente er backstop).
  const validationError = validateUpgrade({ track, currentTier, balance });
  if (validationError) return { ok: false, error: validationError };

  const nextTier = currentTier + 1;
  const price = getUpgradePrice(currentTier);

  const debit = await debitTeam(teamId, price, "facility_purchase", null, seasonId, supabaseClient, {
    idempotent: true,
    metadata: { code: "tx.facilityPurchase", params: { track, tier: nextTier } },
    audit: {
      sourcePath: "facilityService.purchaseFacilityUpgrade",
      idempotencyKey: `facility_purchase:${teamId}:${track}:${nextTier}`,
    },
  });

  // NB: updated_at er APP-VEDLIGEHOLDT (ingen DB-trigger) — sæt den ved hver UPDATE.
  const { error: upsertError } = await supabaseClient
    .from("team_facilities")
    .upsert(
      {
        team_id: teamId,
        track,
        tier: nextTier,
        purchased_season: seasonNumber,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "team_id,track" }
    );
  if (upsertError) throw new Error(`facilityService: facility upsert failed for ${teamId}/${track}: ${upsertError.message}`);

  // skipped=true = idempotent retry (debit allerede bogført); upsert ovenfor
  // re-stamper purchased_season/updated_at — harmløst, samme værdier.
  return { ok: true, track, tier: nextTier, price, ...(debit.skipped ? { skipped: true } : {}) };
}

export async function hireStaff(
  { teamId, role, candidateName, seasonId, seasonNumber },
  supabaseClient,
  flags = DEFAULT_FLAGS
) {
  if (!flags.facilitiesEnabled) return { ok: false, error: "facilities_disabled" };
  // Membership-validering FØR DB-queries — ugyldig role skal aldrig koste queries.
  if (!FACILITY_TRACKS.includes(role)) return { ok: false, error: "invalid_role" };
  void seasonId; // ingen upfront debit — sæsonløn opkræves af payroll (Task 6)

  const existing = await loadActiveStaff(teamId, role, supabaseClient);
  if (existing) return { ok: false, error: "role_occupied" };

  const balance = await loadTeamBalance(teamId, supabaseClient);
  const facilityTier = await loadFacilityTier(teamId, role, supabaseClient);

  // Kandidater regenereres SERVER-SIDE (deterministisk seed) og matches på navn —
  // klienten må aldrig selv levere tier/salary.
  const candidates = generateStaffCandidates({ teamId, seasonNumber, role, facilityTier });
  const candidate = candidates.find((c) => c.name === candidateName);
  if (!candidate) return { ok: false, error: "invalid_candidate" };

  const validationError = validateHire({ role, staffTier: candidate.tier, facilityTier, balance });
  if (validationError) return { ok: false, error: validationError };

  // #2216 A4 (Q1): den PERSISTEREDE løn er rating-drevet — staffSalaryFor(overall) af den
  // afledte profil, så den ansatte chefs løn matcher hans faktiske evne (ikke et groft tier).
  // Profilen udledes FØR insert, så salary + evner stammer fra ét deterministisk objekt.
  // Er identisk med candidate.salary (samme overall, samme kurve), men forankres i profilen.
  const profile = deriveStaffAbilities({ role, tier: candidate.tier, name: candidate.name });
  const salary = staffSalaryFor(profile.overall);

  // .select("id").single() henter den nye staff_id, som ability-upserten kræver.
  const { data: inserted, error: insertError } = await supabaseClient
    .from("team_staff")
    .insert({
      team_id: teamId,
      name: candidate.name,
      role,
      tier: candidate.tier,
      salary,
      hired_season: seasonNumber,
      status: "active",
    })
    .select("id")
    .single();
  if (insertError) {
    // Race: samtidig hire vandt insertet — partial unique index på
    // (team_id, role) WHERE status='active' afviser med 23505.
    if (insertError.code === "23505") return { ok: false, error: "role_occupied" };
    throw new Error(`facilityService: staff insert failed for ${teamId}/${role}: ${insertError.message}`);
  }

  // #2216 A4: persistér den afledte evne-profil (spejler rider_derived_abilities).
  // Samme idempotens-disciplin som ledger-debitten: upsert på staff_id, så en
  // retry re-stamper i stedet for at fejle. updated_at er app-vedligeholdt.
  const { error: abilityError } = await supabaseClient
    .from("staff_derived_abilities")
    .upsert(
      {
        staff_id: inserted.id,
        overall: profile.overall,
        dimensions: profile.dimensions,
        levels: profile.levels,
        role_skills: profile.roleSkills,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "staff_id" }
    );
  if (abilityError) throw new Error(`facilityService: staff ability upsert failed for ${inserted.id}: ${abilityError.message}`);

  return {
    ok: true,
    staff: { name: candidate.name, role, tier: candidate.tier, salary },
  };
}

export async function fireStaff(
  { teamId, role, seasonId, seasonNumber },
  supabaseClient,
  flags = DEFAULT_FLAGS
) {
  if (!flags.facilitiesEnabled) return { ok: false, error: "facilities_disabled" };

  const staff = await loadActiveStaff(teamId, role, supabaseClient);
  if (!staff) return { ok: false, error: "no_active_staff" };

  // BEVIDST ingen balance-validering: fyring er tilladt selv om balancen går
  // negativ (negative-interest håndterer det) — severance er sink + friktion.
  const cost = severanceCost(staff);

  const debit = await debitTeam(teamId, cost, "staff_severance", null, seasonId, supabaseClient, {
    idempotent: true,
    metadata: { code: "tx.staffSeverance", params: { role } },
    audit: {
      sourcePath: "facilityService.fireStaff",
      idempotencyKey: `staff_severance:${teamId}:${role}:${staff.id}`,
    },
  });

  const { error: updateError } = await supabaseClient
    .from("team_staff")
    .update({ status: "fired", fired_season: seasonNumber })
    .eq("id", staff.id);
  if (updateError) throw new Error(`facilityService: staff fire-update failed for ${staff.id}: ${updateError.message}`);

  return { ok: true, severance: cost, ...(debit.skipped ? { skipped: true } : {}) };
}

// #2649: opsig EGET staff (staffId-baseret, ikke role-baseret som fireStaff)
// mod severance = 4 × ugentlig løn (staffReleaseSeverance — ny, ejer-godkendt
// model). Bruges af den nye "Release staff"-knap på staff-profil/-oversigt
// (frontend/src/pages/StaffProfilePage.jsx + StaffOverviewPage.jsx).
//
// Rækkefølge er BEVIDST: status-check FØR debit, og status-check er den
// primære double-click-guard (2. kald ser status='fired' → already_released,
// INGEN ny debit). idempotencyKey er et sekundært lag for den ægte samtidigheds-
// race (to kald begge læser status='active' før nogen skriver) — DB'ens unikke
// index på idempotency_key sikrer at kun ét af dem rent faktisk debiterer
// (se database/2026-05-09-audit-log-foundation.sql:uniq_finance_idempotency_key).
export async function releaseStaff(
  { teamId, staffId, seasonId, seasonNumber },
  supabaseClient,
  flags = DEFAULT_FLAGS
) {
  if (!flags.facilitiesEnabled) return { ok: false, error: "facilities_disabled" };
  if (!staffId) return { ok: false, error: "staff_not_found" };

  const staff = await loadStaffById(teamId, staffId, supabaseClient);
  if (!staff) return { ok: false, error: "staff_not_found" };
  if (staff.status !== "active") return { ok: false, error: "already_released" };

  const balance = await loadTeamBalance(teamId, supabaseClient);
  const severance = staffReleaseSeverance(staff.salary);
  if (balance < severance) return { ok: false, error: "insufficient_funds", severance, balance };

  const debit = await debitTeam(teamId, severance, "staff_severance", null, seasonId, supabaseClient, {
    idempotent: true,
    metadata: { code: "tx.staffRelease", params: { role: staff.role, staffName: staff.name } },
    audit: {
      sourcePath: "facilityService.releaseStaff",
      reasonCode: FINANCE_REASON.STAFF_RELEASE_SEVERANCE,
      idempotencyKey: `staff_release_severance:${teamId}:${staff.id}`,
    },
  });

  const { error: updateError } = await supabaseClient
    .from("team_staff")
    .update({ status: "fired", fired_season: seasonNumber })
    .eq("id", staff.id);
  if (updateError) throw new Error(`facilityService: staff release-update failed for ${staff.id}: ${updateError.message}`);

  return {
    ok: true,
    severance,
    role: staff.role,
    name: staff.name,
    ...(debit.skipped ? { skipped: true } : {}),
  };
}
