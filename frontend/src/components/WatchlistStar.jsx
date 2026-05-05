/**
 * WatchlistStar — delt stjerne-knap til at tilføje/fjerne en rytter fra ønskelisten.
 *
 * Brugt i:
 * - RidersPage (rytteroversigt) — toggle på/af baseret på `active`
 * - WatchlistPage (ønskeliste) — `active` er altid true; klik fjerner
 * - ActivityPage (ønskeliste-tab) — `active` er altid true; klik fjerner
 *
 * Stopper event propagation så klik på stjernen ikke trigger row-navigation.
 */
export default function WatchlistStar({ active, onToggle, className = "" }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle(); }}
      title={active ? "Fjern fra ønskeliste" : "Tilføj til ønskeliste"}
      className={`text-lg transition-all hover:scale-110 flex-shrink-0 ${active ? "text-cz-accent-t" : "text-cz-3 hover:text-cz-2"} ${className}`}
    >
      {active ? "★" : "☆"}
    </button>
  );
}
