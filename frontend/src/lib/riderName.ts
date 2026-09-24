// Rytternavnets KORTE form — een kilde for hele appen.
//
// "Mathias Sørensen" → "M. Sørensen". #5350: fulde fornavne aad bredden i
// traeningens rytterkolonne, mens de samme ryttere fylder markant mindre paa
// Mit Hold. Efternavnet er identiteten; fornavnet er et initial. Ejeren valgte
// 18/9 netop denne navneform paa mobil ("samme navneform som Mit Hold, som
// spillerne selv pegede på").
//
// Laa foer i `trainingMobileModel.ts`. Flyttet hertil 19/9 (#5383), fordi
// DataTable's navnecelle skal bruge PRAECIS samme form paa mobil — to kopier af
// den samme regel ville vaere to steder at glemme den.
export function riderShortName(
  rider: { firstname?: string | null; lastname?: string | null } | null | undefined,
): string {
  const first = (rider?.firstname ?? "").trim();
  const last = (rider?.lastname ?? "").trim();
  if (!last) return first;
  if (!first) return last;
  return `${first.slice(0, 1).toUpperCase()}. ${last}`;
}
