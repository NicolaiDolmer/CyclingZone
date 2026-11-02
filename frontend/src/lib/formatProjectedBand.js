// #7519: prognose-bånd som tekst. Ét tal når lo === hi (samme regel som
// Trup-fanen), ellers "lo–hi".
export function formatProjectedBand(lo, hi) {
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}
