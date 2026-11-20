// #6500 D6 (ejer 11/10): kun managerhold udvikler sig. Et AI-hold, banken og testhold træner
// (form, træthed, skade), men evnerne står stille. Ét fælles modul, så motoren
// (dailyTrainingEngine.js) og udbetalingen på første XP-dato (developmentXpFirstDate.js)
// bruger samme regel uden at importere hinanden.
export function isManagerTeamForDevelopment(team) {
  if (!team) return false;
  return team.user_id != null && team.is_ai !== true && team.is_bank !== true && team.is_test_account !== true;
}
