// #3750 · Ejer-gate: visse admin-flader må KUN ses af ejeren, ikke af alle
// konti med admin-rollen (22/8: en ven har admin-rollen, og forhåndsvisningen
// af værdi-overgangen skal være ejer-only).
//
// Kilden er env OWNER_USER_IDS (kommasepareret liste af users.id). Bevidst
// env og IKKE app_config: app_config er SELECT-bar for alle authenticated
// brugere (app_config_select_authenticated), så ejerens id ville lække.
//
// FAIL-CLOSED: mangler env'en, er INGEN ejer — siden lukker i stedet for at
// åbne for alle admins.

export function parseOwnerIds(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOwnerUser(userId, raw = process.env.OWNER_USER_IDS) {
  if (!userId) return false;
  return parseOwnerIds(raw).includes(String(userId));
}
