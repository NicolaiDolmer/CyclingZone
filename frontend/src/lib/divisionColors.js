// Delt tier-farve-vokabular (#671 anti-drift): division-farver i guld+navy-systemet.
// div 4 deler --div-3's neutrale token (begge er "nedre" tiers; intet nyt hue).
// Genbrugt af StandingsPage + race-hub "andre divisioner"-browse (S6, #1835), så de
// to flader aldrig drifter fra hinanden på tier-farver.
export const DIV_VARS = { 1: "--accent", 2: "--accent-t", 3: "--div-3", 4: "--div-3" };

export function divColor(div, alpha = 1) {
  const v = DIV_VARS[div] || DIV_VARS[1];
  return alpha >= 1 ? `rgb(var(${v}))` : `rgb(var(${v}) / ${alpha})`;
}
