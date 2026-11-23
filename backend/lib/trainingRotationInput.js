// #8548 · Faelles indgang for en rotation-skrivning fra klienten: rytterens plan
// (routes/trainingPrograms.js) og gruppens plan (routes/trainingGroups.js) validerer
// ens. Formen og reglerne bor i den rene trainingRotation.js; her er kun de opslag,
// der afhaenger af kontakter (indsats #7947, v3-kataloget #5319).
import { parseRotationWrite, normalizeRotationPasses, isValidRotation } from "./trainingRotation.js";
import { isTrainingEffortLevelsEnabled } from "./trainingEffortLevels.js";
import { isV3OnlySession, isTrainingCatalogV3EnabledForViewer } from "./trainingCatalogV3.js";

// { ok: true, write, passes } | { ok: false, reason }. `passes` er undefined, naar
// klienten ikke sendte nogen liste (kun markoer eller "Spring til pas").
//   viewerIsBeta  () => Promise<boolean>, kaldes kun naar en v3-session er valgt.
export async function rotationWriteInput(supabase, body, { viewerIsBeta }) {
  const write = parseRotationWrite(body);
  if (!write.ok) return write;
  if (write.passes === undefined) return { ok: true, write, passes: undefined };
  // #7947: kontakten slaas kun op, naar et pas faktisk har en indsats (som effortForWrite).
  const wantsEffort = write.passes.some((pass) => pass != null && typeof pass === "object" && pass.effort != null);
  const effortLevels = wantsEffort ? await isTrainingEffortLevelsEnabled(supabase) : false;
  const normalized = normalizeRotationPasses(write.passes, { effortLevels });
  if (!normalized.ok) return normalized;
  // #5319: en v3-session kan kun vaelges, naar training_catalog_v3 er aaben for viewer.
  if (normalized.passes.some((pass) => isV3OnlySession(pass.session))
    && !(await isTrainingCatalogV3EnabledForViewer(supabase, viewerIsBeta))) {
    return { ok: false, reason: "invalid_session" };
  }
  return { ok: true, write, passes: normalized.passes };
}

// Det klienten ser for en raekke: markoeren og rotationen (null hvis ingen gyldig).
export function rotationView(row) {
  return { planKind: row?.plan_kind ?? null, rotation: isValidRotation(row?.rotation) ? row.rotation : null };
}
