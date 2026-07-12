// Board test-mode helper (#805)
// ==============================
// Når transfer_windows.board_test_mode === true er board-UI + crons åbne (styret
// af board_negotiation_state), men ØKONOMI-laget neutraliseres: sponsor-modifier
// tvinges 1.0, ingen board-relaterede finance_transactions, tvangssalg/pullout
// suppress. Se database/2026-05-30-board-test-mode.sql for fuld semantik.
//
// Læser seneste window (samme mønster som boardAutoAccept.js / boardMidSeason.js).
// Defensiv: ukendt kolonne (migration ikke kørt), ingen window eller query-fejl → false.
//
// Bevidst minimal (ingen tunge imports): economyEngine.js importerer denne fil, så
// orkestrering (open/close) der trækker betaResetService ind bor i
// boardTestModeService.js for at undgå cyklus economyEngine → betaResetService.
//
// sentry.js er et leaf-util (ingen økonomi-imports) → capturen bryder ikke den
// bevidste minimalisme / cyklus-frihed.
import { captureException } from "./sentry.js";

/**
 * @param {object} supabase — Supabase client
 * @returns {Promise<boolean>} true hvis seneste transfer_window har board_test_mode = true
 */
export async function isBoardTestModeActive(supabase) {
  if (!supabase?.from) return false;
  try {
    const { data, error } = await supabase
      .from("transfer_windows")
      .select("board_test_mode")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // #2395: fail-forkert retning — en fejl her får test-mode til at fremstå SLUKKET,
    // så økonomi-laget anvender ægte konsekvenser (sponsor-modifier, tvangssalg) der
    // skulle være suppress'et i et testvindue. Capture så det ikke sker tavst.
    if (error) {
      captureException(new Error(`isBoardTestModeActive query failed: ${error.message}`), { tags: { lib: "boardTestMode" } });
      return false;
    }
    return data?.board_test_mode === true;
  } catch (err) {
    captureException(err, { tags: { lib: "boardTestMode" } });
    return false;
  }
}

/**
 * Sætter board_test_mode på seneste transfer_window.
 * @param {object} supabase — Supabase client
 * @param {boolean} value — ny værdi
 * @returns {Promise<{ window_id: string|null, board_test_mode: boolean }>}
 */
export async function setLatestWindowTestMode(supabase, value) {
  const { data: latestWindow, error: readError } = await supabase
    .from("transfer_windows")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(`Could not read latest transfer window: ${readError.message}`);
  if (!latestWindow?.id) return { window_id: null, board_test_mode: value };

  const { error: updateError } = await supabase
    .from("transfer_windows")
    .update({ board_test_mode: value })
    .eq("id", latestWindow.id);
  if (updateError) throw new Error(`Could not set board_test_mode: ${updateError.message}`);
  return { window_id: latestWindow.id, board_test_mode: value };
}
